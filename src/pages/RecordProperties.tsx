import { Pencil } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ObjectDefinition, PropertyDefinition, PropertyValue as Value } from '../contracts/metadata';
import type { CrmRecord, Reference } from '../contracts/records';
import { PropertyInput } from '../ui/PropertyInput';
import { PropertyValue } from '../ui/PropertyValue';
import { useWorkspace } from '../app/workspace';
import { describeFilter } from '../ui/filters';
import { isEditable, isShown, scoreParts } from '../lib/rules';
import { ICON, rowDivider, small } from '../ui/styles';

/** Types that save the moment a choice is made, with no separate confirm. */
const INSTANT = new Set<PropertyDefinition['type']>(['select', 'user', 'boolean', 'reference']);

function groupProperties(object: ObjectDefinition, values: CrmRecord['properties']): Array<{ group: string; properties: PropertyDefinition[] }> {
  const groups: Array<{ group: string; properties: PropertyDefinition[] }> = [];
  for (const property of object.properties) {
    if (property.id === object.primaryProperty) continue;
    // A field that only applies in some cases is left out when this is not one of them.
    if (!isShown(property, values)) continue;
    const existing = groups.find((item) => item.group === property.group);
    if (existing) existing.properties.push(property);
    else groups.push({ group: property.group, properties: [property] });
  }
  return groups;
}

/**
 * One property on a record page. Click the value to change it: choices save at once, typed values
 * save on Enter or when you leave the field, Escape cancels. A link to another record is changed by
 * searching for the new one. Automatic fields are read-only.
 */
