import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, List, Plus, Search, Trash2, Upload, UserPlus } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition, PropertyDefinition, Sort, ViewDefinition } from '../contracts/metadata';
import { PropertyValue } from '../ui/PropertyValue';
import { objectIcon } from '../ui/icons';
import { ICON, figure, small, toolbarButton } from '../ui/styles';
import { CreateRecordDialog } from './CreateRecordDialog';
import { RecordBoard } from './RecordBoard';

const PAGE_SIZE = 50;
const NUMERIC = new Set<PropertyDefinition['type']>(['number', 'currency']);

function parseSort(text: string | null): Sort | undefined {
  if (!text) return undefined;
  const [property, direction] = text.split(':');
  if (!property || (direction !== 'asc' && direction !== 'desc')) return undefined;
  return { property, direction };
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
      <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Add a view">
        <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
      </button>
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

function RecordTable({
  object,
  view,
  search,
  sort,
  page,
  onSort,
  onPage,
  onTotal,
}: {
  object: ObjectDefinition;
  view: ViewDefinition;
  search: string;
  sort: Sort | undefined;
  page: number;
  onSort: (sort: Sort) => void;
  onPage: (page: number) => void;
  onTotal: (total: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sortKey = sort ? `${sort.property}:${sort.direction}` : '';
  const { data, loading, error } = useQuery(
    () => api.listRecords({ objectId: object.id, viewId: view.id, search, sort, page, pageSize: PAGE_SIZE }),
    [object.id, view.id, search, sortKey, page],
  );

  // A new query shows different rows, so the old selection no longer means anything.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query change only
  useEffect(() => setSelected(new Set()), [object.id, view.id, search, sortKey, page]);

  const total = data?.total;
  useEffect(() => {
    if (total !== undefined) onTotal(total);
  }, [total, onTotal]);

  const columns = view.columns
    .map((id) => object.properties.find((property) => property.id === id))
    .filter((property): property is PropertyDefinition => property !== undefined);
  const activeSort = sort ?? view.sort;
  const records = data?.records ?? [];
  const allSelected = records.length > 0 && records.every((record) => selected.has(record.id));
  const pages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total ?? 0);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
                    <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
                      <UserPlus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Assign owner
                    </button>
                    <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
                      <List size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Add to list
                    </button>
                    <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
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
                  const direction = activeSort?.property === column.id ? activeSort.direction : undefined;
                  const numeric = NUMERIC.has(column.type);
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      data-numeric={numeric ? '' : undefined}
                      aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
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
                            <Link to={`/${object.id}/${record.id}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 'var(--m-font-weight-semibold)', whiteSpace: 'nowrap' }}>
                              {String(name ?? 'Untitled')}
                            </Link>
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
          <span style={small}>{search ? `Nothing in "${view.name}" matches "${search}".` : `"${view.name}" is empty right now.`}</span>
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
    </>
  );
}

/** The index page for any object: saved views, search, sorting, selection and paging, all from its definition. */
export function RecordList() {
  const { objectId } = useParams();
  const { object: findObject } = useWorkspace();
  const object = findObject(objectId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [total, setTotal] = useState<number>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the count belongs to one object
  useEffect(() => setTotal(undefined), [objectId]);

  if (!object) return <Navigate to="/" replace />;

  const view = object.views.find((item) => item.id === params.get('view')) ?? (object.views[0] as ViewDefinition);
  const search = params.get('q') ?? '';
  const sort = parseSort(params.get('sort'));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const layout = object.board && params.get('layout') === 'board' ? 'board' : 'table';

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  return (
    <Page
      icon={objectIcon(object.icon)}
      crumbs={[{ label: object.plural }]}
      wide
      actions={
        <>
          <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
            <Upload size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Import
          </button>
          <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
            <Download size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Export
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
        <section className="m-card" aria-label={object.plural} style={{ padding: 0, overflow: 'hidden' }}>
          <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-2)' }}>
            <ViewTabs object={object} view={view} onSelect={(viewId) => update({ view: viewId, page: undefined, sort: undefined })} />
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
          {layout === 'board' ? (
            <RecordBoard object={object} view={view} search={search} />
          ) : (
            <RecordTable
              object={object}
              view={view}
              search={search}
              sort={sort}
              page={page}
              onSort={(next) => update({ sort: `${next.property}:${next.direction}`, page: undefined })}
              onPage={(next) => update({ page: next > 1 ? String(next) : undefined })}
              onTotal={setTotal}
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
    </Page>
  );
}
