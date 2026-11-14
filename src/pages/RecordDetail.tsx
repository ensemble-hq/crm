import { ArrowLeftRight, CheckSquare, type LucideIcon, Mail, MoreHorizontal, Phone, StickyNote, Video } from 'lucide-react';
import { type CSSProperties, type FormEvent, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition, PropertyValue as Value } from '../contracts/metadata';
import type { Activity, ActivityKind, CrmRecord, Reference, RelatedGroup } from '../contracts/records';
import { CompleteButton, isComplete } from '../ui/CompleteButton';
import { PropertyValue, formatDate, formatDateTime } from '../ui/PropertyValue';
import { CreateRecordDialog } from './CreateRecordDialog';
import { RecordProperties } from './RecordProperties';
import { objectIcon } from '../ui/icons';
import { ICON, cardTitle, link, medium, plainList, rowDivider, small, toolbarButton } from '../ui/styles';

const activityIcons: Record<ActivityKind, LucideIcon> = {
  note: StickyNote,
  email: Mail,
  call: Phone,
  meeting: Video,
  task: CheckSquare,
  change: ArrowLeftRight,
};

const activityFilters: Array<{ id: ActivityKind | 'all'; label: string }> = [
  { id: 'all', label: 'All activity' },
  { id: 'note', label: 'Notes' },
  { id: 'email', label: 'Emails' },
  { id: 'call', label: 'Calls' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'task', label: 'Tasks' },
];

