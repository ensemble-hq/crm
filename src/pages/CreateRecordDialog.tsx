import { X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition, PropertyValue } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import { PropertyInput } from '../ui/PropertyInput';
import { ICON } from '../ui/styles';

/** A create form built from the object's definition: every property marked `onCreate` gets a field. */
export function CreateRecordDialog({
  object,
  open,
  onClose,
  onCreated,
}: {
  object: ObjectDefinition;
  open: boolean;
  onClose: () => void;
  onCreated: (record: CrmRecord) => void;
}) {
  const { currentUser } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Record<string, PropertyValue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const fields = object.properties.filter((property) => property.onCreate);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      // New records start with the person creating them as the owner.
      setValues(fields.some((field) => field.id === 'owner') ? { owner: currentUser.id } : {});
      setError(undefined);
      element.showModal();
      // A modal dialog focuses its first control, the close button; start in the first field instead.
      element.querySelector<HTMLElement>('.m-dialog-body input, .m-dialog-body select')?.focus();
    } else if (!open && element.open) {
      element.close();
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens or closes
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      onCreated(await api.createRecord({ objectId: object.id, properties: values }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The record could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const titleId = `create-${object.id}-title`;
  return (
    // The library's reset removes the margin that centres a modal dialog, so it is restored here.
    <dialog ref={dialog} className="m-dialog" aria-labelledby={titleId} onClose={onClose} style={{ margin: 'auto' }}>
      {/* `contents` keeps the header, body and footer as the dialog's own flex children. */}
      <form onSubmit={submit} style={{ display: 'contents' }}>
        <header className="m-dialog-header">
          <h2 className="m-dialog-title" id={titleId}>
            New {object.singular.toLowerCase()}
          </h2>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Close" onClick={onClose}>
            <X size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </header>
        <div className="m-dialog-body m-stack" data-gap="3">
          {fields.map((field) => {
            const id = `create-${object.id}-${field.id}`;
            return (
              <div key={field.id} className="m-field">
                <label className="m-field-label" htmlFor={id}>
                  {field.label}
                </label>
                <PropertyInput
                  id={id}
                  property={field}
                  value={values[field.id]}
                  required={field.id === object.primaryProperty}
                  onChange={(value) => setValues((previous) => ({ ...previous, [field.id]: value }))}
                />
              </div>
            );
          })}
          {error ? (
            <p className="m-field-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="m-dialog-footer">
          <button type="button" className="m-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="m-button" data-variant="primary" disabled={saving}>
            {saving ? 'Saving…' : `Create ${object.singular.toLowerCase()}`}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
