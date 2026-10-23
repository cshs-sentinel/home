import { useEffect, useState } from 'react';
import { HELP_TYPES, INCIDENT_CATEGORIES, type Option } from '../lib/catalog';
import { checkIn, raiseIncident } from '../lib/data';
import { placeLabel } from '../lib/layout';
import type { Location, Profile } from '../lib/types';
import { CategoryGrid } from './CategoryGrid';
import { ConfirmReportDialog } from './ConfirmReportDialog';

type Kind = 'incident' | 'help';

const SAFE: Option = { value: 'safe', label: "I'm safe", icon: '✅' };

type Done = { title: string; detail: string };

// One tap on a category, one confirmation, done. Used for both Report an
// Incident and Get Help: the only differences are the buttons and what is saved.
export function QuickReport({
  kind,
  profile,
  locations,
  preset,
  onPresetUsed,
  showSafe,
  onSent,
  onSeeReports,
}: {
  kind: Kind;
  profile: Profile;
  locations: Location[];
  /** a category value to open straight away (for example from "Need Support") */
  preset: string | null;
  onPresetUsed: () => void;
  showSafe: boolean;
  onSent: () => void;
  onSeeReports: () => void;
}) {
  const options = kind === 'incident' ? INCIDENT_CATEGORIES : HELP_TYPES;
  const [picked, setPicked] = useState<Option | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!preset) return;
    const match = options.find((o) => o.value === preset);
    if (match) setPicked(match);
    onPresetUsed();
  }, [preset, options, onPresetUsed]);

  async function send(option: Option, locationId: string, note: string): Promise<string | null> {
    const place = placeLabel(locationId, locations);
    if (option.value === 'safe') {
      const r = await checkIn(profile, 'safe', locationId);
      if (r.error) return r.error;
      finish({ title: 'Thanks for checking in', detail: `You are marked safe at ${place}.` });
    } else if (kind === 'incident') {
      const description = `${option.label} reported at ${place} using quick report.${note ? `\n\nDetail: ${note}` : ''}`;
      const r = await raiseIncident(profile, { category: option.value, locationId, description });
      if (r.error) return r.error;
      finish({
        title: `Report ${r.caseRef ?? ''} sent`.replace('  ', ' '),
        detail: `${option.label} at ${place}. Status: Pending evaluation. An authorized School Admin has been notified to review it. You can follow it under My Reports.`,
      });
    } else {
      const r = await checkIn(profile, 'need_help', locationId, option.value);
      if (r.error) return r.error;
      finish({
        title: 'Help request sent',
        detail:
          r.triage === 'urgent'
            ? `${option.label} at ${place} is marked urgent and responders can see it now. If you are in danger, go to the nearest teacher or staff member.`
            : `${option.label} at ${place} is with the safety team and will be triaged. You can follow it under My Reports.`,
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
          <button type="button" className="big-button ghost" onClick={onSeeReports}>
            See My Reports
          </button>
        </div>
      </section>
    );
  }

  const defaultId = profile.primary_location_id;

  return (
    <section className="quick-report">
      <h2 className="flow-question">{kind === 'incident' ? 'What do you want to report?' : 'What kind of help do you need?'}</h2>
      <p className="fine-print">
        {kind === 'incident'
          ? 'Tap what you saw. You will confirm the place before anything is sent.'
          : 'Tap what you need. You will confirm where you are before anything is sent. If you are in danger, tell the nearest teacher or staff member too.'}
      </p>
      <CategoryGrid options={options} label={kind === 'incident' ? 'Incident categories' : 'Help categories'} tone={kind === 'incident' ? 'warn' : 'danger'} onSelect={setPicked} />

      {kind === 'help' && showSafe && (
        <div className="safe-row">
          <p className="fine-print">Not asking for help? Let your school know you are fine.</p>
          <button type="button" className="action-small" onClick={() => setPicked(SAFE)}>
            ✅ I'm safe
          </button>
        </div>
      )}

      {picked && (
        <ConfirmReportDialog
          heading={picked.value === 'safe' ? 'Check in' : kind === 'incident' ? 'Report an incident' : 'Get help'}
          option={picked}
          locations={locations}
          defaultLocationId={defaultId}
          confirmLabel={picked.value === 'safe' ? 'Confirm check-in' : kind === 'incident' ? 'Confirm Report' : 'Confirm Help Request'}
          allowNote={kind === 'incident' && picked.value !== 'safe'}
          onConfirm={(locationId, note) => send(picked, locationId, note)}
          onCancel={() => setPicked(null)}
        />
      )}
    </section>
  );
}
