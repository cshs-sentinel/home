import { useEffect, useMemo, useRef, useState } from 'react';
import type { Option } from '../lib/catalog';
import { placeLabel } from '../lib/layout';
import type { Location } from '../lib/types';

export type NoteMode = 'none' | 'optional' | 'required';

// Opens when a category button is tapped. It shows the category, starts from the
// person's saved default location, lets them pick the place it is really at from
// the school's configured places, and only sends when they press Confirm.
// Cancel (or Escape, or the backdrop) closes it without creating anything.
//
// `locations` is the active, school-scoped list the app already loaded, so the
// choices are exactly the places a System Admin configured. The database checks
// the same rules again when the report is saved.
export function ConfirmReportDialog({
  option,
  locations,
  defaultLocationId,
  confirmLabel,
  note: noteMode = 'optional',
  onConfirm,
  onCancel,
}: {
  option: Option;
  locations: Location[];
  defaultLocationId: string | null;
  confirmLabel: string;
  // Help requests have nowhere to store a note; a suggestion is nothing but the note.
  note?: NoteMode;
  onConfirm: (locationId: string, note: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const defaultUsable = defaultLocationId !== null && locations.some((l) => l.id === defaultLocationId);
  const [locationId, setLocationId] = useState<string>(defaultUsable ? defaultLocationId! : '');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const noteMissing = noteMode === 'required' && note.trim().length < 3;

  // Every active place with its full path, in reading order.
  const choices = useMemo(
    () => locations.map((l) => ({ id: l.id, label: placeLabel(l.id, locations) })).sort((a, b) => a.label.localeCompare(b.label)),
    [locations],
  );

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function confirm() {
    if (!locationId || noteMissing || sending) return;
    setSending(true);
    setError('');
    const problem = await onConfirm(locationId, note.trim());
    // On success the parent unmounts this dialog; only a problem keeps it open.
    if (problem) {
      setError(problem);
      setSending(false);
    }
  }

  // Only explain the place when it is not simply the person's default.
  const hint = defaultUsable && locationId === defaultLocationId ? null : defaultLocationId && !defaultUsable ? 'Your default place is no longer available. Choose where this is.' : null;
  const noteField = (
    <label className="field">
      <span className={noteMode === 'required' ? undefined : 'sr-only'}>{noteMode === 'required' ? 'Your suggestion' : 'Detail'}</span>
      <textarea rows={3} maxLength={noteMode === 'required' ? 1000 : 300} required={noteMode === 'required'} value={note} onChange={(e) => setNote(e.target.value)} />
    </label>
  );

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!sending) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !sending) onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <h2 id="confirm-title" className="confirm-category">
          <span aria-hidden="true">{option.icon}</span> {option.label}
        </h2>

        {noteMode === 'required' && noteField}

        <label className="field">
          <span>Where?</span>
          <select className="role-select" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
            {!locationId && <option value="">Choose a place</option>}
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {hint && <p className="fine-print">{hint}</p>}

        {noteMode === 'optional' && (
          <details className="confirm-more">
            <summary>Add a detail (optional)</summary>
            {noteField}
          </details>
        )}

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="submit" className="big-button primary" disabled={!locationId || noteMissing || sending}>
            {sending ? 'Sending…' : confirmLabel}
          </button>
          <button type="button" className="big-button ghost" disabled={sending} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
