import { useState } from 'react';
import { api } from '../api';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition, PropertyValue } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import { Modal } from '../ui/Modal';
import { PropertyInput } from '../ui/PropertyInput';

/** A create form built from the object's definition: every property marked `onCreate` gets a field. */
export function CreateRecordDialog({ object, onClose, onCreated }: { object: ObjectDefinition; onClose: () => void; onCreated: (record: CrmRecord) => void }) {
  const { currentUser } = useWorkspace();
  const fields = object.properties.filter((property) => property.onCreate);
  // New records start with the person creating them as the owner.
  const [values, setValues] = useState<Record<string, PropertyValue>>(() => {
    const initial: Record<string, PropertyValue> = {};
    if (fields.some((field) => field.id === 'owner')) initial.owner = currentUser.id;
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
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

  return (
    <Modal open title={`New ${object.singular.toLowerCase()}`} submitLabel={`Create ${object.singular.toLowerCase()}`} busy={saving} error={error} onClose={onClose} onSubmit={submit}>
      {fields.map((field) => {
        const id = `create-${object.id}-${field.id}`;
        return (
          <div key={field.id} className="m-field">
            <label className="m-field-label" htmlFor={id}>
              {field.label}
            </label>
            <PropertyInput id={id} property={field} value={values[field.id]} required={field.id === object.primaryProperty} onChange={(value) => setValues((previous) => ({ ...previous, [field.id]: value }))} />
          </div>
        );
      })}
    </Modal>
  );
}
