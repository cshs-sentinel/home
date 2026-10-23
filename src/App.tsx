import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { roleDetails, TAB_LABELS, type Role, type Tab } from './roles';
import demoAccountList from './demo-accounts.json';

// The list is empty once every demo login has been retired; the login card then hides the demo button.
const demoAccounts = demoAccountList as { password: string; accounts: { role: string; email: string; displayName: string }[] };
import { THEME_LABELS, useTheme } from './theme';
import { SignUpCard } from './components/SignUpCard';
import type { Profile, UserType } from './lib/types';
import { USER_TYPE_COLUMNS, useExternalData, useRealtimeReload, useSchoolData, type SchoolData } from './lib/data';
import { incidentSummary, since, type AlertTemplate } from './lib/analytics';
import { ReportPanel } from './components/ReportPanel';
import { AnalyticsPanel, type Range } from './components/AnalyticsPanel';
import { MapPanel } from './components/MapPanel';
import { MoreMenu } from './components/MoreMenu';
import { QueuePanel } from './components/QueuePanel';
import { AlertsPanel } from './components/AlertsPanel';
import { PeoplePanel } from './components/PeoplePanel';
import { MyLocationApprovals } from './components/MyLocationApprovals';
import { FeelPanel } from './components/FeelPanel';
import { QuickReport } from './components/QuickReport';
import { KnowPanel } from './components/KnowPanel';
import { MyReportsPanel } from './components/MyReportsPanel';
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
      .select('id, role, display_name, school_id, user_type_id, primary_location_id, status')
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
          const { data: type } = await supabase.from('user_types').select(USER_TYPE_COLUMNS).eq('id', data.user_type_id).single();
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

  // Re-read the profile without showing the loading screen (for example after
  // the default location changes).
  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('profiles').select('id, role, display_name, school_id, user_type_id, primary_location_id, status').eq('id', userId).single();
    if (data) setProfile(data as Profile);
  }, [userId]);

  return { session, profile, schoolName, userType, status, refreshProfile };
}

function AuthCards() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  return mode === 'login' ? <LoginCard onSignUp={() => setMode('signup')} /> : <SignUpCard onLogin={() => setMode('login')} />;
}

