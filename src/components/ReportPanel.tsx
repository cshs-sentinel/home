import { useState } from 'react';
import { EMOTIONS, HAZARDS, INCIDENTS, OBSERVATIONS, STRESS_LEVELS, iconFor, labelFor, type Option } from '../lib/catalog';
import { checkIn, raiseIncident, sendSubmission, transitionIncident } from '../lib/data';
import { OPEN_INCIDENT } from '../lib/analytics';
import type { CheckIn, Incident, Location, Profile } from '../lib/types';
import type { Feature } from '../lib/features';
import { placeLabel } from '../lib/layout';
import { DefaultLocationCard } from './DefaultLocationCard';
import { PlacePicker } from './PlacePicker';

type Flow = 'feel' | 'hazard' | 'incident' | 'observation' | 'safe' | 'help';
type Step = 'choice' | 'stress' | 'location' | 'review';

const FLOWS: { flow: Flow; label: string; hint: string; icon: string; tone: string }[] = [
  { flow: 'help', label: 'I need help', hint: 'Tell responders where you are', icon: '🆘', tone: 'danger' },
  { flow: 'safe', label: "I'm safe", hint: 'Quick check-in', icon: '✅', tone: 'ok' },
  { flow: 'feel', label: 'How I feel', hint: 'Shared with School Admins', icon: '💬', tone: 'calm' },
  { flow: 'hazard', label: 'Report a hazard', hint: 'Unsafe, bullying, suspicious', icon: '⚠️', tone: 'warn' },
  { flow: 'incident', label: 'Report an incident', hint: 'Emergency, medical, security', icon: '🚨', tone: 'danger' },
  { flow: 'observation', label: 'Suggest or observe', hint: 'Ideas and concerns', icon: '💡', tone: 'calm' },
];

const FLOW_FEATURE: Record<Flow, Feature> = {
  help: 'report.help',
  safe: 'report.safe',
  feel: 'report.feeling',
  hazard: 'report.hazard',
  incident: 'report.incident',
  observation: 'report.observation',
};

const CHOICES: Partial<Record<Flow, { title: string; options: Option[] }>> = {
  feel: { title: 'How are you feeling right now?', options: EMOTIONS },
  hazard: { title: 'What did you see?', options: HAZARDS },
  incident: { title: 'What kind of incident?', options: INCIDENTS },
  observation: { title: 'What would you like to share?', options: OBSERVATIONS },
};

type Props = {
  profile: Profile;
  features: Set<Feature>;
  locations: Location[];
  incidents: Incident[];
  checkIns: CheckIn[];
  onSent: () => void;
  onProfileChanged: () => Promise<void>;
};

