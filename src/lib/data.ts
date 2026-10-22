import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Alert, AuditEntry, Block, CheckIn, Environment, Incident, Location, LocationType, Profile, SetupLocation, Submission, SubmissionKind, UserType } from './types';
import { fetchEarthquakes, fetchWeather, schoolCoordinates, type Quake, type WeatherSnapshot } from './weather';
import type { Role } from '../roles';

const HISTORY_DAYS = 60;

const READS_SUBMISSIONS: Role[] = ['teacher', 'security', 'drrm', 'guidance', 'school_admin'];
const MANAGES_PEOPLE: Role[] = ['school_admin', 'system_admin'];

export type SchoolData = {
  locations: Location[];
  submissions: Submission[];
  incidents: Incident[];
  checkIns: CheckIn[];
  alerts: Alert[];
  people: Profile[];
  userTypes: UserType[];
  audit: AuditEntry[];
  counts: Record<string, number | string> | null;
};

const EMPTY: SchoolData = { locations: [], submissions: [], incidents: [], checkIns: [], alerts: [], people: [], userTypes: [], audit: [], counts: null };

export function useSchoolData(profile: Profile) {
  const [data, setData] = useState<SchoolData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
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
        .select('id, case_ref, category, description, status, location_id, created_by, created_at, acknowledged_at, resolved_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase
        .from('check_ins')
        .select('id, profile_id, status, location_id, checked_in_at')
        .gte('checked_in_at', sinceIso)
        .order('checked_in_at', { ascending: false })
        .limit(2000),
      supabase
        .from('alerts')
        .select('id, title, body, severity, status, target_scope, target_role, created_by, created_at, published_at')
        .order('created_at', { ascending: false })
        .limit(100),
      managesPeople
        ? supabase.from('profiles').select('id, role, display_name, school_id, user_type_id').order('display_name')
        : Promise.resolve({ data: [], error: null }),
      managesPeople
        ? supabase.from('user_types').select('id, name, description, base_role, features, is_active, is_system').order('name')
        : Promise.resolve({ data: [], error: null }),
      managesPeople
        ? supabase.from('audit_logs').select('id, action, entity_type, created_at').order('created_at', { ascending: false }).limit(40)
        : Promise.resolve({ data: [], error: null }),
      profile.role === 'school_admin' ? supabase.rpc('dashboard_counts') : Promise.resolve({ data: null, error: null }),
    ]);

    const firstError = [locations, submissions, incidents, checkIns, alerts, people, userTypes, audit, counts].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);

    setData({
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
  if (message.includes('row-level security')) return 'Your role is not allowed to do that.';
  if (message.includes('user_types_school_name_key')) return 'A user type with that name already exists.';
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

export async function checkIn(profile: Profile, status: 'safe' | 'need_help', locationId: string | null): Promise<Result> {
  const { error } = await supabase
    .from('check_ins')
    .insert({ school_id: profile.school_id, status, location_id: locationId, location_source: 'self_selected' });
  return toResult(error);
}

export async function transitionIncident(id: string, status: string, note?: string): Promise<Result> {
  const { error } = await supabase.rpc('transition_incident', { incident_id: id, new_status: status, note: note ?? null });
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
    supabase.from('user_types').select('id, name, description, base_role, features, is_active, is_system').order('name'),
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
  input: { id?: string; name: string; description: string; baseRole: Role; features: string[]; isActive: boolean },
): Promise<Result> {
  const row = { name: input.name.trim(), description: input.description.trim() || null, base_role: input.baseRole, features: input.features, is_active: input.isActive };
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

export type PlaceSentiment = { location_id: string; entries: number; avg_stress: number };

// Privacy-safe totals: places with fewer than 3 feelings, or whose small
// groups could be worked out by subtraction, are left out by the database.
export async function fetchSentimentByLocation(days: number): Promise<{ data: PlaceSentiment[]; error: string | null }> {
  const { data, error } = await supabase.rpc('sentiment_by_location', { p_days: days });
  return { data: ((data ?? []) as PlaceSentiment[]).map((r) => ({ ...r, avg_stress: Number(r.avg_stress) })), error: error ? friendlyError(error.message) : null };
}
