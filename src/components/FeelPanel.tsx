import { useState } from 'react';
import { FEELINGS, type Option } from '../lib/catalog';
import { sendSubmission } from '../lib/data';
import { placeLabel } from '../lib/layout';
import type { Location, Profile } from '../lib/types';
import type { Tab } from '../roles';
import { CategoryGrid } from './CategoryGrid';

// Tell Us How You Feel. Tapping a feeling saves it straight away, with the time.
// The comment is optional: whatever is typed goes along with the tap. The place
// is the person's default location when it is still available (a feeling is not
// a location report, so nobody is asked where they are).
export function FeelPanel({ profile, locations, onSent, onGo }: { profile: Profile; locations: Location[]; onSent: () => void; onGo: (tab: Tab, category?: string) => void }) {
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Option | null>(null);

  const defaultId = profile.primary_location_id && locations.some((l) => l.id === profile.primary_location_id) ? profile.primary_location_id : null;

  async function choose(feeling: Option) {
    if (sending) return;
    setSending(true);
    setError('');
    const place = defaultId ? placeLabel(defaultId, locations) : null;
    const note = comment.trim();
    const r = await sendSubmission(profile, {
      kind: 'sentiment',
      subType: feeling.value,
      locationId: defaultId,
      message: `Feeling ${feeling.label.toLowerCase()}${place ? ` at ${place}` : ''}.${note ? ` ${note}` : ''}`,
    });
    setSending(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setComment('');
    setSaved(feeling);
    onSent();
  }

  if (saved) {
    return (
      <section className="report-flow" aria-live="polite">
        <div className="done-card">
          <div className="done-icon" aria-hidden="true">{saved.icon}</div>
          <h2>Thanks for sharing</h2>
          <p>Only School Admins can see how you feel.</p>
          {saved.value === 'need_support' && (
            <button type="button" className="big-button primary" onClick={() => onGo('help', 'counseling_support')}>
              Talk to a counselor
            </button>
          )}
          {saved.value === 'unsafe' && (
            <>
              <p>In danger right now? Go to the nearest teacher.</p>
              <button type="button" className="big-button danger" onClick={() => onGo('help', 'safety_assistance')}>
                Get Safety Assistance
              </button>
              <button type="button" className="big-button secondary" onClick={() => onGo('incident')}>
                Report an incident
              </button>
            </>
          )}
          <button type="button" className="text-button" onClick={() => setSaved(null)}>
            Done
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="quick-report">
      <h2 className="flow-question">How are you feeling today?</h2>
      <p className="fine-print">Tap one. It saves right away.</p>
      <details className="confirm-more feel-comment">
        <summary>Add a comment first (optional)</summary>
        <label className="field">
          <span className="sr-only">Comment</span>
          <textarea rows={2} maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </details>
      <CategoryGrid options={FEELINGS} label="How are you feeling" disabled={sending} onSelect={choose} />
      {sending && <p className="fine-print" aria-live="polite">Saving…</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
