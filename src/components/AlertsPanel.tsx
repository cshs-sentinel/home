import { useEffect, useState } from 'react';
import { ALERT_TEMPLATES, type AlertTemplate } from '../lib/analytics';
import { alertAction, draftAlert, type SchoolData } from '../lib/data';
import type { Alert, Profile } from '../lib/types';
import type { Feature } from '../lib/features';
import { ROLE_ORDER, roleDetails, type Role } from '../roles';
import { timeAgo } from './QueuePanel';

const TEMPLATE_BUTTONS: { key: AlertTemplate; label: string; icon: string }[] = [
  { key: 'heat', label: 'Heat', icon: '🌡️' },
  { key: 'rain', label: 'Rain', icon: '🌧️' },
  { key: 'wind', label: 'Wind', icon: '💨' },
  { key: 'quake', label: 'Earthquake', icon: '🌏' },
  { key: 'wellbeing', label: 'Wellbeing', icon: '💚' },
];

const SEVERITY: Record<Alert['severity'], { icon: string; label: string }> = {
  info: { icon: 'ℹ️', label: 'Info' },
  advisory: { icon: '⚠️', label: 'Advisory' },
  urgent: { icon: '🚨', label: 'Urgent' },
};

const PENDING_STATUS: Partial<Record<Alert['status'], string>> = { draft: 'Draft', approved: 'Approved, not published' };

type Props = {
  profile: Profile;
  features: Set<Feature>;
  data: SchoolData;
  initialTemplate: AlertTemplate | null;
  onChanged: () => Promise<void>;
};

// School alerts. Staff who can draft see drafts waiting for approval first and
// open the composer only when they need it; everyone else just reads alerts.
export function AlertsPanel({ profile, features, data, initialTemplate, onChanged }: Props) {
  const canDraft = features.has('alerts.draft');
  const isAdmin = features.has('alerts.approve');
  const published = data.alerts.filter((a) => a.status === 'published');
  const pending = data.alerts.filter((a) => a.status === 'draft' || a.status === 'approved');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(initialTemplate !== null);

  useEffect(() => {
    if (initialTemplate) setComposing(true);
  }, [initialTemplate]);

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
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {canDraft && pending.length > 0 && (
        <section className="card">
          <h2 className="section-title">Waiting for approval</h2>
          <ul className="queue-list">
            {pending.map((a) => (
              <li key={a.id} className="queue-item">
                <span className="queue-icon" aria-hidden="true">{SEVERITY[a.severity].icon}</span>
                <div className="queue-main">
                  <strong>{a.title}</strong>
                  <small>
                    {PENDING_STATUS[a.status]} · {audienceLabel(a)} · {timeAgo(a.created_at)}
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
                    <button type="button" className="text-button" disabled={busy === a.id} onClick={() => act(a, 'cancel_alert')}>
                      Discard
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canDraft &&
        (composing ? (
          <Composer profile={profile} initialTemplate={initialTemplate} onSaved={onChanged} onClose={() => setComposing(false)} />
        ) : (
          <button type="button" className="action-small primary new-alert" onClick={() => setComposing(true)}>
            + New alert
          </button>
        ))}

      <section className="card">
        <h2 className="section-title">School alerts</h2>
        {published.length === 0 ? (
          <p className="empty-note">No alerts right now.</p>
        ) : (
          <ul className="alert-list">
            {published.map((a) => (
              <li key={a.id} className={`alert-item sev-${a.severity}`}>
                <span className="queue-icon" aria-hidden="true">{SEVERITY[a.severity].icon}</span>
                <div className="queue-main">
                  <strong>{a.title}</strong>
                  <p>{a.body}</p>
                  <small>
                    {SEVERITY[a.severity].label} · {a.published_at ? timeAgo(a.published_at) : ''}
                  </small>
                </div>
                {isAdmin && (
                  <button type="button" className="text-button" disabled={busy === a.id} onClick={() => act(a, 'cancel_alert')}>
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Composer({ profile, initialTemplate, onSaved, onClose }: { profile: Profile; initialTemplate: AlertTemplate | null; onSaved: () => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Alert['severity']>('advisory');
  const [scope, setScope] = useState<Alert['target_scope']>('all');
  const [targetRole, setTargetRole] = useState<Role>('community');
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
    setMessage(profile.role === 'school_admin' ? 'Draft saved. Approve and publish it above.' : 'Draft saved. A School Admin will approve it.');
    onSaved();
  }

  return (
    <section className="card composer">
      <div className="card-head">
        <h2 className="section-title">New alert</h2>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </div>
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
      <div className="form-grid">
        <label className="field">
          Severity
          <select className="role-select" value={severity} onChange={(e) => setSeverity(e.target.value as Alert['severity'])}>
            {(['info', 'advisory', 'urgent'] as const).map((s) => (
              <option key={s} value={s}>
                {SEVERITY[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Audience
          <select className="role-select" value={scope === 'role' ? `role:${targetRole}` : scope} onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('role:')) {
              setScope('role');
              setTargetRole(v.slice(5) as Role);
            } else setScope(v as Alert['target_scope']);
          }}>
            <option value="all">Everyone</option>
            <option value="responders">School Admins</option>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={`role:${r}`}>
                Only {roleDetails[r].label}s
              </option>
            ))}
          </select>
        </label>
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
  if (a.target_scope === 'responders') return 'School Admins';
  return a.target_role ? `Only ${roleDetails[a.target_role].label}s` : 'One role';
}
