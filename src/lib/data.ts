import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Alert, AuditEntry, Block, CheckIn, Environment, Incident, Location, LocationType, Profile, SetupLocation, Submission, SubmissionKind, UserType } from './types';
import { fetchEarthquakes, fetchWeather, schoolCoordinates, type Quake, type WeatherSnapshot } from './weather';
import type { Role } from '../roles';

const HISTORY_DAYS = 60;

export const USER_TYPE_COLUMNS = 'id, name, description, base_role, features, is_active, is_system, selectable_at_signup, authorized_privileged, can_approve_own_location';

const READS_SUBMISSIONS: Role[] = ['school_admin'];
const MANAGES_PEOPLE: Role[] = ['school_admin', 'system_admin'];

export type SchoolData = {
  locations: Location[];
  placeNames: { id: string; name: string }[];
  submissions: Submission[];
  incidents: Incident[];
  checkIns: CheckIn[];
  alerts: Alert[];
  people: Profile[];
  userTypes: UserType[];
  audit: AuditEntry[];
  counts: Record<string, number | string> | null;
};

const EMPTY: SchoolData = { locations: [], placeNames: [], submissions: [], incidents: [], checkIns: [], alerts: [], people: [], userTypes: [], audit: [], counts: null };

export function useSchoolData(profile: Profile) {
  const [data, setData] = useState<SchoolData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // `silent` refreshes in place (used by realtime) without dimming the panel.
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    const sinceIso = new Date(Date.now() - HISTORY_DAYS * 24 * 3600_000).toISOString();
    const readsSubmissions = READS_SUBMISSIONS.includes(profile.role);
    const managesPeople = MANAGES_PEOPLE.includes(profile.role);

    const [locations, submissions, incidents, checkIns, alerts, people, userTypes, audit, counts] = await Promise.all([
      supabase.from('locations').select('id, name, environment, parent_id, grid_cols, grid_rows, layout_x, layout_y, layout_w, layout_h').eq('status', 'active').order('name'),
      readsSubmissions
        ? supabase
            .from('submissions')
            .select('id, kind, sub_type, emotion, stress_level, message, status, location_id, created_at, acknowledged_at, resolved_at')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(2000)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('incidents')
        .select('id, case_ref, category, description, status, location_id, created_by, assigned_to, created_at, acknowledged_at, resolved_at, priority_severity, priority_urgency, priority_affected, priority_index, priority_level, priority_set_by, priority_basis')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase
        .from('check_ins')
        .select('id, profile_id, status, location_id, checked_in_at, help_type, triage_status')
        .gte('checked_in_at', sinceIso)
        .order('checked_in_at', { ascending: false })
        .limit(2000),
      supabase
        .from('alerts')
        .select('id, title, body, severity, status, target_scope, target_role, created_by, created_at, published_at')
        .order('created_at', { ascending: false })
        .limit(100),
      managesPeople
        ? supabase.from('profiles').select('id, role, display_name, school_id, user_type_id, primary_location_id, is_active, status').order('display_name')
        : Promise.resolve({ data: [], error: null }),
      managesPeople
        ? supabase.from('user_types').select(USER_TYPE_COLUMNS).order('name')
        : Promise.resolve({ data: [], error: null }),
      managesPeople
        ? supabase.from('audit_logs').select('id, action, entity_type, created_at').order('created_at', { ascending: false }).limit(40)
        : Promise.resolve({ data: [], error: null }),
      profile.role === 'school_admin' ? supabase.rpc('dashboard_counts') : Promise.resolve({ data: null, error: null }),
    ]);

    const firstError = [locations, submissions, incidents, checkIns, alerts, people, userTypes, audit, counts].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);

    const { data: names } = await supabase.from('locations').select('id, name').limit(5000);
    setData({
      placeNames: (names ?? []) as { id: string; name: string }[],
      locations: (locations.data ?? []) as Location[],
      submissions: (submissions.data ?? []) as Submission[],
      incidents: (incidents.data ?? []) as Incident[],
      checkIns: (checkIns.data ?? []) as CheckIn[],
      alerts: (alerts.data ?? []) as Alert[],
      people: (people.data ?? []) as Profile[],
      userTypes: (userTypes.data ?? []) as UserType[],
      audit: (audit.data ?? []) as AuditEntry[],
      counts: (counts.data ?? null) as SchoolData['counts'],
    });
    setLoading(false);
  }, [profile.role]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

