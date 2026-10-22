import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { roleDetails, TAB_LABELS, type Role, type Tab } from './roles';
import demoAccounts from './demo-accounts.json';
import { THEME_LABELS, useTheme } from './theme';
import type { Profile } from './lib/types';
import { useExternalData, useSchoolData } from './lib/data';
import type { AlertTemplate } from './lib/analytics';
import { ReportPanel } from './components/ReportPanel';
import { InsightsPanel } from './components/InsightsPanel';
import { QueuePanel } from './components/QueuePanel';
import { AlertsPanel } from './components/AlertsPanel';
import { PeoplePanel } from './components/PeoplePanel';

function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schoolName, setSchoolName] = useState<string | null>(null);
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
      setStatus('ready');
      return;
    }
    setStatus('loading');
    supabase
      .from('profiles')
      .select('id, role, display_name, school_id')
      .eq('id', userId)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) {
          setProfile(null);
          setStatus('ready');
          return;
        }
        setProfile(data as Profile);
        if (data.school_id) {
          const { data: school } = await supabase.from('schools').select('name').eq('id', data.school_id).single();
          setSchoolName(school?.name ?? null);
        }
        setStatus('ready');
      });
  }, [userId]);

  return { session, profile, schoolName, status };
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

function Workspace({ profile, schoolName, email }: { profile: Profile; schoolName: string | null; email: string }) {
  const details = roleDetails[profile.role];
  const [tab, setTab] = useState<Tab>(details.tabs[0]);
  const [template, setTemplate] = useState<AlertTemplate | null>(null);
  const { data, loading, error, reload } = useSchoolData(profile);
  const external = useExternalData();
  const latestAlert = data.alerts.find((a) => a.status === 'published' && a.severity !== 'info');

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
          <p className="eyebrow">{details.label.toUpperCase()}</p>
          <h1>Hi, {profile.display_name ?? email}</h1>
          <p className="lede">
            {details.summary}
            {schoolName ? ` · ${schoolName}` : ''}
          </p>
        </div>
      </div>

      {latestAlert && (
        <button type="button" className={`alert-banner sev-${latestAlert.severity}`} onClick={() => setTab('alerts')}>
          <span aria-hidden="true">{latestAlert.severity === 'urgent' ? '🚨' : '⚠️'}</span>
          <span>
            <strong>{latestAlert.title}</strong>
            <small>Tap to read</small>
          </span>
        </button>
      )}

      {details.tabs.length > 1 && (
        <nav className="tab-bar" aria-label="Sections">
          {details.tabs.map((t) => (
            <button type="button" key={t} className={`tab-button${tab === t ? ' is-active' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
              <span aria-hidden="true">{TAB_LABELS[t].icon}</span>
              <span>{TAB_LABELS[t].label}</span>
            </button>
          ))}
        </nav>
      )}

      {error && <p className="error-text">Some data could not load: {error}</p>}
      <div className={`panel${loading ? ' is-loading' : ''}`}>
        {tab === 'report' && <ReportPanel profile={profile} locations={data.locations} incidents={data.incidents} checkIns={data.checkIns} onSent={reload} />}
        {tab === 'insights' && (
          <InsightsPanel role={profile.role} data={data} weather={external.weather} quakes={external.quakes} weatherError={external.error} onDraftAlert={draftFromInsight} />
        )}
        {tab === 'queue' && <QueuePanel role={profile.role} data={data} onChanged={reload} />}
        {tab === 'alerts' && (
          <AlertsPanel profile={profile} data={data} weather={external.weather} quakes={external.quakes} weatherError={external.error} initialTemplate={template} onChanged={reload} />
        )}
        {tab === 'people' && <PeoplePanel profile={profile} data={data} onChanged={reload} />}
      </div>
    </div>
  );
}

export function App() {
  const { session, profile, schoolName, status } = useAuth();
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
        {status === 'ready' && session && profile && <Workspace key={profile.id} profile={profile} schoolName={schoolName} email={session.user.email ?? ''} />}
        {status === 'ready' && session && !profile && <p className="error-text">Signed in, but no profile was found for this account.</p>}
      </section>
    </main>
  );
}