function LoginCard({ onSignUp }: { onSignUp: () => void }) {
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
      <h3>Welcome Back!</h3>
      <p className="auth-sub">Log in to your account to continue.</p>
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
          {submitting ? 'Signing in…' : 'Login'}
        </button>
      </form>
      <button type="button" className="link-button" onClick={onSignUp}>
        New here? Create a community account
      </button>
      {demoAccounts.accounts.length > 0 && (
      <button type="button" className="link-button" onClick={() => setShowDemo((v) => !v)}>
        {showDemo ? 'Hide demo accounts' : 'Try a demo account for each role'}
      </button>
      )}
      {showDemo && (
        <ul className="demo-accounts">
          {demoAccounts.accounts.map((account) => (
            <li key={account.email}>
              <span>
                {account.displayName}
                <small> · {roleDetails[account.role as Role].label}</small>
              </span>
              <button type="button" onClick={() => login(account.email, demoAccounts.password)} disabled={submitting}>
                Log in
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// Shown instead of the workspace while a self-registered Community Member
// is waiting for a School Admin or System Admin to approve the account, or
// after that registration was declined. Admin-created accounts skip this.
function PendingApprovalCard({ status }: { status: 'pending' | 'rejected' }) {
  return (
    <article className="login-card">
      <p className="eyebrow">{status === 'pending' ? 'AWAITING APPROVAL' : 'REGISTRATION DECLINED'}</p>
      <h3>{status === 'pending' ? 'Your registration is awaiting approval' : 'Your registration was not approved'}</h3>
      <p className="lede">
        {status === 'pending'
          ? 'A School Admin or System Admin needs to approve your account before you can sign in to SENTINEL. Check back soon.'
          : 'Contact your School Admin or System Admin if you think this is a mistake.'}
      </p>
      <button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </article>
  );
}

function Workspace({ profile, schoolName, email, userType, onProfileChanged }: { profile: Profile; schoolName: string | null; email: string; userType: UserType | null; onProfileChanged: () => Promise<void> }) {
  const details = roleDetails[profile.role];
  const features = useMemo(() => effectiveFeatures(profile.role, userType?.features ?? null), [profile.role, userType]);
  // Community Members (and Classroom Advisers, who are Community Members) get the
  // four big-button tabs; School Admins and System Admins keep their own layout.
  const simplified = profile.role === 'community';
  const nav = navFor(features, simplified);
  // A Classroom Adviser (or any Community Member position with
  // can_approve_own_location) gets the People tab too, scoped to just their
  // own location's pending approvals -- otherwise community accounts never
  // see People at all.
  const isLocationApprover = profile.role === 'community' && userType?.can_approve_own_location === true;
  if (isLocationApprover && !nav.primary.includes('people') && !nav.more.includes('people')) {
    nav.more = [...nav.more, 'people'];
  }
  const tabs = [...nav.primary, ...nav.more];
  const [tab, setTab] = useState<Tab>(nav.primary[0] ?? 'report');
  const [days, setDays] = useState<Range>(14);
  const [template, setTemplate] = useState<AlertTemplate | null>(null);
  const { data, loading, error, reload } = useSchoolData(profile);
  // The map, queue, and My Reports refresh the moment a report is saved.
  useRealtimeReload(reload);
  const refresh = useCallback(() => {
    void reload(true);
  }, [reload]);
  // "Need Support" and "Unsafe" can jump to a category with its dialog already open.
  const [preset, setPreset] = useState<{ tab: Tab; value: string } | null>(null);
  const clearPreset = useCallback(() => setPreset(null), []);
  function go(next: Tab, category?: string) {
    setPreset(category ? { tab: next, value: category } : null);
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const alertsTab: Tab = tabs.includes('know') ? 'know' : 'alerts';
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

      {latestAlert && tabs.includes(alertsTab) && (
        <button type="button" className={`alert-banner sev-${latestAlert.severity}`} onClick={() => setTab(alertsTab)}>
          <span aria-hidden="true">{latestAlert.severity === 'urgent' ? '🚨' : '⚠️'}</span>
          <span>
            <strong>{latestAlert.title}</strong>
            <small>Tap to read</small>
          </span>
        </button>
      )}

      {tabs.length === 0 && <p className="empty-note">Your account has no features turned on yet. Ask your System Admin to set up your position.</p>}

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
        {tab === 'feel' && tabs.includes('feel') && <FeelPanel profile={profile} locations={data.locations} onSent={refresh} onGo={go} />}
        {tab === 'incident' && tabs.includes('incident') && (
          <QuickReport kind="incident" profile={profile} locations={data.locations} preset={preset?.tab === 'incident' ? preset.value : null} onPresetUsed={clearPreset} showSafe={false} onSent={refresh} onSeeReports={() => go('mine')} />
        )}
        {tab === 'help' && tabs.includes('help') && (
          <QuickReport kind="help" profile={profile} locations={data.locations} preset={preset?.tab === 'help' ? preset.value : null} onPresetUsed={clearPreset} showSafe={features.has('report.safe')} onSent={refresh} onSeeReports={() => go('mine')} />
        )}
        {tab === 'know' && tabs.includes('know') && <KnowPanel profile={profile} features={features} data={data} weather={external.weather} quakes={external.quakes} weatherError={external.error} onChanged={reload} />}
        {tab === 'mine' && tabs.includes('mine') && <MyReportsPanel profile={profile} locations={data.locations} incidents={data.incidents} checkIns={data.checkIns} onChanged={refresh} onProfileChanged={onProfileChanged} />}
        {tab === 'report' && tabs.includes('report') && <ReportPanel profile={profile} features={features} locations={data.locations} incidents={data.incidents} checkIns={data.checkIns} onSent={reload} onProfileChanged={onProfileChanged} />}
        {tab === 'map' && tabs.includes('map') && <MapPanel role={profile.role} days={days} onDays={setDays} data={data} />}
        {tab === 'analytics' && tabs.includes('analytics') && (
          <AnalyticsPanel role={profile.role} days={days} onDays={setDays} data={data} weather={external.weather} quakes={external.quakes} weatherError={external.error} onDraftAlert={draftFromInsight} />
        )}
        {tab === 'queue' && tabs.includes('queue') && <QueuePanel data={data} onChanged={reload} />}
        {tab === 'alerts' && tabs.includes('alerts') && (
          <AlertsPanel profile={profile} features={features} data={data} weather={external.weather} quakes={external.quakes} weatherError={external.error} initialTemplate={template} onChanged={reload} />
        )}
        {tab === 'people' && tabs.includes('people') && (isLocationApprover ? <MyLocationApprovals /> : <PeoplePanel profile={profile} data={data} onChanged={reload} />)}
        {tab === 'setup' && tabs.includes('setup') && <SetupPanel profile={profile} features={features} people={data.people} onPeopleChanged={reload} />}
      </div>
    </div>
  );
}

// Items behind the More menu that should not wait: help requests and
// unacknowledged incidents for School Admins.
function urgentCount(role: Role, data: SchoolData): number {
  if (role === 'school_admin') {
    const help = since(data.checkIns, 1, (c) => c.checked_in_at).filter((c) => c.status === 'need_help' && c.triage_status !== 'resolved').length;
    return help + incidentSummary(data.incidents).unacknowledged;
  }
  return 0;
}

// Signed-out landing page: a brand panel (logo, name, tagline) beside the sign-in form.
// The logo is drawn as SVG so it stays sharp at any size.
function SentinelLogo({ className = "auth-logo" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 72" aria-hidden="true">
      <defs>
        <linearGradient id="sentinel-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f9914a" />
          <stop offset="1" stopColor="#e4531c" />
        </linearGradient>
      </defs>
      <path d="M32 2 L60 12 V34 C60 52 47 64 32 70 C17 64 4 52 4 34 V12 Z" fill="url(#sentinel-shield)" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round" />
      <path d="M32 19 C26 27 22 33 22 40 C22 47 26 52 32 52 C38 52 42 47 42 40 C42 33 38 27 32 19 Z" fill="#ffffff" />
      <path d="M32 33 C29 38 28 41 28 44 C28 47 30 49 32 49 C34 49 36 47 36 44 C36 41 35 38 32 33 Z" fill="#f58a3d" />
    </svg>
  );
}

function SignedOutScreen({ themeButton }: { themeButton: ReactNode }) {
  return (
    <main className="auth-shell">
      <aside className="auth-brand">
        <a className="auth-brand-row" href="/" aria-label="SENTINEL sign-in page">
          <SentinelLogo />
          <span className="auth-wordmark">SENTINEL</span>
        </a>
        <p className="auth-tagline">Smart Emergency Network for Tracking Incidents, Notifications, Evaluation, and Logistics</p>
        <span className="auth-rule" aria-hidden="true" />
        <p className="auth-motto">Safe and Motivating Learning Environment.</p>
      </aside>
      <section className="auth-panel">
        {themeButton}
        <div className="auth-panel-inner">
          <AuthCards />
        </div>
      </section>
    </main>
  );
}

export function App() {
  const { session, profile, schoolName, userType, status, refreshProfile } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const themeButton = (
    <button type="button" className="theme-toggle auth-theme" onClick={cycleTheme} aria-label={`Theme: ${THEME_LABELS[theme]}. Switch theme`}>
      <span aria-hidden="true">◐</span> {THEME_LABELS[theme]}
    </button>
  );
  if (status === 'ready' && !session) return <SignedOutScreen themeButton={themeButton} />;

  return (
    <main className={session ? 'signed-in' : undefined}>
      <header>
        <a className="brand" href="#top">
          <SentinelLogo className="brand-logo" /> SENTINEL
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
        {status === 'ready' && !session && <AuthCards />}
        {status === 'ready' && session && profile && profile.status && profile.status !== 'approved' && <PendingApprovalCard status={profile.status} />}
        {status === 'ready' && session && profile && (!profile.status || profile.status === 'approved') && (
          <Workspace key={profile.id + (userType?.id ?? '')} profile={profile} userType={userType} schoolName={schoolName} email={session.user.email ?? ''} onProfileChanged={refreshProfile} />
        )}
        {status === 'ready' && session && !profile && <p className="error-text">Signed in, but no profile was found for this account.</p>}
      </section>
    </main>
  );
}
