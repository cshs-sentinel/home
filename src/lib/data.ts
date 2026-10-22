import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Alert, AuditEntry, CheckIn, Incident, Location, Profile, Submission, SubmissionKind } from './types';
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
  audit: AuditEntry[];
  counts: Record<string, number | string> | null;
};

const EMPTY: SchoolData = { locations: [], submissions: [], incidents: [], checkIns: [], alerts: [], people: [], audit: [], counts: null };

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

    const [locations, submissions, incidents, checkIns, alerts, people, audit, counts] = await Promise.all([
      supabase.from('locations').select('id, name, environment, parent_id').eq('status', 'active').order('name'),
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
        ? supabase.from('profiles').select('id, role, display_name, school_id').order('display_name')
        : Promise.resolve({ data: [], error: null }),
      managesPeople
        ? supabase.from('audit_logs').select('id, action, entity_type, created_at').order('created_at', { ascending: false }).limit(40)
        : Promise.resolve({ data: [], error: null }),
      profile.role === 'school_admin' ? supabase.rpc('dashboard_counts') : Promise.resolve({ data: null, error: null }),
    ]);

    const firstError = [locations, submissions, incidents, checkIns, alerts, people, audit, counts].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);

    setData({
      locations: (locations.data ?? []) as Location[],
      submissions: (submissions.data ?? []) as Submission[],
      incidents: (incidents.data ?? []) as Incident[],
      checkIns: (checkIns.data ?? []) as CheckIn[],
      alerts: (alerts.data ?? []) as Alert[],
      people: (people.data ?? []) as Profile[],
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

export async function setUserRole(userId: string, role: Role): Promise<Result> {
  const { error } = await supabase.rpc('admin_set_user_role', { target_user_id: userId, new_role: role });
  return toResult(error);
}