// Reports appear on the map and in the queue the moment they are saved: refresh
// whenever an incident, help request, or submission this account may read changes.
// Row-level security applies to realtime too, so people only hear about rows they
// could already read. Bursts are merged into one refresh.
export function useRealtimeReload(reload: (silent?: boolean) => Promise<void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(true), 400);
    };
    const channel = supabase
      .channel('reports-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [reload, enabled]);
}

export function useExternalData() {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [quakes, setQuakes] = useState<Quake[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const coords = schoolCoordinates();
    const load = () => {
      fetchWeather(coords, controller.signal)
        .then((w) => {
          setWeather(w);
          setError('');
        })
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setError(`Weather unavailable: ${e.message}`);
        });
      fetchEarthquakes(coords, controller.signal)
        .then(setQuakes)
        .catch(() => setQuakes([]));
    };
    load();
    const timer = window.setInterval(load, 15 * 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return { weather, quakes, error };
}

// --- Writes. Each relies on RLS and validation triggers in the database. ---

type Result = { error: string | null; caseRef?: string };

function toResult(error: { message: string } | null): Result {
  return { error: error ? friendlyError(error.message) : null };
}

function friendlyError(message: string): string {
  if (message.includes('already have an open incident')) return 'You already reported an incident a few minutes ago. Responders have it. Please wait before sending another.';
  if (message.includes('already asked for help')) return 'You already asked for help a moment ago. Responders have it. If it is urgent, tell the nearest teacher or staff member.';
  if (message.includes('choose where')) return 'Choose where this is before you confirm.';
  if (message.includes('not active')) return 'That place is not available any more. Choose another place.';
  if (message.includes('row-level security')) return 'Your role is not allowed to do that.';
  if (message.includes('Database error saving new user')) return 'Registration was refused. Check your name, position, and default location, then try again.';
  if (message.includes('user_types_school_name_key')) return 'A position with that name already exists.';
  return message;
}

export async function sendSubmission(
  profile: Profile,
  input: { kind: SubmissionKind; subType: string; stress?: number; locationId: string | null; message: string },
): Promise<Result> {
  const { error } = await supabase.from('submissions').insert({
    school_id: profile.school_id,
    kind: input.kind,
    sub_type: input.subType,
    emotion: input.kind === 'sentiment' ? input.subType : null,
    stress_level: input.kind === 'sentiment' ? input.stress : null,
    location_id: input.locationId,
    message: input.message,
  });
  return toResult(error);
}

export async function raiseIncident(profile: Profile, input: { category: string; locationId: string | null; description: string }): Promise<Result> {
  const { data, error } = await supabase
    .from('incidents')
    .insert({ school_id: profile.school_id, category: input.category, location_id: input.locationId, description: input.description })
    .select('case_ref')
    .single();
  return { ...toResult(error), caseRef: data?.case_ref };
}

// `helpType` is one of the Get Help buttons. The database picks the first triage
// status from it; the browser never sends one.
export async function checkIn(profile: Profile, status: 'safe' | 'need_help', locationId: string | null, helpType?: string): Promise<Result & { triage?: string }> {
  const { data, error } = await supabase
    .from('check_ins')
    .insert({ school_id: profile.school_id, status, location_id: locationId, location_source: 'self_selected', ...(helpType ? { help_type: helpType } : {}) })
    .select('triage_status')
    .single();
  return { ...toResult(error), triage: data?.triage_status ?? undefined };
}

export async function triageHelp(id: string, status: 'responding' | 'resolved'): Promise<Result> {
  const { error } = await supabase.rpc('triage_help_request', { p_check_in_id: id, p_status: status });
  return toResult(error);
}

export async function transitionIncident(id: string, status: string, note?: string): Promise<Result> {
  const { error } = await supabase.rpc('transition_incident', { incident_id: id, new_status: status, note: note ?? null });
  return toResult(error);
}

export async function setIncidentPriority(id: string, severity: number, urgency: number, affected: number): Promise<Result> {
  const { error } = await supabase.rpc('set_incident_priority', { p_incident_id: id, p_severity: severity, p_urgency: urgency, p_affected: affected });
  return toResult(error);
}

