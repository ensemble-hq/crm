import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Filter as FilterIcon, LayoutList, List, Pencil, Plus, Search, Send, SlidersHorizontal, Trash2, Upload, UserPlus, X } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { Filter, ObjectDefinition, PropertyDefinition, Sort, PropertyValue as Value, ViewDefinition } from '../contracts/metadata';
import { CompleteButton, isComplete } from '../ui/CompleteButton';
import { Modal } from '../ui/Modal';
import { PropertyInput } from '../ui/PropertyInput';
import { PropertyValue } from '../ui/PropertyValue';
import { EXPORT_LIMIT, exportRecords } from '../lib/exportRecords';
import { describeFilter } from '../ui/filters';
import { objectIcon } from '../ui/icons';
import { ICON, figure, small, toolbarButton } from '../ui/styles';
import { CreateRecordDialog } from './CreateRecordDialog';
import { FilterDialog } from './FilterDialog';
import { RecordBoard } from './RecordBoard';

const PAGE_SIZE = 50;
const NUMERIC = new Set<PropertyDefinition['type']>(['number', 'currency']);

function parseSort(text: string | null): Sort | undefined {
  if (!text) return undefined;
  const [property, direction] = text.split(':');
  if (!property || (direction !== 'asc' && direction !== 'desc')) return undefined;
  return { property, direction };
}

function parseFilters(text: string | null): Filter[] | undefined {
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Filter[]) : undefined;
  } catch {
    return undefined;
  }
}

