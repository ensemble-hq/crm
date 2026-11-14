import { Circle, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';

/** Whether a record of an object that gets finished (a task) is finished. */
export function isComplete(object: ObjectDefinition, record: CrmRecord): boolean {
  return !!object.completion && record.properties[object.completion.property] === object.completion.done;
}

/**
 * The round tick beside a task. One click marks it done, another reopens it. Works for any object
 * whose definition has `completion`.
 */
export function CompleteButton({ object, record, size = 16 }: { object: ObjectDefinition; record: CrmRecord; size?: number }) {
  const { touch } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const completion = object.completion;
  if (!completion) return null;
  const done = isComplete(object, record);
  const name = String(record.properties[object.primaryProperty] ?? object.singular);

  async function toggle() {
    if (!completion) return;
    setBusy(true);
    try {
      await api.updateRecord({ id: record.id, properties: { [completion.property]: done ? completion.open : completion.done } });
      touch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Reopen: ${name}` : `Mark done: ${name}`}
      title={done ? 'Done. Click to reopen.' : 'Mark as done'}
      disabled={busy}
      onClick={() => void toggle()}
      style={{ all: 'unset', cursor: busy ? 'progress' : 'pointer', display: 'inline-flex', flexShrink: 0, color: done ? 'var(--m-color-success-fg)' : 'var(--m-color-fg-subtle)', opacity: busy ? 0.5 : 1 }}
    >
      {done ? <CircleCheck size={size} strokeWidth={2.25} aria-hidden /> : <Circle size={size} strokeWidth={2.25} aria-hidden />}
    </button>
  );
}