export async function reviewSubmission(id: string, status: 'acknowledged' | 'resolved'): Promise<Result> {
  const { error } = await supabase.from('submissions').update({ status }).eq('id', id);
  return toResult(error);
}

export async function draftAlert(
  profile: Profile,
  input: { title: string; body: string; severity: string; targetScope: string; targetRole: Role | null },
): Promise<Result> {
  const { error } = await supabase.from('alerts').insert({
    school_id: profile.school_id,
    title: input.title,
    body: input.body,
    severity: input.severity,
    target_scope: input.targetScope,
    target_role: input.targetScope === 'role' ? input.targetRole : null,
  });
  return toResult(error);
}

export async function alertAction(id: string, action: 'approve_alert' | 'publish_alert' | 'cancel_alert'): Promise<Result> {
  const args = action === 'cancel_alert' ? { alert_id: id, reason: 'Cancelled from dashboard' } : { alert_id: id };
  const { error } = await supabase.rpc(action, args);
  return toResult(error);
}

export async function setUserType(userId: string, typeId: string): Promise<Result> {
  const { error } = await supabase.rpc('admin_set_user_type', { target_user_id: userId, new_type_id: typeId });
  return toResult(error);
}

// --- School setup (System Admin) ---

export type SetupData = { locations: SetupLocation[]; types: LocationType[]; userTypes: UserType[] };

export async function loadSetup(): Promise<{ data: SetupData; error: string | null }> {
  const [locations, types, userTypes] = await Promise.all([
    supabase.from('locations').select('id, name, environment, parent_id, category_id, code, status, grid_cols, grid_rows, layout_x, layout_y, layout_w, layout_h').order('name').limit(5000),
    supabase.from('location_categories').select('id, name, level, environment, is_active').order('level').order('name'),
    supabase.from('user_types').select(USER_TYPE_COLUMNS).order('name'),
  ]);
  const error = [locations, types, userTypes].find((r) => r.error)?.error?.message ?? null;
  return {
    data: {
      locations: (locations.data ?? []) as SetupLocation[],
      types: (types.data ?? []) as LocationType[],
      userTypes: (userTypes.data ?? []) as UserType[],
    },
    error: error ? friendlyError(error) : null,
  };
}

export async function saveLocation(
  profile: Profile,
  input: { id?: string; name: string; parentId: string | null; categoryId: string; environment: Environment; code: string | null },
): Promise<Result> {
  const row = { name: input.name.trim(), parent_id: input.parentId, category_id: input.categoryId, environment: input.environment, code: input.code?.trim() || null };
  const { error } = input.id
    ? await supabase.from('locations').update(row).eq('id', input.id)
    : await supabase.from('locations').insert({ ...row, school_id: profile.school_id });
  return toResult(error);
}

export async function setLocationStatus(id: string, status: 'active' | 'archived'): Promise<Result> {
  const { error } = await supabase.from('locations').update({ status }).eq('id', id);
  return toResult(error);
}

export async function saveLocationType(
  profile: Profile,
  input: { id?: string; name: string; level: number; environment: string; isActive: boolean },
): Promise<Result> {
  const row = { name: input.name.trim(), level: input.level, environment: input.environment, is_active: input.isActive };
  const { error } = input.id
    ? await supabase.from('location_categories').update(row).eq('id', input.id)
    : await supabase.from('location_categories').insert({ ...row, school_id: profile.school_id });
  return toResult(error);
}

export async function saveUserType(
  profile: Profile,
  input: { id?: string; name: string; description: string; baseRole: Role; features: string[]; isActive: boolean; selectableAtSignup: boolean; authorizedPrivileged: boolean; canApproveOwnLocation: boolean },
): Promise<Result> {
  const row = {
    name: input.name.trim(),
    description: input.description.trim() || null,
    base_role: input.baseRole,
    features: input.features,
    is_active: input.isActive,
    selectable_at_signup: input.baseRole === 'community' && input.selectableAtSignup,
    authorized_privileged: input.baseRole === 'system_admin' && input.authorizedPrivileged,
    can_approve_own_location: input.baseRole === 'community' && input.canApproveOwnLocation,
  };
  const { error } = input.id
    ? await supabase.from('user_types').update(row).eq('id', input.id)
    : await supabase.from('user_types').insert({ ...row, school_id: profile.school_id });
  return toResult(error);
}

