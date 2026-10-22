// Adds a person directly, without public sign-up: a School Admin or System
// Admin supplies an email, name, and position. School Admin can only use a
// Community Member position; only a System Admin can add a School Admin or
// System Admin. The account is created with a random, discarded password,
// and a one-time recovery link is generated so the new person sets their own
// password -- no password is ever typed, stored, or shown in plain text.
//
// The registration trigger (handle_new_user, migration 0014) only skips the
// sign-up form and approves an account immediately when user_metadata
// carries the right provision_secret. That secret lives in the
// public._provision_secrets table (RLS: no policies, so only service-key
// code can read it) and is fetched here at request time rather than kept as
// a duplicated, separately-rotated deploy secret.
//
// Deploy: supabase functions deploy admin-create-user --project-ref <ref>
// Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, which
// Supabase injects into every Edge Function automatically.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Sign in required' }, 401);

  let body: { email?: string; display_name?: string; designation_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const displayName = (body.display_name ?? '').trim();
  const designationId = (body.designation_id ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400);
  if (displayName.length < 2 || displayName.length > 120) return json({ error: 'Enter a name (2 to 120 characters)' }, 400);
  if (!designationId) return json({ error: 'Choose a position' }, 400);

  // Scoped to the caller: every read below is bound by that person's own RLS.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

  const { data: callerAuth, error: callerAuthError } = await asCaller.auth.getUser();
  if (callerAuthError || !callerAuth.user) return json({ error: 'Sign in required' }, 401);

  const { data: callerProfile, error: callerProfileError } = await asCaller
    .from('profiles')
    .select('role, school_id, is_active')
    .eq('id', callerAuth.user.id)
    .maybeSingle();
  if (callerProfileError || !callerProfile || callerProfile.is_active === false) {
    return json({ error: 'Account not found' }, 403);
  }
  const isSystemAdmin = callerProfile.role === 'system_admin';
  if (callerProfile.role !== 'school_admin' && !isSystemAdmin) {
    return json({ error: 'Only a School Admin or System Admin can add people' }, 403);
  }

  const { data: designation, error: designationError } = await asCaller
    .from('user_types')
    .select('id, name, base_role, school_id, is_active')
    .eq('id', designationId)
    .maybeSingle();
  if (designationError || !designation || !designation.is_active) return json({ error: 'That position is not available' }, 400);
  if (designation.school_id !== callerProfile.school_id) return json({ error: 'That position belongs to a different school' }, 403);
  if ((designation.base_role === 'school_admin' || designation.base_role === 'system_admin') && !isSystemAdmin) {
    return json({ error: 'Only a System Admin can add a School Admin or System Admin' }, 403);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: secretRow, error: secretError } = await admin.from('_provision_secrets').select('secret').eq('id', true).maybeSingle();
  if (secretError || !secretRow) return json({ error: 'Could not add this person right now. Try again shortly.' }, 500);

  const tempPassword = crypto.randomUUID() + crypto.randomUUID();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { provisioned: 'admin' },
    user_metadata: { provision_secret: secretRow.secret, designation_id: designation.id, display_name: displayName },
  });
  if (createError) {
    const already = createError.message?.toLowerCase().includes('already') || createError.code === 'email_exists';
    return json({ error: already ? 'That email is already registered.' : (createError.message ?? 'Could not create the account') }, 400);
  }
  const newUserId = created.user.id;

  // The trigger above already created the profile (role, position, school,
  // and approved status, all from the designation) in the same transaction
  // as the auth.users insert. This just records who added whom.
  await admin.from('audit_logs').insert({
    actor_id: callerAuth.user.id,
    action: 'user_provisioned',
    entity_type: 'profiles',
    entity_id: newUserId,
    payload: { email, designation: designation.name, role: designation.base_role },
  });

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email });

  return json({
    id: newUserId,
    email,
    role: designation.base_role,
    setupLink: linkError ? null : linkData?.properties?.action_link ?? null,
  });
});
