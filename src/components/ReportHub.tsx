import { useCallback, useState } from 'react';
import type { Feature } from '../lib/features';
import type { Location, Profile } from '../lib/types';
import type { Tab } from '../roles';
import { FeelPanel } from './FeelPanel';
import { QuickReport } from './QuickReport';

type Section = 'incident' | 'help' | 'feel' | 'suggestion';

const SECTIONS: { key: Section; label: string; feature: (has: (f: Feature) => boolean) => boolean }[] = [
  { key: 'incident', label: 'Report incident', feature: (has) => has('report.incident') || has('report.hazard') },
  { key: 'help', label: 'Get help', feature: (has) => has('report.help') || has('report.safe') },
  { key: 'feel', label: 'Feel', feature: (has) => has('report.feeling') },
  { key: 'suggestion', label: 'Suggestion', feature: (has) => has('report.observation') || has('report.hazard') },
];

// The Report tab for School Admins and System Admins: the same button flows
// Community Members use, one at a time behind a small switcher.
export function ReportHub({ profile, features, locations, onSent }: { profile: Profile; features: Set<Feature>; locations: Location[]; onSent: () => void }) {
  const sections = SECTIONS.filter((s) => s.feature((f) => features.has(f)));
  const [section, setSection] = useState<Section>(sections[0]?.key ?? 'incident');
  const [preset, setPreset] = useState<string | null>(null);
  const clearPreset = useCallback(() => setPreset(null), []);

  // "Need Support" and "Unsafe" on the Feel screen jump to Help or Incident here.
  function go(tab: Tab, category?: string) {
    if (tab === 'help' || tab === 'incident') {
      setPreset(category ?? null);
      setSection(tab);
    }
  }

  if (sections.length === 0) return <p className="empty-note">Reporting is not turned on for your position.</p>;

  return (
    <div className="report-hub">
      {sections.length > 1 && (
        <div className="segmented" role="group" aria-label="What to send">
          {sections.map((s) => (
            <button type="button" key={s.key} className={`filter-button${section === s.key ? ' is-active' : ''}`} aria-pressed={section === s.key} onClick={() => setSection(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {section === 'feel' && <FeelPanel profile={profile} locations={locations} onSent={onSent} onGo={go} />}
      {section !== 'feel' && (
        <QuickReport key={section} kind={section} profile={profile} locations={locations} preset={preset} onPresetUsed={clearPreset} showSafe={features.has('report.safe')} onSent={onSent} />
      )}
    </div>
  );
}
