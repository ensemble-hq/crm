import { Copy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import type { Filter, ObjectDefinition } from '../contracts/metadata';
import { Modal } from '../ui/Modal';
import { describeFilter } from '../ui/filters';
import { ICON, cardTitle, medium, plainList, rowDivider, small } from '../ui/styles';
import { FilterDialog } from './FilterDialog';
import { MergeDialog } from './MergeDialog';

/** One condition a field depends on, in words, with a way to set, change or remove it. */
export function ConditionPicker({ label, hint, object, value, onChange }: { label: string; hint: string; object: ObjectDefinition; value: Filter | undefined; onChange: (value: Filter | undefined) => void }) {
  const { users } = useWorkspace();
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="m-field">
      <span className="m-field-label">{label}</span>
      <div className="m-cluster" data-gap="2">
        {value ? <span className="m-badge">{describeFilter(value, object, users)}</span> : <span style={small}>Always</span>}
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setChoosing(true)}>
          {value ? 'Change' : 'Set a condition'}
        </button>
        {value ? (
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => onChange(undefined)}>
            Remove
          </button>
        ) : null}
      </div>
      <p className="m-field-hint">{hint}</p>
      {choosing ? (
        <FilterDialog
          object={object}
          initial={value}
          onClose={() => setChoosing(false)}
          onSave={(filter) => {
            onChange(filter);
            setChoosing(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** For an object with stages: what each stage needs filled in, and whether stages can be skipped. */
export function StageRulesCard({ object, onSaved }: { object: ObjectDefinition; onSaved: () => Promise<void> }) {
  const board = object.board;
  const stages = object.properties.find((property) => property.id === board?.groupBy)?.options ?? [];
  const [required, setRequired] = useState<Record<string, string[]>>(board?.required ?? {});
  const [noSkipping, setNoSkipping] = useState(board?.noSkipping ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  if (!board || !import.meta.env.VITE_API_URL) return null;
  const fields = object.properties.filter((property) => !property.system && !property.formula && property.id !== board.groupBy && property.id !== object.primaryProperty);

  async function save() {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveStageRules({ objectId: object.id, required, noSkipping });
      await onSaved();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The rules could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-card" aria-label="Stage rules">
      <div className="m-card-body m-stack" data-gap="3">
        <h2 style={cardTitle}>Rules for moving through stages</h2>
        <p style={{ ...small, margin: 0 }}>
          Say what must be filled in before a {object.singular.toLowerCase()} can be in each stage. Anyone who tries to move one without it is told what is missing. {object.plural} already in a stage are left alone until they are next changed.
        </p>
        <ul style={plainList}>
          {stages.map((stage, index) => (
            <li key={stage.id} className="m-stack" data-gap="1" style={{ paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
              <span style={medium}>{stage.label}</span>
              <div className="m-cluster" data-gap="3">
                {fields.map((field) => {
                  const on = required[stage.id]?.includes(field.id) ?? false;
                  return (
                    <label key={field.id} className="m-cluster" data-gap="1" style={small}>
                      <input
                        className="m-checkbox"
                        type="checkbox"
                        checked={on}
                        onChange={(event) => {
                          const current = required[stage.id] ?? [];
                          setRequired({ ...required, [stage.id]: event.target.checked ? [...current, field.id] : current.filter((id) => id !== field.id) });
                        }}
                      />
                      {field.label}
                    </label>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        <label className="m-field" data-layout="inline">
          <input className="m-checkbox" type="checkbox" checked={noSkipping} onChange={(event) => setNoSkipping(event.target.checked)} /> Move forward one stage at a time. Going back, and closing as won or lost, are always allowed.
        </label>
        {error ? (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <div className="m-cluster" data-gap="2">
          <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save rules'}
          </button>
          {saved ? (
            <span style={small} role="status">
              Saved.
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Records that look like the same thing entered twice, in sets, each pair one click from being merged. */
export function DuplicatesDialog({ object, onClose, onMerged }: { object: ObjectDefinition; onClose: () => void; onMerged: () => void }) {
  const [version, setVersion] = useState(0);
  const found = useQuery(() => api.findDuplicates({ objectId: object.id }), [object.id, version]);
  const [merging, setMerging] = useState<[string, string]>();
  const data = found.data;
  const compared = object.properties.find((property) => property.id === data?.property);
  const name = (properties: Record<string, unknown>) => String(properties[object.primaryProperty] ?? 'Untitled');

  if (merging) {
    return (
      <MergeDialog
        object={object}
        ids={merging}
        onClose={() => setMerging(undefined)}
        onDone={() => {
          setMerging(undefined);
          setVersion((value) => value + 1);
          onMerged();
        }}
      />
    );
  }
  return (
    <Modal
      open
      title={`Duplicate ${object.plural.toLowerCase()}`}
      description={data ? (data.total === 0 ? `No two ${object.plural.toLowerCase()} share the same ${compared?.label.toLowerCase() ?? 'value'}.` : `${data.total.toLocaleString('en-US')} ${data.total === 1 ? 'set shares' : 'sets share'} the same ${compared?.label.toLowerCase() ?? 'value'}. Merging keeps one record and moves everything from the other onto it.`) : 'Looking…'}
      submitLabel="Done"
      onClose={onClose}
      onSubmit={onClose}
    >
      {found.error ? (
        <p className="m-field-error" role="alert">
          {found.error.message}
        </p>
      ) : null}
      <ul style={{ ...plainList, maxBlockSize: 420, overflowY: 'auto' }}>
        {(data?.groups ?? []).map((group, index) => (
          <li key={group.value} className="m-stack" data-gap="1" style={{ paddingBlock: 'var(--m-space-3)', ...(index === 0 ? {} : rowDivider) }}>
            <span className="m-cluster" data-justify="between" data-gap="2">
              <span className="m-cluster" data-gap="1" style={medium}>
                <Copy size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {group.value}
              </span>
              <span style={small}>{group.count} records</span>
            </span>
            {group.records.map((record, position) => (
              <span key={record.id} className="m-cluster" data-justify="between" data-gap="2">
                <Link to={`/${object.id}/${record.id}`} target="_blank" style={{ color: 'inherit' }}>
                  {name(record.properties)}
                </Link>
                {position > 0 && group.records[0] ? (
                  <button type="button" className="m-button" data-size="sm" onClick={() => setMerging([(group.records[0] as { id: string }).id, record.id])}>
                    Merge into {name((group.records[0] as { properties: Record<string, unknown> }).properties)}
                  </button>
                ) : (
                  <span style={small}>Oldest</span>
                )}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
