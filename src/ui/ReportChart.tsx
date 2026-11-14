import type { CSSProperties } from 'react';
import type { ObjectDefinition } from '../contracts/metadata';
import type { ReportResult, ReportSettings } from '../contracts/reports';
import { compactCurrency, currency, plainList, small } from './styles';

/** Formats a report's numbers the way its measure calls for: money for a currency property, otherwise a plain number. */
export function valueFormatter(settings: ReportSettings, object: ObjectDefinition | undefined): { short: (value: number) => string; long: (value: number) => string } {
  const property = settings.measure.kind === 'count' ? undefined : object?.properties.find((item) => item.id === (settings.measure as { property: string }).property);
  if (property?.type === 'currency') return { short: compactCurrency, long: currency };
  const plain = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: settings.measure.kind === 'average' ? 1 : 0 });
  const compact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return { short: (value) => (Math.abs(value) >= 10_000 ? compact(value) : plain(value)), long: plain };
}

/** What the measure is, in words: "Total amount", "Number of contacts". */
export function measureLabel(settings: ReportSettings, object: ObjectDefinition | undefined): string {
  if (settings.measure.kind === 'count') return `Number of ${object?.plural.toLowerCase() ?? 'records'}`;
  const property = object?.properties.find((item) => item.id === (settings.measure as { property: string }).property);
  return `${settings.measure.kind === 'sum' ? 'Total' : 'Average'} ${property?.label.toLowerCase() ?? 'value'}`;
}

const SERIES = 'var(--m-color-info-border)';

function Empty() {
  return <p style={{ ...small, margin: 0, paddingBlock: 'var(--m-space-4)' }}>No records match this report.</p>;
}

function Bars({ result, format }: { result: ReportResult; format: (value: number) => string }) {
  const largest = Math.max(...result.rows.map((row) => row.value), 1);
  return (
    <ul className="m-stack" data-gap="2" style={plainList}>
      {result.rows.map((row) => (
        <li key={row.key ?? 'none'} className="m-stack" data-gap="1">
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
          <div className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
            <span aria-hidden style={{ flex: `0 0 ${Math.max(1, Math.round((row.value / largest) * 76))}%`, blockSize: 8, borderRadius: 'var(--m-radius-full)', background: SERIES }} />
            <strong style={{ fontWeight: 'var(--m-font-weight-semibold)', fontVariantNumeric: 'tabular-nums' }}>{format(row.value)}</strong>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Which labels to print under a row of columns or points so they never collide: about six at most. */
function shownLabels(count: number): Set<number> {
  const step = Math.max(1, Math.ceil(count / 6));
  const shown = new Set<number>();
  for (let index = count - 1; index >= 0; index -= step) shown.add(index);
  return shown;
}

function Columns({ result, format, height }: { result: ReportResult; format: (value: number) => string; height: number }) {
  const largest = Math.max(...result.rows.map((row) => row.value), 1);
  const labels = shownLabels(result.rows.length);
  return (
    <div className="m-stack" data-gap="1">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--m-space-1)', blockSize: height, borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
        {result.rows.map((row) => (
          <div key={row.key ?? 'none'} title={`${row.label}: ${format(row.value)}`} style={{ flex: 1, minInlineSize: 0, blockSize: `${Math.max(1, (row.value / largest) * 100)}%`, borderRadius: 'var(--m-radius-sm) var(--m-radius-sm) 0 0', background: SERIES }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--m-space-1)' }}>
        {result.rows.map((row, index) => (
          <span key={row.key ?? 'none'} style={{ ...small, flex: 1, minInlineSize: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'visible', fontVariantNumeric: 'tabular-nums' }}>
            {labels.has(index) ? row.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function Line({ result, format, height, label }: { result: ReportResult; format: (value: number) => string; height: number; label: string }) {
  const width = 600;
  const drawn = 160;
  const largest = Math.max(...result.rows.map((row) => row.value), 1);
  const step = width / Math.max(result.rows.length - 1, 1);
  const points = result.rows.map((row, index) => `${(index * step).toFixed(1)},${(drawn - (row.value / largest) * (drawn - 16) - 4).toFixed(1)}`);
  const path = `M${points.join(' L')}`;
  const labels = shownLabels(result.rows.length);
  const first = result.rows[0];
  const last = result.rows[result.rows.length - 1];
  return (
    <div className="m-stack" data-gap="1">
      <svg viewBox={`0 0 ${width} ${drawn}`} width="100%" preserveAspectRatio="none" role="img" aria-label={`${label}, from ${first ? format(first.value) : ''} in ${first?.label ?? ''} to ${last ? format(last.value) : ''} in ${last?.label ?? ''}`} style={{ display: 'block', blockSize: height }}>
        <path d={`M0,40H${width}M0,80H${width}M0,120H${width}`} strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--m-color-border-muted)' }} />
        <path d={`${path} L${width},${drawn} L0,${drawn} Z`} style={{ fill: 'var(--m-color-info-bg)', opacity: 0.6 }} />
        <path d={path} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ stroke: SERIES }} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {result.rows.map((row, index) => (labels.has(index) ? <span key={row.key ?? 'none'} style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{row.label}</span> : null))}
      </div>
    </div>
  );
}

function Table({ result, format, groupLabel, valueLabel }: { result: ReportResult; format: (value: number) => string; groupLabel: string; valueLabel: string }) {
  return (
    <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0', marginInline: 'calc(var(--m-space-4) * -1)' } as CSSProperties}>
      <table className="m-table">
        <thead>
          <tr>
            <th scope="col">{groupLabel}</th>
            <th scope="col" data-numeric="">
              {valueLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.key ?? 'none'}>
              <td>{row.label}</td>
              <td data-numeric="">{format(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Draws a report's result in the form its settings ask for. Every form uses the one series colour. */
export function ReportChart({ settings, result, object, height = 176 }: { settings: ReportSettings; result: ReportResult; object: ObjectDefinition | undefined; height?: number }) {
  const format = valueFormatter(settings, object);
  const what = measureLabel(settings, object);
  const group = object?.properties.find((property) => property.id === settings.groupBy)?.label ?? 'Group';

  if (settings.chart === 'number' || !settings.groupBy) {
    return (
      <div className="m-stack" data-gap="1">
        <span style={{ fontSize: 'var(--m-font-size-3xl)', fontWeight: 'var(--m-font-weight-medium)', letterSpacing: 'var(--m-font-tracking-tight)', lineHeight: 'var(--m-font-leading-tight)', fontVariantNumeric: 'tabular-nums' }}>
          {format.long(result.total)}
        </span>
        <span style={small}>
          {what}, across {result.records.toLocaleString('en-US')} {result.records === 1 ? (object?.singular.toLowerCase() ?? 'record') : (object?.plural.toLowerCase() ?? 'records')}
        </span>
      </div>
    );
  }
  if (result.rows.length === 0) return <Empty />;
  if (settings.chart === 'columns') return <Columns result={result} format={format.short} height={height} />;
  if (settings.chart === 'line') return <Line result={result} format={format.short} height={height} label={what} />;
  if (settings.chart === 'table') return <Table result={result} format={format.long} groupLabel={group} valueLabel={what} />;
  return <Bars result={result} format={format.short} />;
}