function PropertyRow({
  object,
  property,
  record,
  references,
  onSaved,
}: {
  object: ObjectDefinition;
  property: PropertyDefinition;
  record: CrmRecord;
  references: Record<string, Reference>;
  onSaved: () => void;
}) {
  const value = record.properties[property.id] ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Value>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // Automatic and computed fields are shown but not typed into.
  const editable = isEditable(property);
  const inputId = `edit-${record.id}-${property.id}`;
  const wrapper = useRef<HTMLDivElement>(null);

  // Put the cursor in the field as soon as editing starts.
  useEffect(() => {
    if (editing) wrapper.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, [editing]);

  async function save(next: Value) {
    if (JSON.stringify(next) === JSON.stringify(value)) {
      setEditing(false);
      setError(undefined);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.updateRecord({ id: record.id, properties: { [property.id]: next } });
      setEditing(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  function start() {
    // A link opens straight on the search box; choosing a record, or leaving the field, ends the edit.
    setDraft(property.type === 'reference' ? null : value);
    setError(undefined);
    setEditing(true);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      setEditing(false);
      setError(undefined);
    } else if (event.key === 'Enter' && property.type !== 'multiselect') {
      event.preventDefault();
      void save(draft);
    }
  }

  let control = (
    <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
      <PropertyValue property={property} value={value} references={references} />
    </span>
  );

  if (editable && !editing && property.type === 'reference') {
    // The value is itself a link to the other record, so the pencil is a separate button beside it.
    control = (
      <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
        <PropertyValue property={property} value={value} references={references} />
        <button type="button" onClick={start} aria-label={`Change ${property.label}`} title="Change" style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
          <Pencil size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
      </span>
    );
  } else if (editable && !editing) {
    control = (
      <button
        type="button"
        onClick={start}
        aria-label={`Edit ${property.label}`}
        title="Click to edit"
        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 'var(--m-space-1)', maxInlineSize: '100%', borderRadius: 'var(--m-radius-sm)' }}
      >
        <PropertyValue property={property} value={value} references={references} />
        <Pencil size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden style={{ color: 'var(--m-color-fg-subtle)', flexShrink: 0 }} />
      </button>
    );
  } else if (editable && property.type === 'multiselect') {
    const chosen = Array.isArray(draft) ? draft : [];
    control = (
      <div className="m-stack" data-gap="2" style={{ alignItems: 'flex-end' }}>
        <div className="m-stack" data-gap="1" style={{ alignItems: 'flex-start' }}>
          {(property.options ?? []).map((option) => (
            <label key={option.id} className="m-field" data-layout="inline">
              <input
                className="m-checkbox"
                type="checkbox"
                checked={chosen.includes(option.id)}
                onChange={(event) => setDraft(event.target.checked ? [...chosen, option.id] : chosen.filter((id) => id !== option.id))}
              />
              {option.label}
            </label>
          ))}
        </div>
        <span className="m-cluster" data-gap="1">
          <button type="button" className="m-button" data-size="sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={saving} onClick={() => void save(chosen)}>
            Save
          </button>
        </span>
      </div>
    );
  } else if (editable) {
    control = (
      // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only catches Enter, Escape and focus leaving the field inside it
      <div
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // Typed values save when focus leaves; choices have already saved on change.
          if (!INSTANT.has(property.type) && !event.currentTarget.contains(event.relatedTarget)) void save(draft);
          else if (INSTANT.has(property.type) && !event.currentTarget.contains(event.relatedTarget)) setEditing(false);
        }}
        style={{ inlineSize: property.type === 'boolean' ? 'auto' : property.type === 'reference' ? 220 : 200, maxInlineSize: '100%' }}
        ref={wrapper}
      >
        <PropertyInput
          id={inputId}
          property={property}
          value={draft}
          onChange={(next) => {
            setDraft(next);
            if (INSTANT.has(property.type)) void save(next);
          }}
        />
        {property.type === 'reference' && value !== null ? (
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => void save(null)} style={{ marginBlockStart: 'var(--m-space-1)' }}>
            Remove the link
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="m-stack" data-gap="1">
      <div className="m-cluster" data-justify="between" data-align="start" style={{ flexWrap: 'nowrap', gap: 'var(--m-space-3)' }}>
        <dt style={{ color: 'var(--m-color-fg-muted)', flexShrink: 0 }}>
          {editing ? <label htmlFor={inputId}>{property.label}</label> : property.label}
          {property.required ? <span aria-hidden> *</span> : null}
        </dt>
        <dd style={{ margin: 0, textAlign: 'end', minInlineSize: 0, overflowWrap: 'anywhere', opacity: saving ? 0.6 : 1 }}>{control}</dd>
      </div>
      {property.scoring ? <ScoreReasons property={property} object={object} record={record} /> : null}
      {error ? (
        <p className="m-field-error" role="alert" style={{ margin: 0, textAlign: 'end' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Under a score: which of its rules this record meets, so the number can be believed and argued with. */
function ScoreReasons({ property, object, record }: { property: PropertyDefinition; object: ObjectDefinition; record: CrmRecord }) {
  const { users } = useWorkspace();
  const [open, setOpen] = useState(false);
  const parts = scoreParts(property, record.properties);
  const met = parts.filter((part) => part.met);
  if (parts.length === 0) return null;
  return (
    <div className="m-stack" data-gap="1" style={{ alignItems: 'flex-end' }}>
      <button type="button" className="m-button" data-variant="ghost" data-size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide why' : `Why: ${met.length} of ${parts.length} rules`}
      </button>
      {open ? (
        <ul className="m-stack" data-gap="1" style={{ ...small, listStyle: 'none', margin: 0, padding: 0, inlineSize: '100%' }}>
          {parts.map((part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rules have no id and do not reorder here
            <li key={index} className="m-cluster" data-justify="between" style={{ flexWrap: 'nowrap', gap: 'var(--m-space-2)', opacity: part.met ? 1 : 0.55 }}>
              <span style={{ textDecoration: part.met ? undefined : 'line-through' }}>{describeFilter(part.when, object, users)}</span>
              <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{part.met ? (part.points > 0 ? `+${part.points}` : part.points) : 'no'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A record's properties under their section headings, each editable in place. */
export function RecordProperties({ object, record, references, onSaved }: { object: ObjectDefinition; record: CrmRecord; references: Record<string, Reference>; onSaved: () => void }) {
  return (
    <>
      {groupProperties(object, record.properties).map((section, index) => (
        <section key={section.group} className="m-stack" data-gap="2" style={index === 0 ? undefined : { ...rowDivider, paddingBlockStart: 'var(--m-space-3)' }}>
          <h3 style={small}>{section.group}</h3>
          <dl className="m-stack" data-gap="2" style={{ margin: 0 }}>
            {section.properties.map((property) => (
              <PropertyRow key={property.id} object={object} property={property} record={record} references={references} onSaved={onSaved} />
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}