export async function placeBlock(locationId: string, block: Block | null): Promise<Result> {
  const row = block
    ? { layout_x: block.x, layout_y: block.y, layout_w: block.w, layout_h: block.h }
    : { layout_x: null, layout_y: null, layout_w: null, layout_h: null };
  const { error } = await supabase.from('locations').update(row).eq('id', locationId);
  return toResult(error);
}

export async function setGridSize(locationId: string, cols: number, rows: number): Promise<Result> {
  const { error } = await supabase.from('locations').update({ grid_cols: cols, grid_rows: rows }).eq('id', locationId);
  return toResult(error);
}

// --- Registration and default location ---

export type RegistrationOptions = {
  open: boolean;
  designations: { id: string; name: string; description: string | null }[];
  locations: { id: string; name: string; parent_id: string | null; level: number }[];
};

export async function fetchRegistrationOptions(): Promise<{ data: RegistrationOptions | null; error: string | null }> {
  const { data, error } = await supabase.rpc('registration_options');
  return { data: (data as RegistrationOptions | null) ?? null, error: error ? friendlyError(error.message) : null };
}

export type Gender = 'female' | 'male' | 'other' | 'prefer_not_to_say';

export const GENDER_LABELS: Record<Gender, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

// Name, Member type, Specific Location, ID No., and Gender are sent, plus
// the email and password the account itself needs. The database decides
// the role from the Member type (designation) and ignores anything else.
export async function registerAccount(input: {
  email: string;
  password: string;
  displayName: string;
  designationId: string;
  locationId: string;
  idNumber: string;
  gender: Gender;
}): Promise<Result & { needsConfirmation?: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: {
        display_name: input.displayName.trim(),
        designation_id: input.designationId,
        default_location_id: input.locationId,
        id_number: input.idNumber.trim(),
        gender: input.gender,
      },
    },
  });
  return { ...toResult(error), needsConfirmation: !error && !data.session };
}

export async function setMyDefaultLocation(locationId: string): Promise<Result> {
  const { error } = await supabase.rpc('set_my_default_location', { p_location_id: locationId });
  return toResult(error);
}

// --- Approving or rejecting a pending self-registration ---

export async function approveRegistration(userId: string): Promise<Result> {
  const { error } = await supabase.rpc('approve_registration', { target_user_id: userId });
  return toResult(error);
}

export async function rejectRegistration(userId: string): Promise<Result> {
  const { error } = await supabase.rpc('reject_registration', { target_user_id: userId });
  return toResult(error);
}

// A Classroom Adviser (or any position with can_approve_own_location) only
// sees the pending accounts at their own location — a School Admin or
// System Admin already gets every pending account through the full People
// panel's regular profiles query, so they don't need this.
export type PendingNearby = { id: string; display_name: string | null; created_at: string; designation: string | null };

export async function fetchPendingInMyLocation(): Promise<{ data: PendingNearby[]; error: string | null }> {
  const { data, error } = await supabase.rpc('pending_in_my_location');
  return { data: (data as PendingNearby[] | null) ?? [], error: error ? friendlyError(error.message) : null };
}

// --- Adding a person directly (School Admin, System Admin) ---
//
// Calls the admin-create-user Edge Function, which runs with the service
// key: the only client-side code allowed to create an account outside
// public sign-up. A random password is generated and discarded server-side;
// the admin shares the returned one-time setup link instead.

export type AddPersonResult = Result & { setupLink?: string | null; email?: string };

export async function addPerson(input: { email: string; displayName: string; designationId: string; locationId: string | null }): Promise<AddPersonResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { error: 'Sign in again and try once more.' };
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: input.email.trim(), display_name: input.displayName.trim(), designation_id: input.designationId, default_location_id: input.locationId }),
    });
    const body = await res.json().catch(() => ({}) as { error?: string; setupLink?: string | null; email?: string });
    if (!res.ok) return { error: friendlyError(body.error ?? 'Could not add this person.') };
    return { error: null, setupLink: body.setupLink ?? null, email: body.email };
  } catch {
    return { error: 'Network error. Check your connection and try again.' };
  }
}
