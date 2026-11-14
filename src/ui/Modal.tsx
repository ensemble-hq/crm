import { X } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef } from 'react';
import { ICON } from './styles';

/**
 * A modal form: a title, the fields, and Cancel plus one primary action. Opening it puts the cursor
 * in the first field. `error` shows under the fields.
 */
export function Modal({
  open,
  title,
  description,
  submitLabel,
  busy = false,
  error,
  tone = 'primary',
  size,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  busy?: boolean;
  error?: string;
  tone?: 'primary' | 'danger';
  size?: 'sm' | 'lg';
  onClose: () => void;
  onSubmit: () => void;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // A modal dialog focuses its first control, the close button; start in the first field instead.
      element.querySelector<HTMLElement>('.m-dialog-body input, .m-dialog-body select, .m-dialog-body textarea')?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onSubmit();
  }

  return (
    // The library's reset removes the margin that centres a modal dialog, so it is restored here.
    <dialog ref={dialog} className="m-dialog" data-size={size} aria-label={title} onClose={onClose} style={{ margin: 'auto' }}>
      {/* `contents` keeps the header, body and footer as the dialog's own flex children. */}
      <form onSubmit={submit} style={{ display: 'contents' }}>
        <header className="m-dialog-header">
          <div>
            <h2 className="m-dialog-title">{title}</h2>
            {description ? <p className="m-dialog-description">{description}</p> : null}
          </div>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Close" onClick={onClose}>
            <X size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </header>
        {children || error ? (
          <div className="m-dialog-body m-stack" data-gap="3" style={{ overflowY: 'auto' }}>
            {open ? children : null}
            {error ? (
              <p className="m-field-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
        <footer className="m-dialog-footer">
          <button type="button" className="m-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="m-button" data-variant={tone} disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
