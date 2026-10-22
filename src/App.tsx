import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { roleDetails, TAB_LABELS, type Role, type Tab } from './roles';
import demoAccounts from './demo-accounts.json';
import { THEME_LABELS, useTheme } from './theme';
import type { Profile, UserType } from './lib/types';
import { useExternalData, useSchoolData, type SchoolData } from './lib/data';
import { incidentSummary, sentimentSummary, since, type AlertTemplate } from './lib/analytics';
import { ReportPanel } from './components/ReportPanel';
import { AnalyticsPanel, type Range } from './components/AnalyticsPanel';
import { MapPanel } from './components/MapPanel';
import { MoreMenu } from './components/MoreMenu';
import { QueuePanel } from './components/QueuePanel';
import { AlertsPanel } from './components/AlertsPanel';
import { PeoplePanel } from './components/PeoplePanel';
import { SetupPanel } from './components/SetupPanel';
import { effectiveFeatures, navFor } from './lib/features';

function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [userType, setUserType] = useState<UserType | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setSchoolName(null);
      setUserType(null);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    supabase
      .from('profiles')
      .select('id, role, display_name, school_id, user_type_id')
      .eq('id', userId)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) {
          setProfile(null);
          setStatus('ready');
          return;
        }
        setProfile(data as Profile);
        if (data.user_type_id) {
          const { data: type } = await supabase.from('user_types').select('id, name, description, base_role, features, is_active, is_system').eq('id', data.user_type_id).single();
          setUserType((type as UserType | null) ?? null);
        } else {
          setUserType(null);
        }
        if (data.school_id) {
          const { data: school } = await supabase.from('schools').select('name').eq('id', data.school_id).single();
          setSchoolName(school?.name ?? null);
        }
        setStatus('ready');
      });
  }, [userId]);

  return { session, profile, schoolName, userType, status };
}

