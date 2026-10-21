import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { roleDetails, ROLE_ORDER, type Role } from './roles';
import demoAccounts from './demo-accounts.json';
import { useTheme } from './theme';

type Profile = { role: Role; display_name: string | null; school_id: string | null };

const stats = [['86%', 'Survey response rate'], ['12', 'Reports being handled'], ['4', 'Pending approvals']];

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

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setSchoolName(null);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    supabase
      .from('profiles')
      .select('role, display_name, school_id')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setProfile(null);
          setStatus('ready');
          return;
        }
        setProfile(data as Profile);
        if (data.school_id) {
          supabase
            .from('schools')
            .select('name')
            .eq('id', data.school_id)
            .single()
            .then(({ data: school }) => {
              setSchoolName(school?.name ?? null);
              setStatus('ready');
            });
        } else {
          setStatus('ready');
        }
      });
  }, [session]);

  return { session, profile, schoolName, status };
}

function LoginCard({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  async function login(loginEmail: string, loginPassword: string) {
    setSubmitting(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    onLoggedIn();
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
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
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

function RoleDashboard({ profile, schoolName, email }: { profile: Profile; schoolName: string | null; email: string }) {
  const details = roleDetails[profile.role];
  return (
    <article className="dashboard">
      <div className="role-symbol">{details.icon}</div>
      <div>
        <p className="eyebrow">{details.label}</p>
        <h3>{details.summary}</h3>
        <ul>
          {details.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </div>
      <aside>
        <span className="status">Signed in</span>
        <strong>{profile.display_name ?? email}</strong>
        <p>{schoolName ?? 'No school assigned'}</p>
        <p className="fine-print">Dashboard content is a preview — data shown is illustrative, not live.</p>
      </aside>
    </article>
  );
}

export function App() {
  const { session, profile, schoolName, status } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [notice, setNotice] = useState('');

  async function signOut() {
    await supabase.auth.signOut();
    setNotice('');
  }

  return (
    <main>
      <header>
        <a className="brand" href="#top">
          <span>◈</span> SENTINEL
        </a>
        <div className="header-actions">
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? '☀' : '☾'} {theme === 'dark' ? 'Light' : 'Dark'} mode
          </button>
          {session ? (
            <button className="secondary" onClick={signOut}>
              Sign out
            </button>
          ) : (
            <span className="tag">Safer schools. Stronger voices.</span>
          )}
        </div>
      </header>
      <section className="hero" id="top">
        <p className="eyebrow">SCHOOL SAFETY & LEARNING ENVIRONMENT</p>
        <h1>Every voice can help build a safer school.</h1>
        <p className="lede">
          SENTINEL brings surveys, incident reporting, alerts, and safety action together in one trusted place.
        </p>
        {!session && (
          <button onClick={() => setNotice('Log in below, or try a demo account for any role.')}>
            Explore the preview <span>→</span>
          </button>
        )}
        {notice && <p className="notice">{notice}</p>}
      </section>
      <section className="role-section" aria-labelledby="roles-heading">
        <p className="eyebrow">ROLE-BASED ACCESS</p>
        <h2 id="roles-heading">One system, clear responsibilities.</h2>
        {status === 'loading' && <p>Loading your dashboard…</p>}
        {status === 'ready' && !session && <LoginCard onLoggedIn={() => setNotice('')} />}
        {status === 'ready' && session && profile && (
          <RoleDashboard profile={profile} schoolName={schoolName} email={session.user.email ?? ''} />
        )}
        {status === 'ready' && session && !profile && (
          <p className="error-text">Signed in, but no profile was found for this account.</p>
        )}
        <div className="role-tabs" role="list" aria-label="All roles in SENTINEL">
          {ROLE_ORDER.map((role) => (
            <span className={profile?.role === role ? 'active' : ''} key={role}>
              {roleDetails[role].label}
            </span>
          ))}
        </div>
      </section>
      <section className="pulse">
        <p className="eyebrow">SCHOOL PULSE</p>
        <h2>See concerns early. Respond with confidence.</h2>
        <div className="stats">
          {stats.map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report">
        <div>
          <p className="eyebrow">COMMUNITY REPORTING</p>
          <h2>See something unsafe?</h2>
          <p>Report a hazard, safety concern, or wellbeing issue. You can choose to share contact details or submit anonymously.</p>
        </div>
        <button onClick={() => setNotice('Preview: this will open the secure incident and hazard report form.')}>
          Make a report <span>→</span>
        </button>
      </section>
      <footer>
        © 2026 SENTINEL <span>•</span> Safe, respectful, and motivating learning environments
      </footer>
    </main>
  );
}