function ViewTabs({ object, view, onSelect }: { object: ObjectDefinition; view: ViewDefinition; onSelect: (viewId: string) => void }) {
  return (
    <div className="m-cluster" data-gap="1" role="group" aria-label="Views">
      {object.views.map((item) => {
        const selected = item.id === view.id;
        return (
          <button
            key={item.id}
            type="button"
            className="m-button"
            data-variant="ghost"
            data-size="sm"
            aria-pressed={selected}
            style={selected ? ({ '--m-button-ghost-bg': 'var(--m-button-secondary-bg)' } as CSSProperties) : undefined}
            onClick={() => onSelect(item.id)}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text), 250);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  return (
    <label className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', position: 'relative' }}>
      <span className="m-sr-only">{label}</span>
      <span aria-hidden style={{ position: 'absolute', insetInlineStart: 'var(--m-space-2)', display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
        <Search size={ICON.button} strokeWidth={ICON.strokeWidth} />
      </span>
      <input
        className="m-input"
        data-size="sm"
        type="search"
        placeholder={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        style={{ paddingInlineStart: 'calc(var(--m-space-2) * 2 + 14px)', inlineSize: 240 }}
      />
    </label>
  );
}

/** Choose which properties are columns. Order follows the object's own property order. */
function ColumnsDialog({ object, columns, onClose, onSave }: { object: ObjectDefinition; columns: string[]; onClose: () => void; onSave: (columns: string[]) => void }) {
  const [chosen, setChosen] = useState<string[]>(columns);
  const toggle = (id: string, on: boolean) => setChosen((previous) => (on ? [...previous, id] : previous.filter((item) => item !== id)));
  return (
    <Modal open size="sm" title="Columns" description={`What to show for each ${object.singular.toLowerCase()} in this view.`} submitLabel="Apply" onClose={onClose} onSubmit={() => onSave(chosen.length > 0 ? chosen : [object.primaryProperty])}>
      <fieldset className="m-stack" data-gap="1" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="m-sr-only">Columns</legend>
        {object.properties.map((property) => (
          <label key={property.id} className="m-field" data-layout="inline">
            <input className="m-checkbox" type="checkbox" checked={chosen.includes(property.id)} disabled={property.id === object.primaryProperty} onChange={(event) => toggle(property.id, event.target.checked)} />
            {property.label}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

/** Change one field on every selected record. "Assign owner" is this with the owner field chosen. */
function BulkEditDialog({ object, ids, initialProperty, onClose, onDone }: { object: ObjectDefinition; ids: string[]; initialProperty?: string; onClose: () => void; onDone: () => void }) {
  const editable = object.properties.filter((property) => !property.system && property.type !== 'reference' && property.type !== 'multiselect' && property.id !== object.primaryProperty && !property.unique);
  const [propertyId, setPropertyId] = useState(initialProperty && editable.some((item) => item.id === initialProperty) ? initialProperty : (editable[0]?.id ?? ''));
  const [value, setValue] = useState<Value>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const property = editable.find((item) => item.id === propertyId);
  const noun = ids.length === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase();

  async function apply() {
    if (!property) return;
    setBusy(true);
    setError(undefined);
    try {
      await Promise.all(ids.map((id) => api.updateRecord({ id, properties: { [property.id]: value } })));
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="sm" title={`Edit ${ids.length.toLocaleString('en-US')} ${noun}`} submitLabel={`Update ${ids.length.toLocaleString('en-US')} ${noun}`} busy={busy} error={error} onClose={onClose} onSubmit={apply}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="bulk-property">
          Field to change
        </label>
        <select
          className="m-select"
          id="bulk-property"
          value={propertyId}
          onChange={(event) => {
            setPropertyId(event.target.value);
            setValue(null);
          }}
        >
          {editable.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {property ? (
        <div className="m-field" data-layout={property.type === 'boolean' ? 'inline' : undefined}>
          <label className="m-field-label" htmlFor="bulk-value">
            New value
          </label>
          <PropertyInput id="bulk-value" property={property} value={value} onChange={setValue} />
        </div>
      ) : null}
    </Modal>
  );
}

/** Put the selected contacts into a sequence. Contacts already in it, or without an email, are left out and named. */
function EnrollDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const sequences = useQuery(() => api.listSequences(), []);
  const [sequenceId, setSequenceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const chosen = sequences.data?.find((sequence) => sequence.id === (sequenceId || sequences.data?.[0]?.id));

  async function enroll() {
    if (!chosen) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.enrollContacts({ sequenceId: chosen.id, contactIds: ids });
      const left = result.skipped.length > 0 ? ` ${result.skipped.length.toLocaleString('en-US')} left out: ${result.skipped[0]?.reason ?? ''}${result.skipped.length > 1 ? ` (and ${result.skipped.length - 1} more)` : ''}` : '';
      onDone(`Enrolled ${result.enrolled.toLocaleString('en-US')} ${result.enrolled === 1 ? 'contact' : 'contacts'} in "${chosen.name}".${left}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The contacts could not be enrolled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="sm" title={`Enrol ${ids.length.toLocaleString('en-US')} ${ids.length === 1 ? 'contact' : 'contacts'}`} submitLabel="Enrol" busy={busy} error={error} onClose={onClose} onSubmit={enroll}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="enroll-sequence">
          Sequence
        </label>
        <select className="m-select" id="enroll-sequence" value={chosen?.id ?? ''} onChange={(event) => setSequenceId(event.target.value)}>
          {(sequences.data ?? []).map((sequence) => (
            <option key={sequence.id} value={sequence.id}>
              {sequence.name}
              {sequence.status === 'paused' ? ' (paused)' : ''}
            </option>
          ))}
        </select>
        {chosen ? (
          <p className="m-field-hint">
            {chosen.steps.length} steps. {chosen.status === 'paused' ? 'It is paused, so nothing is sent until it is started.' : 'The first step runs straight away.'}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function RecordTable({
  object,
  columnIds,
  filters,
  viewName,
  search,
  sort,
  page,
  onSort,
  onPage,
  onTotal,
  onNotice,
}: {
  object: ObjectDefinition;
  columnIds: string[];
  filters: Filter[];
  viewName: string;
  search: string;
  sort: Sort | undefined;
  page: number;
  onSort: (sort: Sort) => void;
  onPage: (page: number) => void;
  onTotal: (total: number) => void;
  onNotice: (message: string) => void;
}) {
  const { revision, touch } = useWorkspace();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ kind: 'edit'; property?: string } | { kind: 'delete' } | { kind: 'enroll' }>();
  const [busy, setBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string>();
  const sortKey = sort ? `${sort.property}:${sort.direction}` : '';
  const filterKey = JSON.stringify(filters);
  const { data, loading, error } = useQuery(() => api.listRecords({ objectId: object.id, filters, search, sort, page, pageSize: PAGE_SIZE }), [object.id, filterKey, search, sortKey, page, revision]);

  // A new query shows different rows, so the old selection no longer means anything.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query change only
  useEffect(() => setSelected(new Set()), [object.id, filterKey, search, sortKey, page]);

  const total = data?.total;
  useEffect(() => {
    if (total !== undefined) onTotal(total);
  }, [total, onTotal]);

  const columns = columnIds.map((id) => object.properties.find((property) => property.id === id)).filter((property): property is PropertyDefinition => property !== undefined);
  const records = data?.records ?? [];
  const allSelected = records.length > 0 && records.every((record) => selected.has(record.id));
  const pages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total ?? 0);
  const ids = [...selected];
  const noun = ids.length === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase();
  const hasOwner = object.properties.some((property) => property.id === 'owner');

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function finishBulk() {
    setBulk(undefined);
    setSelected(new Set());
    touch();
  }

  async function removeSelected() {
    setBusy(true);
    setBulkError(undefined);
    try {
      await api.deleteRecords(ids);
      finishBulk();
    } catch (cause) {
      setBulkError(cause instanceof Error ? cause.message : 'The records could not be deleted.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="m-alert" data-tone="danger" role="alert" style={{ margin: 'var(--m-space-3)' }}>
        <div className="m-alert-content">
          <p className="m-alert-title">These {object.plural.toLowerCase()} didn't load</p>
          <p className="m-alert-body">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0', opacity: loading && data ? 0.6 : 1 } as CSSProperties}>
        <table className="m-table">
          <thead>
            {selected.size > 0 ? (
              <tr>
                <th style={{ inlineSize: 40 }}>
                  <input className="m-checkbox" type="checkbox" aria-label="Clear the selection" checked={allSelected} onChange={() => setSelected(new Set())} />
                </th>
                <th colSpan={columns.length}>
                  <div className="m-cluster" data-gap="2">
                    <span style={{ color: 'var(--m-color-fg-default)' }}>{selected.size} selected</span>
                    {hasOwner ? (
                      <button type="button" className="m-button" data-size="sm" style={toolbarButton} onClick={() => setBulk({ kind: 'edit', property: 'owner' })}>
                        <UserPlus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Assign owner
                      </button>
                    ) : null}
                    <button type="button" className="m-button" data-size="sm" style={toolbarButton} onClick={() => setBulk({ kind: 'edit' })}>
                      <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Edit a field
                    </button>
                    {object.id === 'contacts' ? (
                      <button type="button" className="m-button" data-size="sm" style={toolbarButton} onClick={() => setBulk({ kind: 'enroll' })}>
                        <Send size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Enrol in sequence
                      </button>
                    ) : null}
                    <button type="button" className="m-button" data-size="sm" style={toolbarButton} onClick={() => setBulk({ kind: 'delete' })}>
                      <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Delete
                    </button>
                  </div>
                </th>
              </tr>
            ) : (
              <tr>
                <th style={{ inlineSize: 40 }}>
                  <input
                    className="m-checkbox"
                    type="checkbox"
                    aria-label={`Select all ${object.plural.toLowerCase()} on this page`}
                    checked={allSelected}
                    onChange={() => setSelected(new Set(records.map((record) => record.id)))}
                  />
                </th>
                {columns.map((column) => {
                  const direction = sort?.property === column.id ? sort.direction : undefined;
                  return (
                    <th key={column.id} scope="col" data-numeric={NUMERIC.has(column.type) ? '' : undefined} aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                      <button
                        type="button"
                        onClick={() => onSort({ property: column.id, direction: direction === 'asc' ? 'desc' : 'asc' })}
                        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 'var(--m-space-1)' }}
                      >
                        {column.label}
                        {direction === 'asc' ? <ArrowUp size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden /> : null}
                        {direction === 'desc' ? <ArrowDown size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden /> : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {!data
              ? Array.from({ length: 12 }, (_, row) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows
                  <tr key={row}>
                    <td />
                    {columns.map((column) => (
                      <td key={column.id}>
                        <span className="m-skeleton" style={{ display: 'block', inlineSize: '70%', blockSize: 12 }} />
                      </td>
                    ))}
                  </tr>
                ))
              : records.map((record) => {
                  const isSelected = selected.has(record.id);
                  const name = record.properties[object.primaryProperty];
                  return (
                    <tr key={record.id} aria-selected={isSelected} style={isSelected ? { background: 'var(--m-color-bg-sunken)' } : undefined}>
                      <td style={{ inlineSize: 40 }}>
                        <input className="m-checkbox" type="checkbox" aria-label={`Select ${String(name)}`} checked={isSelected} onChange={() => toggle(record.id)} />
                      </td>
                      {columns.map((column) => (
                        <td key={column.id} data-numeric={NUMERIC.has(column.type) ? '' : undefined}>
                          {column.id === object.primaryProperty ? (
                            <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
                              <CompleteButton object={object} record={record} />
                              <Link
                                to={`/${object.id}/${record.id}`}
                                style={{
                                  color: isComplete(object, record) ? 'var(--m-color-fg-muted)' : 'inherit',
                                  textDecoration: isComplete(object, record) ? 'line-through' : 'none',
                                  fontWeight: 'var(--m-font-weight-semibold)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {String(name ?? 'Untitled')}
                              </Link>
                            </span>
                          ) : (
                            <PropertyValue property={column} value={record.properties[column.id]} references={data.references} />
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {data && records.length === 0 ? (
        <div className="m-stack" data-gap="1" style={{ padding: 'var(--m-space-10) var(--m-space-4)', textAlign: 'center', alignItems: 'center' }}>
          <span style={{ fontWeight: 'var(--m-font-weight-medium)' }}>No {object.plural.toLowerCase()} match</span>
          <span style={small}>{search ? `Nothing in "${viewName}" matches "${search}".` : `"${viewName}" is empty right now.`}</span>
        </div>
      ) : null}
      <div className="m-cluster" data-justify="center" style={{ padding: 'var(--m-space-2)', borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
        <nav className="m-pagination" aria-label="Pages">
          <button type="button" className="m-pagination-item" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <button type="button" className="m-pagination-item" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </nav>
        <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>
          {total === undefined ? 'Loading…' : total === 0 ? '0 results' : `${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`}
        </span>
      </div>
      {bulk?.kind === 'enroll' ? (
        <EnrollDialog
          ids={ids}
          onClose={() => setBulk(undefined)}
          onDone={(message) => {
            onNotice(message);
            finishBulk();
          }}
        />
      ) : null}
      {bulk?.kind === 'edit' ? <BulkEditDialog object={object} ids={ids} initialProperty={bulk.property} onClose={() => setBulk(undefined)} onDone={finishBulk} /> : null}
      <Modal
        open={bulk?.kind === 'delete'}
        size="sm"
        tone="danger"
        title={`Delete ${ids.length.toLocaleString('en-US')} ${noun}?`}
        description="They are removed along with their notes and activity. In the finished product they go to a recycle bin for 90 days; in this mock they are gone until the page reloads."
        submitLabel={`Delete ${ids.length.toLocaleString('en-US')} ${noun}`}
        busy={busy}
        error={bulkError}
        onClose={() => setBulk(undefined)}
        onSubmit={removeSelected}
      />
    </>
  );
}

/** Save the current filters, columns and sort as a new view. */
function SaveViewDialog({ object, view, settings, onClose, onSaved }: { object: ObjectDefinition; view: ViewDefinition; settings: { columns: string[]; filters: Filter[]; sort?: Sort }; onClose: () => void; onSaved: (viewId: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.saveView({ objectId: object.id, name, ...settings });
      onSaved(saved.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The view could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="sm" title="Save as a new view" description={`A copy of "${view.name}" with your changes. It appears as a tab for everyone.`} submitLabel="Save view" busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="view-name">
          Name
        </label>
        <input className="m-input" id="view-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
    </Modal>
  );
}

/** The index page for any object: saved views, filters, columns, search, sorting, selection, bulk actions and paging, all from its definition. */
export function RecordList() {
  const { objectId } = useParams();
  const workspace = useWorkspace();
  const object = workspace.object(objectId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [total, setTotal] = useState<number>();
  const [dialog, setDialog] = useState<{ kind: 'filter'; index?: number } | { kind: 'columns' } | { kind: 'save' }>();
  const [savingView, setSavingView] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the count belongs to one object
  useEffect(() => setTotal(undefined), [objectId]);

  const view = object?.views.find((item) => item.id === params.get('view')) ?? object?.views[0];
  const filterParam = params.get('f');
  const columnParam = params.get('cols');
  const sortParam = params.get('sort');
  // What is on screen: the saved view, with any changes made since.
  const filters = useMemo(() => parseFilters(filterParam) ?? view?.filters ?? [], [filterParam, view]);
  const columns = useMemo(() => (columnParam ? columnParam.split(',') : (view?.columns ?? [])), [columnParam, view]);
  const sort = useMemo(() => parseSort(sortParam) ?? view?.sort, [sortParam, view]);

  if (!object || !view) return <Navigate to="/" replace />;

  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const layout = object.board && params.get('layout') === 'board' ? 'board' : 'table';
  const changed = filterParam !== null || columnParam !== null || sortParam !== null;

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  const setFilters = (next: Filter[]) => update({ f: JSON.stringify(next), page: undefined });
  const reset = () => update({ f: undefined, cols: undefined, sort: undefined, page: undefined });

  async function exportView() {
    if (!object || !view) return;
    setExporting(true);
    setNotice(undefined);
    try {
      const done = await exportRecords({ object, columns, filters, search, sort, users: workspace.users, fileName: `${object.id}-${view.id}.csv` });
      setNotice(
        done.exported < done.total
          ? `Exported the first ${done.exported.toLocaleString('en-US')} of ${done.total.toLocaleString('en-US')} ${object.plural.toLowerCase()}. This mock stops at ${EXPORT_LIMIT.toLocaleString('en-US')} rows.`
          : `Exported ${done.exported.toLocaleString('en-US')} ${done.exported === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase()} to your downloads.`,
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? `The export failed: ${cause.message}` : 'The export failed.');
    } finally {
      setExporting(false);
    }
  }

  async function saveOver() {
    if (!object || !view) return;
    setSavingView(true);
    try {
      await api.saveView({ objectId: object.id, viewId: view.id, name: view.name, columns, filters, sort });
      await workspace.reload();
      reset();
    } finally {
      setSavingView(false);
    }
  }

  return (
    <Page
      icon={objectIcon(object.icon)}
      crumbs={[{ label: object.plural }]}
      wide
      actions={
        <>
          {object.completion ? null : (
            <Link to={`/import?object=${object.id}`} className="m-button" data-size="sm" style={toolbarButton}>
              <Upload size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Import
            </Link>
          )}
          <button type="button" className="m-button" data-size="sm" style={toolbarButton} disabled={exporting} onClick={() => void exportView()} title={`Download "${view.name}" as a CSV file`}>
            <Download size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {exporting ? 'Exporting…' : 'Export'}
          </button>
          <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => setCreating(true)}>
            <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {object.singular}
          </button>
        </>
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-cluster" data-gap="2" data-align="baseline">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>{object.plural}</h1>
          {layout === 'table' && total !== undefined ? <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{total.toLocaleString('en-US')}</span> : null}
        </div>
        {notice ? (
          <output className="m-alert" data-tone="info">
            <div className="m-alert-content">
              <p className="m-alert-body">{notice}</p>
            </div>
          </output>
        ) : null}
        <section className="m-card" aria-label={object.plural} style={{ padding: 0, overflow: 'hidden' }}>
          <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-2)' }}>
            <ViewTabs object={object} view={view} onSelect={(viewId) => update({ view: viewId, page: undefined, sort: undefined, f: undefined, cols: undefined })} />
            <div className="m-cluster" data-gap="2">
              <SearchBox value={search} label={`Search ${object.plural.toLowerCase()}`} onChange={(value) => update({ q: value, page: undefined })} />
              {object.board ? (
                <div className="m-cluster" data-gap="1" role="group" aria-label="Layout">
                  <button type="button" className="m-button" data-size="sm" data-icon-only aria-label="Table" aria-pressed={layout === 'table'} style={layout === 'table' ? toolbarButton : undefined} data-variant={layout === 'table' ? undefined : 'ghost'} onClick={() => update({ layout: undefined })}>
                    <List size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </button>
                  <button type="button" className="m-button" data-size="sm" data-icon-only aria-label="Board" aria-pressed={layout === 'board'} style={layout === 'board' ? toolbarButton : undefined} data-variant={layout === 'board' ? undefined : 'ghost'} onClick={() => update({ layout: 'board', page: undefined })}>
                    <Columns3 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="m-cluster" data-justify="between" data-gap="2" style={{ padding: '0 var(--m-space-2) var(--m-space-2)' }}>
            <div className="m-cluster" data-gap="1" role="group" aria-label="Filters">
              <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-subtle)', paddingInline: 'var(--m-space-1)' }}>
                <FilterIcon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
              </span>
              {filters.map((filter, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: filters have no identity beyond their position
                <span key={index} className="m-badge" style={{ gap: 'var(--m-space-1)' }}>
                  <button type="button" onClick={() => setDialog({ kind: 'filter', index })} style={{ all: 'unset', cursor: 'pointer' }}>
                    {describeFilter(filter, object, workspace.users)}
                  </button>
                  <button type="button" aria-label={`Remove filter: ${describeFilter(filter, object, workspace.users)}`} onClick={() => setFilters(filters.filter((_, position) => position !== index))} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}>
                    <X size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </button>
                </span>
              ))}
              {filters.length === 0 ? <span style={small}>No filters</span> : null}
              <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setDialog({ kind: 'filter' })}>
                <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Filter
              </button>
            </div>
            <div className="m-cluster" data-gap="1">
              {changed ? (
                <>
                  <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={reset}>
                    Reset
                  </button>
                  <button type="button" className="m-button" data-size="sm" disabled={savingView} onClick={() => void saveOver()}>
                    {savingView ? 'Saving…' : `Save to "${view.name}"`}
                  </button>
                  <button type="button" className="m-button" data-size="sm" onClick={() => setDialog({ kind: 'save' })}>
                    Save as new view
                  </button>
                </>
              ) : null}
              {layout === 'table' ? (
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setDialog({ kind: 'columns' })}>
                  <SlidersHorizontal size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Columns
                </button>
              ) : (
                <span style={{ ...small, display: 'inline-flex', alignItems: 'center', gap: 'var(--m-space-1)' }}>
                  <LayoutList size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Drag a card to change its stage
                </span>
              )}
            </div>
          </div>
          {layout === 'board' ? (
            <RecordBoard object={object} filters={filters} search={search} />
          ) : (
            <RecordTable
              object={object}
              columnIds={columns}
              filters={filters}
              viewName={view.name}
              search={search}
              sort={sort}
              page={page}
              onSort={(next) => update({ sort: `${next.property}:${next.direction}`, page: undefined })}
              onPage={(next) => update({ page: next > 1 ? String(next) : undefined })}
              onTotal={setTotal}
              onNotice={setNotice}
            />
          )}
        </section>
      </div>
      {creating ? (
        <CreateRecordDialog
          object={object}
          onClose={() => setCreating(false)}
          onCreated={(record) => {
            setCreating(false);
            navigate(`/${object.id}/${record.id}`);
          }}
        />
      ) : null}
      {dialog?.kind === 'filter' ? (
        <FilterDialog
          object={object}
          initial={dialog.index === undefined ? undefined : filters[dialog.index]}
          onClose={() => setDialog(undefined)}
          onSave={(filter) => {
            setFilters(dialog.index === undefined ? [...filters, filter] : filters.map((item, position) => (position === dialog.index ? filter : item)));
            setDialog(undefined);
          }}
        />
      ) : null}
      {dialog?.kind === 'columns' ? (
        <ColumnsDialog
          object={object}
          columns={columns}
          onClose={() => setDialog(undefined)}
          onSave={(next) => {
            // Keep the object's own order, so columns don't jump around as they are ticked.
            update({
              cols: object.properties
                .filter((property) => next.includes(property.id))
                .map((property) => property.id)
                .join(','),
            });
            setDialog(undefined);
          }}
        />
      ) : null}
      {dialog?.kind === 'save' ? (
        <SaveViewDialog
          object={object}
          view={view}
          settings={{ columns, filters, sort }}
          onClose={() => setDialog(undefined)}
          onSaved={async (viewId) => {
            await workspace.reload();
            setDialog(undefined);
            update({ view: viewId, f: undefined, cols: undefined, sort: undefined, page: undefined });
          }}
        />
      ) : null}
    </Page>
  );
}