function LoginCard() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  async function login(loginEmail: string, loginPassword: string) {
    setSubmitting(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    setSubmitting(false);
    if (signInError) setError(signInError.message);
  }

  return (
    <article className="login-card">
      <p className="eyebrow">SIGN IN</p>
      <h3>Access your SENTINEL dashboard</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login(email, password);
        }}
      >
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      <button type="button" className="link-button" onClick={() => setShowDemo((v) => !v)}>
        {showDemo ? 'Hide demo accounts' : 'Try a demo account for every role'}
      </button>
      {showDemo && (
        <ul className="demo-accounts">
          {demoAccounts.accounts.map((account) => (
            <li key={account.email}>
              <span>{roleDetails[account.role as Role].label}</span>
              <button type="button" onClick={() => login(account.email, demoAccounts.password)} disabled={submitting}>
                Log in as {roleDetails[account.role as Role].label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Workspace({ profile, schoolName, email, userType }: { profile: Profile; schoolName: string | null; email: string; userType: UserType | null }) {
  const details = roleDetails[profile.role];
  const features = useMemo(() => effectiveFeatures(profile.role, userType?.features ?? null), [profile.role, userType]);
  const nav = navFor(features);
  const tabs = [...nav.primary, ...nav.more];
  const [tab, setTab] = useState<Tab>(nav.primary[0] ?? 'report');
  const [days, setDays] = useState<Range>(14);
  const [template, setTemplate] = useState<AlertTemplate | null>(null);
  const { data, loading, error, reload } = useSchoolData(profile);
  const external = useExternalData();
  const latestAlert = data.alerts.find((a) => a.status === 'published' && a.severity !== 'info');
  const queueUrgent = useMemo(() => urgentCount(profile.role, data), [profile.role, data]);

  function draftFromInsight(t: AlertTemplate) {
    setTemplate(t);
    setTab('alerts');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="workspace">
      <div className="greeting">
        <span className="role-symbol" aria-hidden="true">{details.icon}</span>
        <div>
          <p className="eyebrow">{(userType?.name ?? details.label).toUpperCase()}</p>
          <h1>Hi, {profile.display_name ?? email}</h1>
          <p className="lede">
            {userType?.description || details.summary}
            {schoolName ? ` · ${schoolName}` : ''}
          </p>
        </div>
      </div>

      {latestAlert && tabs.includes('alerts') && (
        <button type="button" className={`alert-banner sev-${latestAlert.severity}`} onClick={() => setTab('alerts')}>
          <span aria-hidden="true">{latestAlert.severity === 'urgent' ? '🚨' : '⚠️'}</span>
          <span>
            <strong>{latestAlert.title}</strong>
            <small>Tap to read</small>
          </span>
        </button>
      )}

      {tabs.length === 0 && <p className="empty-note">Your account has no features turned on yet. Ask your System Admin to set up your user type.</p>}

      {tabs.length > 1 && (
        <nav className="tab-bar" aria-label="Sections">
          {nav.primary.map((t) => (
            <button type="button" key={t} className={`tab-button${tab === t ? ' is-active' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
              <span aria-hidden="true">{TAB_LABELS[t].icon}</span>
              <span>{TAB_LABELS[t].label}</span>
              {t === 'queue' && queueUrgent > 0 && <span className="badge">{queueUrgent}</span>}
            </button>
          ))}
          {nav.more.length > 0 && <MoreMenu items={nav.more} active={tab} badges={{ queue: queueUrgent }} onSelect={setTab} />}
        </nav>
      )}

      {error && <p className="error-text">Some data could not load: {error}</p>}
      <div className={`panel${loading ? ' is-loading' : ''}`}>
        {tab === 'report' && tabs.includes('report') && <ReportPanel profile={profile} features={features} locations={data.locations} incidents={data.incidents} checkIns={data.checkIns} onSent={reload} />}
        {tab === 'map' && tabs.includes('map') && <MapPanel role={profile.role} days={days} onDays={setDays} data={data} />}
        {tab === 'analytics' && tabs.includes('analytics') && (
          <AnalyticsPanel role={profile.role} days={days} onDays={setDays} data={data} weather={external.weather} quakes={external.quakes} weatherError={external.error} onDraftAlert={draftFromInsight} />
        )}
        {tab === 'queue' && tabs.includes('queue') && <QueuePanel role={profile.role} data={data} onChanged={reload} />}
        {tab === 'alerts' && tabs.includes('alerts') && (
          <AlertsPanel profile={profile} features={features} data={data} weather={external.weather} quakes={external.quakes} weatherError={external.error} initialTemplate={template} onChanged={reload} />
        )}
        {tab === 'people' && tabs.includes('people') && <PeoplePanel profile={profile} data={data} onChanged={reload} />}
        {tab === 'setup' && tabs.includes('setup') && <SetupPanel profile={profile} features={features} people={data.people} onPeopleChanged={reload} />}
      </div>
    </div>
  );
}

// Items behind the More menu that should not wait: help requests and
// unacknowledged incidents for responders, unresolved crisis follow-ups for Guidance.
function urgentCount(role: Role, data: SchoolData): number {
  if (role === 'security' || role === 'drrm' || role === 'school_admin') {
    const help = since(data.checkIns, 1, (c) => c.checked_in_at).filter((c) => c.status === 'need_help').length;
    return help + incidentSummary(data.incidents).unacknowledged;
  }
  if (role === 'guidance') return sentimentSummary(data.submissions).needsFollowUp.length;
  return 0;
}

export function App() {
  const { session, profile, schoolName, userType, status } = useAuth();
  const { theme, cycleTheme } = useTheme();

  return (
    <main className={session ? 'signed-in' : undefined}>
      <header>
        <a className="brand" href="#top">
          <span>◈</span> SENTINEL
        </a>
        <div className="header-actions">
          <button type="button" className="theme-toggle" onClick={cycleTheme} aria-label={`Theme: ${THEME_LABELS[theme]}. Switch theme`}>
            <span aria-hidden="true">◐</span> {THEME_LABELS[theme]}
          </button>
          {session && (
            <button className="secondary" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          )}
        </div>
      </header>
      {!session && (
        <section className="hero" id="top">
          <h1>Every voice can help build a safer school.</h1>
          <p className="lede">SENTINEL turns feelings, reports, and weather into early warnings your school can act on.</p>
        </section>
      )}
      <section className="access">
        {status === 'loading' && <p>Loading…</p>}
        {status === 'ready' && !session && <LoginCard />}
        {status === 'ready' && session && profile && <Workspace key={profile.id + (userType?.id ?? '')} profile={profile} userType={userType} schoolName={schoolName} email={session.user.email ?? ''} />}
        {status === 'ready' && session && !profile && <p className="error-text">Signed in, but no profile was found for this account.</p>}
      </section>
    </main>
  );
}
