import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import type { Filter, ObjectDefinition } from '../contracts/metadata';
import { isComplete } from '../ui/CompleteButton';
import { ICON, medium, small } from '../ui/styles';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const PER_DAY = 3;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A month of records laid out by a date: deals by close date, tasks by due date. Works for any
 * object whose definition has `calendar`. The view's filters and the search still apply.
 */
export function RecordCalendar({ object, filters, search }: { object: ObjectDefinition; filters: Filter[]; search: string }) {
  const { revision } = useWorkspace();
  const today = iso(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const dateProperty = object.calendar?.dateProperty ?? '';
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const last = new Date(Date.UTC(year, monthNumber, 0));
  const filterKey = JSON.stringify(filters);

  const { data, loading, error } = useQuery(
    () =>
      api.listRecords({
        objectId: object.id,
        filters: [...filters, { property: dateProperty, operator: 'between', value: [iso(first), iso(last)] }],
        search,
        sort: { property: dateProperty, direction: 'asc' },
        page: 1,
        pageSize: 200,
      }),
    [object.id, filterKey, search, month, revision],
  );

  if (!object.calendar) return null;

  const byDay = new Map<string, NonNullable<typeof data>['records']>();
  for (const record of data?.records ?? []) {
    const day = String(record.properties[dateProperty] ?? '').slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), record]);
  }

  // Blank cells before the 1st so it sits under its weekday, with weeks starting on Monday.
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: last.getUTCDate() }, (_, index) => iso(new Date(Date.UTC(year, monthNumber - 1, index + 1))))];
  while (cells.length % 7 !== 0) cells.push(null);
  const shift = (by: number) => setMonth(iso(new Date(Date.UTC(year, monthNumber - 1 + by, 1))).slice(0, 7));
  const propertyLabel = object.properties.find((property) => property.id === dateProperty)?.label.toLowerCase() ?? 'date';

  return (
    <div style={{ borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)', opacity: loading && data ? 0.6 : 1 }}>
      <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-2) var(--m-space-3)' }}>
        <div className="m-cluster" data-gap="2">
          <button type="button" className="m-button" data-size="sm" data-icon-only aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <button type="button" className="m-button" data-size="sm" data-icon-only aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <span style={medium}>{monthFormat.format(first)}</span>
          {month !== today.slice(0, 7) ? (
            <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setMonth(today.slice(0, 7))}>
              This month
            </button>
          ) : null}
        </div>
        <span style={small}>
          {error ? `The calendar didn't load: ${error.message}` : data ? `${data.total.toLocaleString('en-US')} ${data.total === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase()} by ${propertyLabel}${data.total > data.records.length ? `, showing the first ${data.records.length}` : ''}` : 'Loading…'}
        </span>
      </div>
      <div role="grid" aria-label={monthFormat.format(first)} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} role="columnheader" style={{ ...small, padding: 'var(--m-space-1) var(--m-space-2)', background: 'var(--m-color-bg-sunken)' }}>
            {weekday}
          </div>
        ))}
        {cells.map((day, index) => {
          const records = day ? (byDay.get(day) ?? []) : [];
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of day cells
              key={index}
              role="gridcell"
              className="m-stack"
              data-gap="1"
              style={{
                minBlockSize: 104,
                padding: 'var(--m-space-1) var(--m-space-2)',
                borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)',
                borderInlineStart: index % 7 === 0 ? undefined : 'var(--m-border-width-thin) solid var(--m-color-border-muted)',
                background: day ? undefined : 'var(--m-color-bg-sunken)',
              }}
            >
              {day ? (
                <span
                  style={{
                    ...small,
                    fontVariantNumeric: 'tabular-nums',
                    ...(day === today ? { color: 'var(--m-color-fg-default)', fontWeight: 'var(--m-font-weight-semibold)' } : {}),
                  }}
                >
                  {Number(day.slice(8))}
                  {day === today ? ' · today' : ''}
                </span>
              ) : null}
              {records.slice(0, PER_DAY).map((record) => (
                <Link
                  key={record.id}
                  to={`/${object.id}/${record.id}`}
                  title={String(record.properties[object.primaryProperty] ?? '')}
                  style={{
                    fontSize: 'var(--m-font-size-sm)',
                    padding: '1px var(--m-space-1)',
                    borderRadius: 'var(--m-radius-sm)',
                    background: 'var(--m-color-bg-sunken)',
                    color: isComplete(object, record) ? 'var(--m-color-fg-muted)' : 'inherit',
                    textDecoration: isComplete(object, record) ? 'line-through' : 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {String(record.properties[object.primaryProperty] ?? 'Untitled')}
                </Link>
              ))}
              {records.length > PER_DAY ? <span style={small}>{records.length - PER_DAY} more</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