/** The stages of a record that moves through a pipeline, as a path. Clicking a stage moves the record. */
function StagePath({ object, record, onChange }: { object: ObjectDefinition; record: CrmRecord; onChange: (optionId: string) => void }) {
  const property = object.properties.find((item) => item.id === object.board?.groupBy);
  if (!property?.options) return null;
  const currentIndex = property.options.findIndex((option) => option.id === record.properties[property.id]);
  return (
    <div className="m-cluster" data-gap="1" role="group" aria-label={property.label} style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
      {property.options.map((option, index) => {
        const current = index === currentIndex;
        const done = index < currentIndex;
        return (
          <button
            key={option.id}
            type="button"
            className="m-button"
            data-size="sm"
            data-variant={current ? 'primary' : undefined}
            aria-pressed={current}
            onClick={() => onChange(option.id)}
            style={{ flex: '1 0 auto', ...(done ? ({ '--m-button-secondary-fg': 'var(--m-color-fg-muted)' } as CSSProperties) : {}) }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Related({ groups }: { groups: RelatedGroup[] }) {
  const { object: findObject } = useWorkspace();
  return (
    <>
      {groups.map((group) => {
        const object = findObject(group.objectId);
        if (!object) return null;
        const Icon = objectIcon(object.icon);
        return (
          <section key={group.objectId} className="m-stack" data-gap="2" style={{ ...rowDivider, paddingBlockStart: 'var(--m-space-3)' }}>
            <div className="m-cluster" data-justify="between">
              <h3 className="m-cluster" data-gap="2" style={small}>
                <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                {object.plural}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{group.total.toLocaleString('en-US')}</span>
              </h3>
              <button type="button" className="m-button" data-variant="ghost" data-size="sm">
                Add
              </button>
            </div>
            {group.records.length === 0 ? <span style={small}>None yet</span> : null}
            <ul className="m-stack" data-gap="2" style={plainList}>
              {group.records.map((record) => {
                const secondary = object.properties.find((property) => property.id === object.secondaryProperty);
                const secondaryValue = secondary ? record.properties[secondary.id] : undefined;
                return (
                  <li key={record.id} className="m-cluster" data-gap="2" data-align="start" style={{ flexWrap: 'nowrap' }}>
                    {object.completion ? (
                      <span style={{ display: 'inline-flex', paddingBlockStart: 2 }}>
                        <CompleteButton object={object} record={record} />
                      </span>
                    ) : null}
                    <span className="m-stack" data-gap="0">
                      <Link
                        to={`/${object.id}/${record.id}`}
                        style={{ ...medium, color: isComplete(object, record) ? 'var(--m-color-fg-muted)' : 'inherit', textDecoration: isComplete(object, record) ? 'line-through' : 'none' }}
                      >
                        {String(record.properties[object.primaryProperty] ?? 'Untitled')}
                      </Link>
                      {secondary && secondary.type !== 'reference' && typeof secondaryValue === 'string' ? <span style={small}>{secondary.type === 'date' ? `Due ${formatDate(secondaryValue)}` : secondaryValue}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {group.total > group.records.length ? (
              <Link to={`/${object.id}`} style={{ ...link, fontSize: 'var(--m-font-size-sm)' }}>
                View all {group.total.toLocaleString('en-US')}
              </Link>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

function Timeline({ recordId, onAddTask }: { recordId: string; onAddTask?: () => void }) {
  const { user, revision } = useWorkspace();
  const [filter, setFilter] = useState<ActivityKind | 'all'>('all');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const { data, error, reload } = useQuery(() => api.listActivity(recordId), [recordId, revision]);

  async function addNote(event: FormEvent) {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    setSaving(true);
    try {
      await api.createActivity({ recordId, kind: 'note', title: 'Note', body });
      setNote('');
      reload();
    } finally {
      setSaving(false);
    }
  }

  const shown: Activity[] = (data ?? []).filter((item) => filter === 'all' || item.kind === filter);

  return (
    <div className="m-stack" data-gap="4">
      <form className="m-card" onSubmit={addNote} style={{ padding: 'var(--m-space-3)' }}>
        <div className="m-stack" data-gap="2">
          <label className="m-sr-only" htmlFor="record-note">
            Add a note
          </label>
          <textarea className="m-input" id="record-note" rows={2} placeholder="Add a note for the team…" value={note} onChange={(event) => setNote(event.target.value)} />
          <div className="m-cluster" data-justify="between">
            <div className="m-cluster" data-gap="1">
              {[
                { label: 'Email', icon: Mail },
                { label: 'Log a call', icon: Phone },
                { label: 'Meeting', icon: Video },
                { label: 'Task', icon: CheckSquare, onClick: onAddTask },
              ].map((action: { label: string; icon: LucideIcon; onClick?: () => void }) => (
                <button key={action.label} type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={action.onClick}>
                  <action.icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {action.label}
                </button>
              ))}
            </div>
            <button type="submit" className="m-button" data-variant="primary" data-size="sm" disabled={saving || note.trim() === ''}>
              {saving ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </div>
      </form>

      <div className="m-cluster" data-gap="1" role="group" aria-label="Filter activity">
        {activityFilters.map((item) => {
          const selected = item.id === filter;
          return (
            <button
              key={item.id}
              type="button"
              className="m-button"
              data-variant="ghost"
              data-size="sm"
              aria-pressed={selected}
              style={selected ? ({ '--m-button-ghost-bg': 'var(--m-button-secondary-bg)' } as CSSProperties) : undefined}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="m-field-error" role="alert">
          The activity didn't load: {error.message}
        </p>
      ) : null}
      {!data && !error ? <span className="m-spinner" role="status" aria-label="Loading activity" /> : null}
      {data && shown.length === 0 ? <span style={small}>Nothing of this kind yet.</span> : null}

      <ol className="m-stack" data-gap="0" style={plainList}>
        {shown.map((item, index) => {
          const Icon = activityIcons[item.kind];
          return (
            <li key={item.id} className="m-cluster" data-gap="3" data-align="start" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-3)', ...(index === 0 ? {} : rowDivider) }}>
              <span
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  inlineSize: 32,
                  blockSize: 32,
                  flexShrink: 0,
                  borderRadius: 'var(--m-radius-md)',
                  background: 'var(--m-color-bg-sunken)',
                }}
              >
                <Icon size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
              </span>
              <div className="m-stack" data-gap="1" style={{ flex: 1, minInlineSize: 0 }}>
                <div className="m-cluster" data-justify="between" style={{ flexWrap: 'nowrap', gap: 'var(--m-space-3)' }}>
                  <span style={medium}>{item.title}</span>
                  <span style={{ ...small, whiteSpace: 'nowrap' }}>{formatDateTime(item.occurredAt)}</span>
                </div>
                {item.body ? <p style={{ margin: 0, color: 'var(--m-color-fg-muted)' }}>{item.body}</p> : null}
                <span style={small}>{user(item.actorId)?.name ?? 'Someone'}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * What a task made from a record page starts with: open, owned by the person making it, and linked
 * to the record it was made on, plus that record's own company and contact where the task has a
 * place for them.
 */
function taskAbout(taskObject: ObjectDefinition, object: ObjectDefinition, record: CrmRecord, userId: string): Record<string, Value> {
  const values: Record<string, Value> = { owner: userId };
  if (taskObject.completion) values[taskObject.completion.property] = taskObject.completion.open;
  for (const property of taskObject.properties) {
    if (property.type !== 'reference') continue;
    if (property.referenceObjectId === object.id) values[property.id] = record.id;
    else {
      const carried = object.properties.find((item) => item.type === 'reference' && item.referenceObjectId === property.referenceObjectId);
      const value = carried ? record.properties[carried.id] : undefined;
      if (typeof value === 'string') values[property.id] = value;
    }
  }
  return values;
}

/** The record page for any object: its properties by group, what it's related to, and its activity. */
export function RecordDetail() {
  const { objectId, recordId = '' } = useParams();
  const { object: findObject, objects, currentUser, revision, touch } = useWorkspace();
  const object = findObject(objectId);
  const [addingTask, setAddingTask] = useState(false);
  // The object whose records get finished: tasks.
  const taskObject = objects.find((item) => item.completion);
  const detail = useQuery(() => api.getRecord(recordId), [recordId, revision]);
  const related = useQuery(() => api.listRelated(recordId), [recordId, revision]);

  if (!object) return <Navigate to="/" replace />;

  const Icon = objectIcon(object.icon);
  const record = detail.data?.record.id === recordId ? detail.data.record : undefined;
  const references = detail.data?.references ?? {};
  const name = record ? String(record.properties[object.primaryProperty] ?? 'Untitled') : '';
  const secondary = object.properties.find((property) => property.id === object.secondaryProperty);
  const filled = (propertyId: string) => {
    const value = record?.properties[propertyId];
    return value !== null && value !== undefined && value !== '';
  };
  const badges = object.properties.filter((property) => property.type === 'select' && property.group !== 'Location' && filled(property.id)).slice(0, 2);

  async function setStage(optionId: string) {
    if (!record || !object?.board) return;
    await api.updateRecord({ id: record.id, properties: { [object.board.groupBy]: optionId } });
    detail.reload();
  }

  return (
    <Page
      icon={Icon}
      crumbs={[{ label: object.plural, to: `/${object.id}` }, { label: name || object.singular }]}
      wide
      actions={
        <>
          <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
            Edit
          </button>
          <button type="button" className="m-button" data-size="sm" data-icon-only aria-label="More actions" style={toolbarButton}>
            <MoreHorizontal size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </>
      }
    >
      {detail.error ? (
        <div className="m-alert" data-tone="danger" role="alert">
          <div className="m-alert-content">
            <p className="m-alert-title">This {object.singular.toLowerCase()} didn't load</p>
            <p className="m-alert-body">{detail.error.message}</p>
          </div>
        </div>
      ) : null}
      {!record && !detail.error ? (
        <div style={{ display: 'grid', placeItems: 'center', minBlockSize: 320 }}>
          <span className="m-spinner" role="status" aria-label={`Loading ${object.singular.toLowerCase()}`} />
        </div>
      ) : null}
      {record && addingTask && taskObject ? (
        <CreateRecordDialog
          object={taskObject}
          initial={taskAbout(taskObject, object, record, currentUser.id)}
          onClose={() => setAddingTask(false)}
          onCreated={() => {
            setAddingTask(false);
            touch();
          }}
        />
      ) : null}
      {record ? (
        <div className="m-stack" data-gap="5">
          <div className="m-stack" data-gap="2">
            <div className="m-cluster" data-gap="3" data-align="center">
              <CompleteButton object={object} record={record} size={22} />
              <h1 style={{ fontSize: 'var(--m-font-size-2xl)', fontWeight: 'var(--m-font-weight-medium)', letterSpacing: 'var(--m-font-tracking-tight)', lineHeight: 'var(--m-font-leading-tight)' }}>
                {name}
              </h1>
              {badges.map((property) => (
                <PropertyValue key={property.id} property={property} value={record.properties[property.id]} />
              ))}
            </div>
            {secondary && filled(secondary.id) ? (
              <div style={{ color: 'var(--m-color-fg-muted)' }}>
                <PropertyValue property={secondary} value={record.properties[secondary.id]} references={references} />
              </div>
            ) : null}
          </div>
          {object.board ? <StagePath object={object} record={record} onChange={(optionId) => void setStage(optionId)} /> : null}
          <div className="m-split" style={{ '--m-layout-split-side': '336px', '--m-layout-split-gap': 'var(--m-space-6)', flexDirection: 'row-reverse', alignItems: 'flex-start' } as CSSProperties}>
            <aside className="m-card" aria-label={`About this ${object.singular.toLowerCase()}`}>
              <div className="m-card-body m-stack" data-gap="3">
                <h2 style={cardTitle}>About this {object.singular.toLowerCase()}</h2>
                <RecordProperties
                  object={object}
                  record={record}
                  references={references}
                  onSaved={() => {
                    detail.reload();
                    touch();
                  }}
                />
                <Related groups={related.data ?? []} />
              </div>
            </aside>
            <Timeline recordId={record.id} onAddTask={taskObject && taskObject.id !== object.id ? () => setAddingTask(true) : undefined} />
          </div>
        </div>
      ) : null}
    </Page>
  );
}
