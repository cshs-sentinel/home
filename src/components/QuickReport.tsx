import { useEffect, useState } from 'react';
import { HELP_TYPES, INCIDENT_CATEGORIES, type Option } from '../lib/catalog';
import { checkIn, raiseIncident, sendSubmission } from '../lib/data';
import { placeLabel } from '../lib/layout';
import type { Location, Profile } from '../lib/types';
import { CategoryGrid } from './CategoryGrid';
import { ConfirmReportDialog } from './ConfirmReportDialog';

export type QuickKind = 'incident' | 'help' | 'suggestion';

const SAFE: Option = { value: 'safe', label: "I'm safe", icon: '✅' };
const SUGGESTION: Option = { value: 'suggestion', label: 'Suggestion', icon: '💡' };

type Done = { title: string; detail: string };

const INTRO: Record<QuickKind, { title: string; hint: string }> = {
  incident: { title: 'What do you want to report?', hint: 'Tap what you saw, then confirm the place.' },
  help: { title: 'What kind of help do you need?', hint: 'Tap what you need, then confirm where you are.' },
  suggestion: { title: 'Share an idea or concern', hint: 'Not urgent? Tell the school team what could be better.' },
};

// One tap on a category, one confirmation, done. Used for Report an Incident,
// Get Help, and Suggestion: the only differences are the buttons and what is saved.
export function QuickReport({
  kind,
  profile,
  locations,
  preset = null,
  onPresetUsed,
  showSafe = false,
  onSent,
  onSeeReports,
}: {
  kind: QuickKind;
  profile: Profile;
  locations: Location[];
  /** a category value to open straight away (for example from "Need Support") */
  preset?: string | null;
  onPresetUsed?: () => void;
  showSafe?: boolean;
  onSent: () => void;
  onSeeReports?: () => void;
}) {
  const options = kind === 'incident' ? INCIDENT_CATEGORIES : kind === 'help' ? HELP_TYPES : [];
  const [picked, setPicked] = useState<Option | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!preset) return;
    const match = options.find((o) => o.value === preset);
    if (match) setPicked(match);
    onPresetUsed?.();
  }, [preset, options, onPresetUsed]);

  async function send(option: Option, locationId: string, note: string): Promise<string | null> {
    const place = placeLabel(locationId, locations);
    if (option.value === 'safe') {
      const r = await checkIn(profile, 'safe', locationId);
      if (r.error) return r.error;
      finish({ title: 'Thanks for checking in', detail: `You are marked safe at ${place}.` });
    } else if (option.value === 'suggestion') {
      const r = await sendSubmission(profile, { kind: 'observation', subType: 'suggestion', locationId, message: note });
      if (r.error) return r.error;
      finish({ title: 'Thanks for the suggestion', detail: 'The school team will read it.' });
    } else if (kind === 'incident') {
      const description = `${option.label} reported at ${place} using quick report.${note ? `\n\nDetail: ${note}` : ''}`;
      const r = await raiseIncident(profile, { category: option.value, locationId, description });
      if (r.error) return r.error;
      finish({ title: 'Report sent', detail: `${r.caseRef ? `${r.caseRef} · ` : ''}A School Admin will review it.` });
    } else {
      const r = await checkIn(profile, 'need_help', locationId, option.value);
      if (r.error) return r.error;
      finish({
        title: 'Help request sent',
        detail: r.triage === 'urgent' ? 'Help is on the way. If you are in danger, go to the nearest teacher now.' : 'The safety team will get back to you.',
      });
    }
    return null;
  }

  function finish(result: Done) {
    setPicked(null);
    setDone(result);
    onSent();
  }

  if (done) {
    return (
      <section className="report-flow" aria-live="polite">
        <div className="done-card">
          <div className="done-icon" aria-hidden="true">✓</div>
          <h2>{done.title}</h2>
          <p>{done.detail}</p>
          <button type="button" className="big-button primary" onClick={() => setDone(null)}>
            Done
          </button>
          {onSeeReports && (
            <button type="button" className="text-button" onClick={onSeeReports}>
              See My Reports
            </button>
          )}
        </div>
      </section>
    );
  }

  const intro = INTRO[kind];

  return (
    <section className="quick-report">
      <h2 className="flow-question">{intro.title}</h2>
      <p className="fine-print">{intro.hint}</p>

      {kind === 'suggestion' ? (
        <button type="button" className="big-button primary" onClick={() => setPicked(SUGGESTION)}>
          💡 Write a suggestion
        </button>
      ) : (
        <CategoryGrid options={options} label={kind === 'incident' ? 'Incident categories' : 'Help categories'} tone={kind === 'incident' ? 'warn' : 'danger'} onSelect={setPicked} />
      )}

      {kind === 'incident' && (
        <button type="button" className="text-button quiet-link" onClick={() => setPicked(SUGGESTION)}>
          Not urgent? Send a suggestion instead
        </button>
      )}
      {kind === 'help' && showSafe && (
        <button type="button" className="text-button quiet-link" onClick={() => setPicked(SAFE)}>
          ✅ Not asking for help? Check in as safe
        </button>
      )}

      {picked && (
        <ConfirmReportDialog
          option={picked}
          locations={locations}
          defaultLocationId={profile.primary_location_id}
          confirmLabel={picked.value === 'safe' ? 'Check in' : picked.value === 'suggestion' ? 'Send' : kind === 'incident' ? 'Confirm Report' : 'Confirm Help Request'}
          note={picked.value === 'suggestion' ? 'required' : kind === 'incident' && picked.value !== 'safe' ? 'optional' : 'none'}
          onConfirm={(locationId, note) => send(picked, locationId, note)}
          onCancel={() => setPicked(null)}
        />
      )}
    </section>
  );
}
