import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ObjectDefinition } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import { Modal } from '../ui/Modal';
import { ICON, small, toolbarButton } from '../ui/styles';

/**
 * The "more" menu on a person's record, for privacy requests: download everything held about
 * them, or erase them. Shown only for records that have an email address field.
 */
export function PrivacyActions({ object, record, canExport, canErase, onErased }: { object: ObjectDefinition; record: CrmRecord; canExport: boolean; canErase: boolean; onErased: () => void }) {
  const [open, setOpen] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const wrapper = useRef<HTMLDivElement>(null);
  const name = String(record.properties[object.primaryProperty] ?? object.singular);
  const email = typeof record.properties.email === 'string' && record.properties.email ? record.properties.email : undefined;
  const expected = email ?? name;

  // The menu closes when something else is clicked or Escape is pressed.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function download() {
    setOpen(false);
    setError(undefined);
    try {
      const data = await api.exportPersonalData(record.id);
      // Made in the browser from what the server returned; nothing is sent anywhere else.
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'person'}-data.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The export could not be made.');
    }
  }

  async function erase() {
    setBusy(true);
    setError(undefined);
    try {
      await api.erasePerson({ recordId: record.id, confirm });
      setErasing(false);
      onErased();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This person could not be erased.');
    } finally {
      setBusy(false);
    }
  }

  if (!canExport && !canErase) return null;
  return (
    <div ref={wrapper} style={{ position: 'relative' }}>
      <button type="button" className="m-button" data-size="sm" data-icon-only aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} style={toolbarButton}>
        <MoreHorizontal size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
      </button>
      {open ? (
        <div className="m-menu" role="menu" style={{ position: 'absolute', insetInlineEnd: 0, insetBlockStart: 'calc(100% + var(--m-space-1))', zIndex: 20, minInlineSize: 280, background: 'var(--m-color-bg-surface)', border: 'var(--m-border-width-thin) solid var(--m-color-border)', borderRadius: 'var(--m-radius-md)', boxShadow: 'var(--m-shadow-md)', padding: 'var(--m-space-1)' }}>
          <div className="m-menu-label">Privacy requests</div>
          {canExport ? (
            <button type="button" role="menuitem" className="m-menu-item" onClick={() => void download()}>
              <Download size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Download everything held about them
            </button>
          ) : null}
          {canErase ? (
            <button
              type="button"
              role="menuitem"
              className="m-menu-item"
              onClick={() => {
                setOpen(false);
                setConfirm('');
                setError(undefined);
                setErasing(true);
              }}
            >
              <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Erase this person…
            </button>
          ) : null}
        </div>
      ) : null}
      {error && !erasing ? (
        <p className="m-field-error" role="alert" style={{ position: 'absolute', insetInlineEnd: 0, insetBlockStart: '100%', margin: 0, whiteSpace: 'nowrap' }}>
          {error}
        </p>
      ) : null}
      <Modal open={erasing} size="sm" tone="danger" title={`Erase ${name}?`} description="For when someone asks to be forgotten. This cannot be undone." submitLabel="Erase for good" busy={busy} error={error} onClose={() => setErasing(false)} onSubmit={() => void erase()}>
        <ul style={{ ...small, margin: 0, paddingInlineStart: 'var(--m-space-5)' }}>
          <li>The {object.singular.toLowerCase()}, every note, call and email logged about them, their conversations, form submissions, meetings and sequences are removed from the database, not just hidden.</li>
          <li>Deals and tasks linked to them are kept, no longer pointing at anyone.</li>
          {email ? <li>Their address alone is kept, on the never-email list, so they are not contacted again by mistake.</li> : null}
          <li>If you owe them a copy of their data, download it first.</li>
        </ul>
        <div className="m-field">
          <label className="m-field-label" htmlFor="erase-confirm">
            Type {expected} to confirm
          </label>
          <input className="m-input" id="erase-confirm" value={confirm} autoComplete="off" onChange={(event) => setConfirm(event.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
