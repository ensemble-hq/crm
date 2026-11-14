import { type CSSProperties, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import type { Filter, ObjectDefinition, Option } from '../contracts/metadata';
import type { CrmRecord, Reference } from '../contracts/records';
import { UserChip, formatDate } from '../ui/PropertyValue';
import { compactCurrency, currency, small } from '../ui/styles';

const COLUMN_LIMIT = 12;
const DRAG_TYPE = 'application/x-crm-record';

type Column = { option: Option; count: number; sum: number; records: CrmRecord[] };

/**
 * A board for any object that moves through stages. Each column is one option of the object's
 * `board.groupBy` property; dragging a card to another column changes that property.
 */
export function RecordBoard({ object, filters, search }: { object: ObjectDefinition; filters: Filter[]; search: string }) {
  const { revision, touch } = useWorkspace();
  const filterKey = JSON.stringify(filters);
  const board = object.board;
  const groupBy = object.properties.find((property) => property.id === board?.groupBy);
  const [over, setOver] = useState<string>();

  const { data, loading, error, reload } = useQuery(async () => {
    if (!board || !groupBy) return { columns: [] as Column[], references: {} as Record<string, Reference> };
    const scope = { objectId: object.id, search };
    const summary = await api.summarize({ ...scope, filters, groupBy: board.groupBy, sumProperty: board.sumProperty });
    // When the view already narrows the stages, only show the stages it lets through.
    const narrowed = filters.some((filter) => filter.property === board.groupBy);
    const options = (groupBy.options ?? []).filter((option) => !narrowed || summary.some((row) => row.value === option.id));
    const lists = await Promise.all(
      options.map((option) =>
        api.listRecords({
          ...scope,
          filters: [...filters, { property: board.groupBy, operator: 'eq', value: option.id }],
          sort: board.dateProperty ? { property: board.dateProperty, direction: 'asc' } : undefined,
          page: 1,
          pageSize: COLUMN_LIMIT,
        }),
      ),
    );
    const references: Record<string, Reference> = {};
    const columns = options.map((option, index) => {
      const row = summary.find((item) => item.value === option.id);
      Object.assign(references, lists[index]?.references);
      return { option, count: row?.count ?? 0, sum: row?.sum ?? 0, records: lists[index]?.records ?? [] };
    });
    return { columns, references };
  }, [object.id, filterKey, search, revision]);

  if (!board || !groupBy) return null;

  async function move(recordId: string, optionId: string) {
    await api.updateRecord({ id: recordId, properties: { [groupBy?.id ?? '']: optionId } });
    reload();
    touch();
  }

  if (error) {
    return (
      <div className="m-alert" data-tone="danger" role="alert" style={{ margin: 'var(--m-space-3)' }}>
        <div className="m-alert-content">
          <p className="m-alert-title">The board didn't load</p>
          <p className="m-alert-body">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minBlockSize: 320 }}>
        <span className="m-spinner" role="status" aria-label="Loading the board" />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--m-space-3)',
        padding: 'var(--m-space-3)',
        overflowX: 'auto',
        alignItems: 'flex-start',
        borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)',
        background: 'var(--m-color-bg-sunken)',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {data.columns.map((column) => (
        <section
          key={column.option.id}
          aria-label={column.option.label}
          className="m-stack"
          data-gap="2"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            setOver(column.option.id);
          }}
          onDragLeave={() => setOver((current) => (current === column.option.id ? undefined : current))}
          onDrop={(event) => {
            event.preventDefault();
            setOver(undefined);
            const recordId = event.dataTransfer.getData(DRAG_TYPE);
            if (recordId && !column.records.some((record) => record.id === recordId)) void move(recordId, column.option.id);
          }}
          style={{
            flex: '0 0 272px',
            padding: 'var(--m-space-2)',
            borderRadius: 'var(--m-radius-lg)',
            outline: over === column.option.id ? '2px solid var(--m-color-border-focus, var(--m-color-accent-default))' : 'none',
          }}
        >
          <header className="m-stack" data-gap="0" style={{ padding: '0 var(--m-space-1)' }}>
            <div className="m-cluster" data-justify="between">
              <span style={{ fontWeight: 'var(--m-font-weight-medium)' }}>{column.option.label}</span>
              <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{column.count.toLocaleString('en-US')}</span>
            </div>
            {board.sumProperty ? <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{compactCurrency(column.sum)}</span> : null}
          </header>
          {column.records.map((record) => (
            <BoardCard key={record.id} object={object} record={record} references={data.references} />
          ))}
          {column.count > column.records.length ? (
            <Link to={`/${object.id}?view=all`} style={{ ...small, padding: 'var(--m-space-1)', textDecoration: 'none' }}>
              {(column.count - column.records.length).toLocaleString('en-US')} more
            </Link>
          ) : null}
          {column.count === 0 ? <span style={{ ...small, padding: 'var(--m-space-1)' }}>Nothing here</span> : null}
        </section>
      ))}
    </div>
  );
}

function BoardCard({ object, record, references }: { object: ObjectDefinition; record: CrmRecord; references: Record<string, Reference> }) {
  const board = object.board;
  const name = record.properties[object.primaryProperty];
  const secondary = object.secondaryProperty ? record.properties[object.secondaryProperty] : undefined;
  const secondaryLabel = typeof secondary === 'string' ? (references[secondary]?.label ?? secondary) : undefined;
  const amount = board?.sumProperty ? record.properties[board.sumProperty] : undefined;
  const date = board?.dateProperty ? record.properties[board.dateProperty] : undefined;
  const owner = record.properties.owner;

  return (
    <article
      className="m-card"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, record.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      style={{ '--m-card-radius': 'var(--m-radius-lg)', cursor: 'grab' } as CSSProperties}
    >
      <div className="m-stack" data-gap="2" style={{ padding: 'var(--m-space-3)' }}>
        <div className="m-stack" data-gap="0">
          <Link to={`/${object.id}/${record.id}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 'var(--m-font-weight-medium)' }}>
            {String(name ?? 'Untitled')}
          </Link>
          {secondaryLabel ? <span style={small}>{secondaryLabel}</span> : null}
        </div>
        <div className="m-cluster" data-justify="between">
          {typeof amount === 'number' ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--m-font-weight-medium)' }}>{currency(amount)}</span> : <span />}
          {typeof date === 'string' ? <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{formatDate(date)}</span> : null}
        </div>
        {typeof owner === 'string' ? (
          <span style={small}>
            <UserChip userId={owner} />
          </span>
        ) : null}
      </div>
    </article>
  );
}
