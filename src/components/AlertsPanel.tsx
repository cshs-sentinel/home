import { useEffect, useState } from 'react';
import { ALERT_TEMPLATES, type AlertTemplate } from '../lib/analytics';
import { alertAction, draftAlert, type SchoolData } from '../lib/data';
import type { Alert, Profile } from '../lib/types';
import type { Quake, WeatherSnapshot } from '../lib/weather';
import { ROLE_ORDER, roleDetails, type Role } from '../roles';
import { WeatherPanel } from './WeatherPanel';
import { timeAgo } from './QueuePanel';

const TEMPLATE_BUTTONS: { key: AlertTemplate; label: string; icon: string }[] = [
  { key: 'heat', label: 'Heat', icon: '🌡️' },
  { key: 'rain', label: 'Rain', icon: '🌧️' },
  { key: 'wind', label: 'Wind', icon: '💨' },
  { key: 'quake', label: 'Earthquake', icon: '🌏' },
  { key: 'wellbeing', label: 'Wellbeing', icon: '💚' },
];

const SEVERITY_ICON: Record<Alert['severity'], string> = { info: 'ℹ️', advisory: '⚠️', urgent: '🚨' };

type Props = {
  profile: Profile;
  data: SchoolData;
  weather: WeatherSnapshot | null;
  quakes: Quake[];
  weatherError: string;
  initialTemplate: AlertTemplate | null;
  onChanged: () => Promise<void>;
};

export function AlertsPanel({ profile, data, weather, quakes, weatherError, initialTemplate, onChanged }: Props) {
  const canDraft = profile.role === 'drrm' || profile.role === 'school_admin';
  const isAdmin = profile.role === 'school_admin';
  const published = data.alerts.filter((a) => a.status === 'published');
  const pending = data.alerts.filter((a) => a.status === 'draft' || a.status === 'approved');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function act(alert: Alert, action: 'approve_alert' | 'publish_alert' | 'cancel_alert') {
    setBusy(alert.id);
    setError('');
    const r = await alertAction(alert.id, action);
    if (r.error) setError(r.error);
    else await onChanged();
    setBusy(null);
  }

  return (
    <div className="alerts">
      <WeatherPanel weather={weather} quakes={quakes} error={weatherError} compact />

      <section>
        <h2 className="section-title">School alerts</h2>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {published.length === 0 ? (
          <p className="empty-note">No alerts right now.</p>
        ) : (
          <ul className="alert-list">
            {published.map((a) => (
              <li key={a.id} className={`alert-item sev-${a.severity}`}>
                <span className="queue-icon" aria-hidden="true">{SEVERITY_ICON[a.severity]}</span>
                <div className="queue-main">
                  <strong>{a.title}</strong>
                  <p>{a.body}</p>
                  <small>
                    {a.severity[0].toUpperCase() + a.severity.slice(1)} · {a.published_at ? timeAgo(a.published_at) : ''}
                  </small>
                </div>
                {isAdmin && (
                  <button type="button" className="action-small" disabled={busy === a.id} onClick={() => act(a, 'cancel_alert')}>
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDraft && <Composer profile={profile} initialTemplate={initialTemplate} onSaved={onChanged} />}

      {canDraft && (
        <section>
          <h2 className="section-title">Waiting for approval</h2>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {pending.length === 0 ? (
            <p className="empty-note">Nothing waiting.</p>
          ) : (
            <ul className="queue-list">
              {pending.map((a) => (
                <li key={a.id} className="queue-item">
                  <span className="queue-icon" aria-hidden="true">{SEVERITY_ICON[a.severity]}</span>
                  <div className="queue-main">
                    <strong>{a.title}</strong>
                    <small>
                      {a.status} · {audienceLabel(a)} · {timeAgo(a.created_at)}
                    </small>
                  </div>
                  <div className="queue-actions">
                    {isAdmin && a.status === 'draft' && (
                      <button type="button" className="action-small primary" disabled={busy === a.id} onClick={() => act(a, 'approve_alert')}>
                        Approve
                      </button>
                    )}
                    {isAdmin && a.status === 'approved' && (
                      <button type="button" className="action-small primary" disabled={busy === a.id} onClick={() => act(a, 'publish_alert')}>
                        Publish
                      </button>
                    )}
                    {(isAdmin || (a.status === 'draft' && a.created_by === profile.id)) && (
                      <button type="button" className="action-small" disabled={busy === a.id} onClick={() => act(a, 'cancel_alert')}>
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Composer({ profile, initialTemplate, onSaved }: { profile: Profile; initialTemplate: AlertTemplate | null; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Alert['severity']>('advisory');
  const [scope, setScope] = useState<Alert['target_scope']>('all');
  const [targetRole, setTargetRole] = useState<Role>('student');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  function applyTemplate(key: AlertTemplate) {
    const t = ALERT_TEMPLATES[key];
    setTitle(t.title);
    setBody(t.body);
    setSeverity(t.severity);
    setScope('all');
    setMessage('');
  }

  useEffect(() => {
    if (initialTemplate) applyTemplate(initialTemplate);
  }, [initialTemplate]);

  async function save() {
    setSaving(true);
    setMessage('');
    const r = await draftAlert(profile, { title, body, severity, targetScope: scope, targetRole: scope === 'role' ? targetRole : null });
    setSaving(false);
    if (r.error) {
      setMessage(r.error);
      return;
    }
    setTitle('');
    setBody('');
    setMessage(profile.role === 'school_admin' ? 'Draft saved. Approve and publish it below.' : 'Draft saved. A School Admin must approve it before it is published.');
    onSaved();
  }

  return (
    <section className="composer">
      <h2 className="section-title">New alert</h2>
      <div className="chip-row" role="group" aria-label="Start from a template">
        {TEMPLATE_BUTTONS.map((t) => (
          <button type="button" key={t.key} className="filter-button" onClick={() => applyTemplate(t.key)}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <label className="field">
        Title
        <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Message
        <textarea value={body} rows={4} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="chip-row" role="group" aria-label="Severity">
        {(['info', 'advisory', 'urgent'] as const).map((s) => (
          <button type="button" key={s} className={`filter-button${severity === s ? ' is-active' : ''}`} aria-pressed={severity === s} onClick={() => setSeverity(s)}>
            {SEVERITY_ICON[s]} {s}
          </button>
        ))}
      </div>
      <div className="chip-row" role="group" aria-label="Audience">
        {(['all', 'responders', 'role'] as const).map((s) => (
          <button type="button" key={s} className={`filter-button${scope === s ? ' is-active' : ''}`} aria-pressed={scope === s} onClick={() => setScope(s)}>
            {s === 'all' ? 'Everyone' : s === 'responders' ? 'Responders' : 'One role'}
          </button>
        ))}
        {scope === 'role' && (
          <select className="role-select" value={targetRole} onChange={(e) => setTargetRole(e.target.value as Role)} aria-label="Role">
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {roleDetails[r].label}
              </option>
            ))}
          </select>
        )}
      </div>
      {message && <p className="notice">{message}</p>}
      <button type="button" className="big-button primary" disabled={saving || title.trim().length < 3 || body.trim().length < 3} onClick={save}>
        {saving ? 'Saving…' : 'Save draft'}
      </button>
    </section>
  );
}

function audienceLabel(a: Alert): string {
  if (a.target_scope === 'all') return 'Everyone';
  if (a.target_scope === 'responders') return 'Responders';
  return a.target_role ? roleDetails[a.target_role].label : 'One role';
}
