import type { SchoolData } from '../lib/data';
import type { Profile } from '../lib/types';
import type { Feature } from '../lib/features';
import type { Quake, WeatherSnapshot } from '../lib/weather';
import { AlertsPanel } from './AlertsPanel';
import { WeatherPanel } from './WeatherPanel';

// General-purpose guidance that is true for any school. Anything specific to
// this campus belongs in an announcement from a School Admin (shown above).
const PROCEDURES: { icon: string; title: string; steps: string[] }[] = [
  {
    icon: '🔥',
    title: 'Fire or smoke',
    steps: ['Stay calm and leave by the nearest safe exit.', 'Do not use elevators and do not go back inside for belongings.', 'Go to your assembly area and tell your teacher you are out.', 'Report it: Report › Fire / Smoke, or Get Help › Emergency Help.'],
  },
  {
    icon: '🌏',
    title: 'Earthquake',
    steps: ['Drop, Cover, and Hold On under a sturdy desk or table.', 'Stay away from windows, shelves, and anything that can fall.', 'When the shaking stops, leave calmly if it is safe and go to the open assembly area.', 'Expect aftershocks. Wait for the all-clear before going back in.'],
  },
  {
    icon: '🔒',
    title: 'Threat or lockdown',
    steps: ['Follow your teacher or staff member. Do not wait to be sure.', 'Move away from doors and windows, stay quiet, and silence your phone.', 'Do not open the door until the all-clear comes from someone you know.', 'If you can do so safely: Get Help › Emergency Help.'],
  },
  {
    icon: '🩺',
    title: 'Someone is hurt',
    steps: ['Tell the nearest teacher or staff member right away.', 'Do not move a seriously hurt person unless they are in danger.', 'Use Get Help › Medical Assistance so responders know where to come.'],
  },
  {
    icon: '🌧️',
    title: 'Flood or severe weather',
    steps: ['Move to a higher or interior part of the building, away from windows.', 'Stay out of floodwater and away from fallen power lines.', 'Watch the advisories and announcements on this page.'],
  },
];

const REMINDERS = [
  'Know two ways out of every room you use.',
  'Report hazards early: a loose wire or a blocked exit is easier to fix before anyone gets hurt.',
  'Check the weather advisory above before outdoor activities, especially on hot days.',
  'If something feels wrong, tell a trusted adult. You never have to wait until you are sure.',
];

type Props = {
  profile: Profile;
  features: Set<Feature>;
  data: SchoolData;
  weather: WeatherSnapshot | null;
  quakes: Quake[];
  weatherError: string;
  onChanged: () => Promise<void>;
};

// Things You Need to Know Now: the weather, school alerts and announcements,
// then one collapsible safety guide (reminders and emergency procedures).
export function KnowPanel({ profile, features, data, weather, quakes, weatherError, onChanged }: Props) {
  return (
    <div className="know">
      <WeatherPanel weather={weather} quakes={quakes} error={weatherError} />
      <AlertsPanel profile={profile} features={features} data={data} initialTemplate={null} onChanged={onChanged} />

      <section className="card">
        <h2 className="section-title">Safety guide</h2>
        <div className="procedure-list">
          <details className="procedure">
            <summary>
              <span aria-hidden="true">✅</span> Everyday reminders
            </summary>
            <ul>
              {REMINDERS.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
          {PROCEDURES.map((p) => (
            <details key={p.title} className="procedure">
              <summary>
                <span aria-hidden="true">{p.icon}</span> {p.title}
              </summary>
              <ol>
                {p.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </details>
          ))}
        </div>
        <p className="fine-print">General guidance. Your school may post its own procedures as an alert.</p>
      </section>
    </div>
  );
}
