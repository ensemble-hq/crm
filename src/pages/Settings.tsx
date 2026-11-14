import { ArrowDown, ArrowUp, ChevronRight, Pencil, Plus, ScrollText, Settings as SettingsIcon, Trash2, Users } from 'lucide-react';
import { AssistantSettingsCard } from './AssistantSettings';
import { EmailSettingsCard } from './EmailSettings';
import { type CSSProperties, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition, Option, PropertyDefinition, PropertyType, Tone } from '../contracts/metadata';
import { Modal } from '../ui/Modal';
import { OptionBadge } from '../ui/PropertyValue';
import { objectIcon, objectIcons } from '../ui/icons';
import { ICON, figure, medium, small, toolbarButton, rowDivider } from '../ui/styles';

const TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Text',
  email: 'Email',
  phone: 'Phone',
  url: 'Web address',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  datetime: 'Date and time',
  select: 'Dropdown',
  multiselect: 'Multiple choice',
  boolean: 'Yes / No',
  user: 'Person',
  reference: 'Link to a record',
};

const TONES: Array<{ id: Tone; label: string }> = [
  { id: 'neutral', label: 'Grey' },
  { id: 'info', label: 'Blue' },
  { id: 'success', label: 'Green' },
  { id: 'warning', label: 'Yellow' },
  { id: 'danger', label: 'Red' },
];

const hasOptions = (type: PropertyType) => type === 'select' || type === 'multiselect';