export function ReportPanel({ profile, features, locations, incidents, checkIns, onSent, onProfileChanged }: Props) {
  const defaultId = profile.primary_location_id && locations.some((l) => l.id === profile.primary_location_id) ? profile.primary_location_id : null;
  const flows = FLOWS.filter((f) => features.has(FLOW_FEATURE[f.flow]));
  const [flow, setFlow] = useState<Flow | null>(null);
  const [step, setStep] = useState<Step>('choice');
  const [choice, setChoice] = useState<string | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ title: string; detail: string } | null>(null);

  function start(next: Flow) {
    setFlow(next);
    setChoice(null);
    setStress(null);
    setLocationId(defaultId);
    setError('');
    setDone(null);
    setStep(next === 'safe' || next === 'help' ? 'location' : 'choice');
  }

  function reset() {
    setFlow(null);
    setDone(null);
    setError('');
  }

  function back() {
    setError('');
    if (step === 'review') return setStep('location');
    if (step === 'location') {
      if (flow === 'safe' || flow === 'help') return reset();
      return setStep(flow === 'feel' ? 'stress' : 'choice');
    }
    if (step === 'stress') return setStep('choice');
    reset();
  }

  async function send() {
    if (!flow) return;
    setSending(true);
    setError('');
    const place = locationId ? placeLabel(locationId, locations) : null;
    const where = place ? ` at ${place}` : '';
    let result: { error: string | null; caseRef?: string };

    if (flow === 'safe' || flow === 'help') {
      result = await checkIn(profile, flow === 'safe' ? 'safe' : 'need_help', locationId);
    } else if (flow === 'incident') {
      result = await raiseIncident(profile, { category: choice!, locationId, description: `${labelFor(choice)} incident reported${where} using quick report.` });
    } else if (flow === 'feel') {
      result = await sendSubmission(profile, {
        kind: 'sentiment',
        subType: choice!,
        stress: stress!,
        locationId,
        message: `Feeling ${labelFor(choice).toLowerCase()}, stress ${stress} of 5${where}.`,
      });
    } else {
      result = await sendSubmission(profile, {
        kind: flow === 'hazard' ? 'incident_hazard' : 'observation',
        subType: choice!,
        locationId,
        message: `${labelFor(choice)} reported${where} using quick report.`,
      });
    }

    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone(doneMessage(flow, result.caseRef));
    onSent();
  }

  const myIncidents = incidents.filter((i) => i.created_by === profile.id).slice(0, 5);
  const myCheckIns = checkIns.filter((c) => c.profile_id === profile.id).slice(0, 3);

  if (done) {
    return (
      <section className="report-flow" aria-live="polite">
        <div className="done-card">
          <div className="done-icon" aria-hidden="true">✓</div>
          <h2>{done.title}</h2>
          <p>{done.detail}</p>
          <button type="button" className="big-button primary" onClick={reset}>
            Done
          </button>
        </div>
      </section>
    );
  }

  if (flow) {
    const config = CHOICES[flow];
    return (
      <section className="report-flow">
        <div className="flow-head">
          <button type="button" className="back-button" onClick={back} aria-label="Back">
            ← Back
          </button>
          <span className="flow-title">{FLOWS.find((f) => f.flow === flow)?.label}</span>
        </div>

        {step === 'choice' && config && (
          <>
            <h2 className="flow-question">{config.title}</h2>
            <div className="choice-grid">
              {config.options.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  className="choice-button"
                  onClick={() => {
                    setChoice(o.value);
                    setStep(flow === 'feel' ? 'stress' : 'location');
                  }}
                >
                  <span className="choice-icon" aria-hidden="true">{o.icon}</span>
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'stress' && (
          <>
            <h2 className="flow-question">How stressed do you feel?</h2>
            <div className="stress-row">
              {STRESS_LEVELS.map((s) => (
                <button
                  type="button"
                  key={s.value}
                  className={`stress-button level-${s.value}`}
                  onClick={() => {
                    setStress(Number(s.value));
                    setStep('location');
                  }}
                >
                  <strong>{s.icon}</strong>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'location' && (
          <>
            <h2 className="flow-question">{flow === 'help' ? 'Where are you?' : 'Where is this?'}</h2>
            {defaultId && locationId === defaultId && <p className="fine-print">Starting from your default location. Change it below if you are somewhere else.</p>}
            <PlacePicker
              locations={locations}
              initial={locationId}
              onPick={(id) => {
                setLocationId(id);
                setStep('review');
              }}
              onSkip={() => {
                setLocationId(null);
                setStep('review');
              }}
            />
          </>
        )}

        {step === 'review' && (
          <div className="review-card">
            <h2 className="flow-question">Ready to send?</h2>
            <ul className="review-chips">
              {choice && (
                <li>
                  {iconFor(choice)} {labelFor(choice)}
                </li>
              )}
              {stress && <li>Stress {stress} of 5</li>}
              <li>📍 {placeLabel(locationId, locations)}</li>
            </ul>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <button type="button" className={`big-button ${flow === 'help' || flow === 'incident' ? 'danger' : 'primary'}`} disabled={sending} onClick={send}>
              {sending ? 'Sending…' : flow === 'help' ? 'Send help request' : 'Send'}
            </button>
            <p className="fine-print">{privacyNote(flow)}</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="report-home">
      <h2 className="section-title">What do you want to do?</h2>
      <div className="action-grid">
        {flows.map((f) => (
          <button type="button" key={f.flow} className={`action-button tone-${f.tone}`} onClick={() => start(f.flow)}>
            <span className="action-icon" aria-hidden="true">{f.icon}</span>
            <span className="action-label">{f.label}</span>
            <span className="action-hint">{f.hint}</span>
          </button>
        ))}
      </div>

      <DefaultLocationCard profile={profile} locations={locations} onChanged={onProfileChanged} />

      {(myIncidents.length > 0 || myCheckIns.length > 0) && (
        <div className="my-activity">
          <h3 className="section-title">My recent activity</h3>
          <ul className="activity-list">
            {myIncidents.map((i) => (
              <li key={i.id}>
                <span aria-hidden="true">{iconFor(i.category)}</span>
                <span className="activity-main">
                  <strong>{i.case_ref}</strong> · {labelFor(i.category)}
                  <small>{placeLabel(i.location_id, locations)}</small>
                </span>
                <span className={`chip status-${i.status}`}>{i.status.replace('_', ' ')}</span>
                {OPEN_INCIDENT.includes(i.status) && i.status === 'new' && (
                  <button type="button" className="text-button" onClick={async () => {
                    const r = await transitionIncident(i.id, 'cancelled', 'Cancelled by reporter');
                    if (!r.error) onSent();
                  }}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
            {myCheckIns.map((c) => (
              <li key={c.id}>
                <span aria-hidden="true">{c.status === 'safe' ? '✅' : '🆘'}</span>
                <span className="activity-main">
                  <strong>{c.status === 'safe' ? 'Checked in safe' : 'Asked for help'}</strong>
                  <small>{new Date(c.checked_in_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function doneMessage(flow: Flow, caseRef?: string): { title: string; detail: string } {
  switch (flow) {
    case 'help':
      return {
        title: 'Help request sent',
        detail: 'School Admins can see it on their dashboard. If you are in danger right now, go to the nearest teacher or staff member.',
      };
    case 'safe':
      return { title: 'Thanks for checking in', detail: 'You are marked safe.' };
    case 'incident':
      return { title: `Incident ${caseRef ?? ''} sent`, detail: 'Responders can see it now. Track its status under My recent activity.' };
    case 'feel':
      return { title: 'Thank you for sharing', detail: 'Only School Admins can see how you feel.' };
    default:
      return { title: 'Report sent', detail: 'The safety team will review it.' };
  }
}

function privacyNote(flow: Flow): string {
  if (flow === 'feel') return 'Only School Admins (coordinators and responders) can read feelings you share.';
  if (flow === 'help') return 'School Admins see this on their dashboard right away.';
  return 'Your name is attached so the team can follow up with you.';
}