function optionId(label: string, taken: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'option';
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

/** The choices of a dropdown: rename, recolour, reorder, add and remove. Ids stay put so data keeps its meaning. */
function OptionsEditor({ options, onChange }: { options: Option[]; onChange: (options: Option[]) => void }) {
  const [draft, setDraft] = useState('');

  function add() {
    const label = draft.trim();
    if (!label) return;
    onChange([...options, { id: optionId(label, new Set(options.map((option) => option.id))), label }]);
    setDraft('');
  }

  function move(index: number, by: number) {
    const next = [...options];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(index + by, 0, moved);
    onChange(next);
  }

  return (
    <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="m-field-label">Choices</legend>
      {options.length === 0 ? <span style={small}>No choices yet. Add the first one below.</span> : null}
      {options.map((option, index) => (
        <div key={option.id} className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap' }}>
          <input
            className="m-input"
            data-size="sm"
            aria-label={`Choice ${index + 1}`}
            value={option.label}
            onChange={(event) => onChange(options.map((item) => (item.id === option.id ? { ...item, label: event.target.value } : item)))}
            style={{ flex: 1, minInlineSize: 0 }}
          />
          <select
            className="m-select"
            data-size="sm"
            aria-label={`Colour of ${option.label}`}
            value={option.tone ?? 'neutral'}
            onChange={(event) => onChange(options.map((item) => (item.id === option.id ? { ...item, tone: event.target.value as Tone } : item)))}
            style={{ inlineSize: 96 }}
          >
            {TONES.map((tone) => (
              <option key={tone.id} value={tone.id}>
                {tone.label}
              </option>
            ))}
          </select>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Move ${option.label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
            <ArrowUp size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Move ${option.label} down`} disabled={index === options.length - 1} onClick={() => move(index, 1)}>
            <ArrowDown size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Remove ${option.label}`} onClick={() => onChange(options.filter((item) => item.id !== option.id))}>
            <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </div>
      ))}
      <div className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap' }}>
        <input
          className="m-input"
          data-size="sm"
          aria-label="New choice"
          placeholder="Add a choice"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          style={{ flex: 1, minInlineSize: 0 }}
        />
        <button type="button" className="m-button" data-size="sm" onClick={add} disabled={draft.trim() === ''}>
          Add
        </button>
      </div>
    </fieldset>
  );
}

type PropertyDraft = { label: string; type: PropertyType; group: string; options: Option[]; referenceObjectId: string; onCreate: boolean; required: boolean; unique: boolean; addToViews: boolean };

/** Create a property, or edit one. A property's type is fixed once it exists, because data already uses it. */
function PropertyDialog({ object, editing, onClose, onSaved }: { object: ObjectDefinition; editing: PropertyDefinition | 'new'; onClose: () => void; onSaved: () => void }) {
  const { objects } = useWorkspace();
  const existing = editing === 'new' ? undefined : editing;
  const groups = [...new Set(object.properties.map((property) => property.group))];
  const [draft, setDraft] = useState<PropertyDraft>({
    label: existing?.label ?? '',
    type: existing?.type ?? 'text',
    group: existing?.group ?? groups[0] ?? 'About',
    options: existing?.options ?? [],
    referenceObjectId: existing?.referenceObjectId ?? objects.find((item) => item.id !== object.id)?.id ?? '',
    onCreate: existing?.onCreate ?? false,
    required: existing?.required ?? false,
    unique: existing?.unique ?? false,
    addToViews: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (changes: Partial<PropertyDraft>) => setDraft((previous) => ({ ...previous, ...changes }));

  async function save() {
    if (hasOptions(draft.type) && draft.options.some((option) => option.label.trim() === '')) {
      setError('Every choice needs a name.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (existing) {
        await api.updateProperty({ objectId: object.id, propertyId: existing.id, label: draft.label, group: draft.group, onCreate: draft.onCreate, required: draft.required, unique: draft.unique, options: hasOptions(existing.type) ? draft.options : undefined });
      } else {
        await api.createProperty({
          objectId: object.id,
          label: draft.label,
          type: draft.type,
          group: draft.group,
          options: hasOptions(draft.type) ? draft.options : undefined,
          referenceObjectId: draft.type === 'reference' ? draft.referenceObjectId : undefined,
          onCreate: draft.onCreate,
          required: draft.required,
          unique: draft.unique,
          addToViews: draft.addToViews,
        });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The property could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={existing ? `Edit "${existing.label}"` : `New ${object.singular.toLowerCase()} property`}
      submitLabel={existing ? 'Save' : 'Create property'}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      <div className="m-field">
        <label className="m-field-label" htmlFor="property-label">
          Name
        </label>
        <input className="m-input" id="property-label" value={draft.label} onChange={(event) => set({ label: event.target.value })} required />
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="property-type">
          Type
        </label>
        <select className="m-select" id="property-type" value={draft.type} disabled={!!existing} onChange={(event) => set({ type: event.target.value as PropertyType })}>
          {(Object.keys(TYPE_LABELS) as PropertyType[]).map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {existing ? <p className="m-field-hint">The type can't change once a property exists, because records already hold values of this type.</p> : null}
      </div>
      {draft.type === 'reference' && !existing ? (
        <div className="m-field">
          <label className="m-field-label" htmlFor="property-reference">
            Links to
          </label>
          <select className="m-select" id="property-reference" value={draft.referenceObjectId} onChange={(event) => set({ referenceObjectId: event.target.value })}>
            {objects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.plural}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {hasOptions(draft.type) ? <OptionsEditor options={draft.options} onChange={(options) => set({ options })} /> : null}
      <div className="m-field">
        <label className="m-field-label" htmlFor="property-group">
          Section on the record page
        </label>
        <input className="m-input" id="property-group" list="property-groups" value={draft.group} onChange={(event) => set({ group: event.target.value })} required />
        <datalist id="property-groups">
          {groups.map((group) => (
            <option key={group} value={group} />
          ))}
        </datalist>
      </div>
      <label className="m-field" data-layout="inline">
        <input className="m-checkbox" type="checkbox" checked={draft.onCreate} onChange={(event) => set({ onCreate: event.target.checked })} /> Ask for it when a {object.singular.toLowerCase()} is created
      </label>
      <label className="m-field" data-layout="inline">
        <input className="m-checkbox" type="checkbox" checked={draft.required} onChange={(event) => set({ required: event.target.checked })} /> Required: a {object.singular.toLowerCase()} can't be saved without it
      </label>
      {draft.type === 'text' || draft.type === 'email' || draft.type === 'phone' || draft.type === 'url' || draft.type === 'number' ? (
        <label className="m-field" data-layout="inline">
          <input className="m-checkbox" type="checkbox" checked={draft.unique} onChange={(event) => set({ unique: event.target.checked })} /> Unique: no two {object.plural.toLowerCase()} can share a value
        </label>
      ) : null}
      {existing ? null : (
        <label className="m-field" data-layout="inline">
          <input className="m-checkbox" type="checkbox" checked={draft.addToViews} onChange={(event) => set({ addToViews: event.target.checked })} /> Show it as a column in every {object.singular.toLowerCase()} view
        </label>
      )}
    </Modal>
  );
}

/** One object's properties: what they are called, their type, where they show, and their choices. */
export function ObjectSettings() {
  const { objectId } = useParams();
  const workspace = useWorkspace();
  const object = workspace.object(objectId);
  const [editing, setEditing] = useState<PropertyDefinition | 'new'>();
  const [removing, setRemoving] = useState<PropertyDefinition>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!object) return <Navigate to="/settings" replace />;

  async function remove() {
    if (!removing || !object) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteProperty({ objectId: object.id, propertyId: removing.id });
      await workspace.reload();
      setRemoving(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The property could not be deleted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      icon={SettingsIcon}
      crumbs={[{ label: 'Settings', to: '/settings' }, { label: object.plural }]}
      actions={
        workspace.access.manageSettings ? (
          <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => setEditing('new')}>
            <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Property
          </button>
        ) : null
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-stack" data-gap="1">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>{object.plural}</h1>
          <p style={{ color: 'var(--m-color-fg-muted)' }}>
            The information you keep on each {object.singular.toLowerCase()}. Changes here show up straight away in lists, forms and record pages.
          </p>
        </div>
        <section className="m-card" aria-label={`${object.singular} properties`} style={{ padding: 0, overflow: 'hidden' }}>
          <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0' } as CSSProperties}>
            <table className="m-table">
              <thead>
                <tr>
                  <th scope="col">Property</th>
                  <th scope="col">Type</th>
                  <th scope="col">Section</th>
                  <th scope="col">Choices</th>
                  <th scope="col" style={{ inlineSize: 88 }}>
                    <span className="m-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {object.properties.map((property) => (
                  <tr key={property.id}>
                    <td>
                      <span className="m-cluster" data-gap="2">
                        <span style={medium}>{property.label}</span>
                        {property.custom ? <span className="m-badge" data-tone="info">Custom</span> : null}
                        {property.id === object.primaryProperty ? <span className="m-badge">Name of the record</span> : null}
                        {property.required ? <span className="m-badge">Required</span> : null}
                        {property.unique ? <span className="m-badge">Unique</span> : null}
                      </span>
                    </td>
                    <td>{property.type === 'reference' ? `Link to ${workspace.object(property.referenceObjectId)?.plural.toLowerCase() ?? 'a record'}` : TYPE_LABELS[property.type]}</td>
                    <td style={{ color: 'var(--m-color-fg-muted)' }}>{property.group}</td>
                    <td>
                      {property.options?.length ? (
                        <span className="m-cluster" data-gap="1">
                          {property.options.slice(0, 4).map((option) => (
                            <OptionBadge key={option.id} option={option} />
                          ))}
                          {property.options.length > 4 ? <span style={small}>+{property.options.length - 4}</span> : null}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--m-color-fg-subtle)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {!workspace.access.manageSettings ? null : property.system ? (
                        <span style={small}>Automatic</span>
                      ) : (
                        <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Edit ${property.label}`} onClick={() => setEditing(property)}>
                            <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                          </button>
                          {property.custom ? (
                            <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Delete ${property.label}`} onClick={() => setRemoving(property)}>
                              <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                            </button>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p style={{ ...small, margin: 0 }}>Properties that came with the CRM can be renamed and regrouped. Only properties you added can be deleted.</p>
      </div>
      {editing ? (
        <PropertyDialog
          key={editing === 'new' ? 'new' : editing.id}
          object={object}
          editing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            await workspace.reload();
            setEditing(undefined);
          }}
        />
      ) : null}
      <Modal
        open={!!removing}
        size="sm"
        tone="danger"
        title={`Delete "${removing?.label ?? ''}"?`}
        description={`Its value is removed from every ${object.singular.toLowerCase()}, and it is taken out of any view that shows or filters by it. This can't be undone.`}
        submitLabel="Delete property"
        busy={busy}
        error={error}
        onClose={() => {
          setRemoving(undefined);
          setError(undefined);
        }}
        onSubmit={remove}
      />
    </Page>
  );
}

function NewObjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (object: ObjectDefinition) => void }) {
  const [singular, setSingular] = useState('');
  const [plural, setPlural] = useState('');
  const [icon, setIcon] = useState('box');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await api.createObject({ singular: singular.trim(), plural: (plural || `${singular}s`).trim(), icon }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The object could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="New object" description="A new kind of record, with its own list, record page and properties." submitLabel="Create object" busy={busy} error={error} onClose={onClose} onSubmit={create}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="object-singular">
          One of them is called
        </label>
        <input className="m-input" id="object-singular" placeholder="Project" value={singular} onChange={(event) => setSingular(event.target.value)} required />
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="object-plural">
          Several are called
        </label>
        <input className="m-input" id="object-plural" placeholder={singular ? `${singular}s` : 'Projects'} value={plural} onChange={(event) => setPlural(event.target.value)} />
      </div>
      <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="m-field-label">Icon</legend>
        <div className="m-cluster" data-gap="1">
          {Object.entries(objectIcons).map(([name, Icon]) => (
            <button key={name} type="button" className="m-button" data-size="sm" data-icon-only data-variant={icon === name ? 'primary' : undefined} aria-label={name} aria-pressed={icon === name} onClick={() => setIcon(name)}>
              <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
            </button>
          ))}
        </div>
      </fieldset>
    </Modal>
  );
}

/** Settings home: the kinds of record this CRM keeps. Each opens its properties. */
export function Settings() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      icon={SettingsIcon}
      crumbs={[{ label: 'Settings' }]}
      actions={
        workspace.access.manageSettings ? (
          <button type="button" className="m-button" data-size="sm" style={toolbarButton} onClick={() => setCreating(true)}>
            <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Object
          </button>
        ) : null
      }
    >
      <div className="m-stack" data-gap="4">
        <section className="m-card" aria-label="Workspace" style={{ padding: 0, overflow: 'hidden' }}>
          <Link to="/settings/people" className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', color: 'inherit', textDecoration: 'none' }}>
            <span style={{ display: 'grid', placeItems: 'center', inlineSize: 32, blockSize: 32, flexShrink: 0, borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-sunken)' }}>
              <Users size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
            </span>
            <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
              <span style={medium}>People and permissions</span>
              <span style={small}>
                {workspace.users.length} people · you are {/^[aeiou]/i.test(workspace.access.roleName) ? 'an' : 'a'} {workspace.access.roleName}
              </span>
            </span>
            <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
              <ChevronRight size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
            </span>
          </Link>
          {workspace.access.managePeople && import.meta.env.VITE_API_URL ? (
            <Link to="/settings/audit" className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', color: 'inherit', textDecoration: 'none', ...rowDivider }}>
              <span style={{ display: 'grid', placeItems: 'center', inlineSize: 32, blockSize: 32, flexShrink: 0, borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-sunken)' }}>
                <ScrollText size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
              </span>
              <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                <span style={medium}>Audit log</span>
                <span style={small}>Every change, who or what made it, and how</span>
              </span>
              <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
                <ChevronRight size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
              </span>
            </Link>
          ) : null}
        </section>
        <AssistantSettingsCard />
        <EmailSettingsCard />
        <div className="m-stack" data-gap="1">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>Objects and properties</h1>
          <p style={{ color: 'var(--m-color-fg-muted)' }}>What this CRM keeps records of, and the information on each. You can also ask the assistant: “add a renewal date to deals”.</p>
        </div>
        <section className="m-card" aria-label="Objects" style={{ padding: 0, overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {workspace.objects.map((object, index) => {
              const Icon = objectIcon(object.icon);
              const custom = object.properties.filter((property) => property.custom).length;
              return (
                <li key={object.id} style={index === 0 ? undefined : { borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
                  <Link to={`/settings/objects/${object.id}`} className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', color: 'inherit', textDecoration: 'none' }}>
                    <span style={{ display: 'grid', placeItems: 'center', inlineSize: 32, blockSize: 32, flexShrink: 0, borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-sunken)' }}>
                      <Icon size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </span>
                    <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                      <span className="m-cluster" data-gap="2">
                        <span style={medium}>{object.plural}</span>
                        {object.custom ? <span className="m-badge" data-tone="info">Custom</span> : null}
                      </span>
                      <span style={small}>
                        {object.properties.length} properties{custom ? `, ${custom} added by you` : ''} · {object.views.length} {object.views.length === 1 ? 'view' : 'views'}
                      </span>
                    </span>
                    <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
                      <ChevronRight size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {creating ? (
        <NewObjectDialog
          onClose={() => setCreating(false)}
          onCreated={async (object) => {
            await workspace.reload();
            setCreating(false);
            navigate(`/settings/objects/${object.id}`);
          }}
        />
      ) : null}
    </Page>
  );
}
