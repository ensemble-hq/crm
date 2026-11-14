import { ArrowRight, Check, CircleDashed, Copy, ExternalLink, ListChecks, Mail, Play, TriangleAlert } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../app/workspace';
import type { PropertyDefinition } from '../contracts/metadata';
import { PropertyValue } from '../ui/PropertyValue';
import { ICON, cardTitle, link, medium, plainList, rowDivider, small } from '../ui/styles';
import type { CanvasItem } from './types';

type Item<Kind extends CanvasItem['kind']> = Extract<CanvasItem, { kind: Kind }>;

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="m-stack" data-gap="0">
      <h3 style={cardTitle}>{title}</h3>
      {subtitle ? <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{subtitle}</span> : null}
    </div>
  );
}

function ChartCard({ item }: { item: Item<'chart'> }) {
  const largest = Math.max(...item.bars.map((bar) => bar.value), 1);
  return (
    <div className="m-card-body m-stack" data-gap="3">
      <Header title={item.title} subtitle={item.subtitle} />
      <ul className="m-stack" data-gap="3" style={plainList}>
        {item.bars.map((bar) => (
          <li key={bar.label} className="m-stack" data-gap="1">
            <div className="m-cluster" data-justify="between">
              <span>{bar.label}</span>
              {bar.note ? <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{bar.note}</span> : null}
            </div>
            <div className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
              <span
                aria-hidden
                style={{
                  flex: `0 0 ${Math.max(3, Math.round((bar.value / largest) * 78))}%`,
                  blockSize: 8,
                  borderRadius: 'var(--m-radius-full)',
                  background: 'var(--m-color-info-border)',
                }}
              />
              <strong style={{ fontWeight: 'var(--m-font-weight-semibold)', fontVariantNumeric: 'tabular-nums' }}>{bar.display}</strong>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableCard({ item }: { item: Item<'table'> }) {
  const { object: findObject } = useWorkspace();
  const object = findObject(item.objectId);
  if (!object) return null;
  const columns = item.columns.map((id) => object.properties.find((property) => property.id === id)).filter((property): property is PropertyDefinition => property !== undefined);
  return (
    <>
      <div style={{ padding: 'var(--m-space-3) var(--m-space-4)' }}>
        <Header title={item.title} subtitle={item.subtitle} />
      </div>
      <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0', maxBlockSize: 360, overflow: 'auto' } as CSSProperties}>
        <table className="m-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.records.map((record) => (
              <tr key={record.id}>
                {columns.map((column) => (
                  <td key={column.id} style={{ whiteSpace: 'nowrap' }}>
                    {column.id === object.primaryProperty ? (
                      <Link to={`/${object.id}/${record.id}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 'var(--m-font-weight-semibold)' }}>
                        {String(record.properties[column.id] ?? 'Untitled')}
                      </Link>
                    ) : (
                      <PropertyValue property={column} value={record.properties[column.id]} references={item.references} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {item.total > item.records.length ? (
        <div style={{ ...small, ...rowDivider, padding: 'var(--m-space-2) var(--m-space-4)' }}>
          Showing {item.records.length} of {item.total.toLocaleString('en-US')}
        </div>
      ) : null}
    </>
  );
}

function MappingCard({ item }: { item: Item<'mapping'> }) {
  return (
    <>
      <div style={{ padding: 'var(--m-space-3) var(--m-space-4)' }}>
        <Header title={item.title} subtitle={item.subtitle} />
      </div>
      <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0' } as CSSProperties}>
        <table className="m-table">
          <thead>
            <tr>
              <th scope="col">Column in the file</th>
              <th scope="col">Goes to</th>
              <th scope="col">First value</th>
            </tr>
          </thead>
          <tbody>
            {item.rows.map((row) => (
              <tr key={row.column}>
                <td style={medium}>{row.column}</td>
                <td>
                  {row.property ? (
                    <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap' }}>
                      <ArrowRight size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
                      {row.property}
                    </span>
                  ) : (
                    <span className="m-badge" data-tone="warning">
                      Left out
                    </span>
                  )}
                </td>
                <td style={{ color: 'var(--m-color-fg-muted)' }}>{row.sample || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StepIcon({ status }: { status: Item<'plan'>['steps'][number]['status'] }) {
  if (status === 'running') return <span className="m-spinner" data-size="sm" role="status" aria-label="Running" style={{ inlineSize: 14, blockSize: 14 }} />;
  if (status === 'done') return <Check size={ICON.button} strokeWidth={ICON.strokeWidth} aria-label="Done" style={{ color: 'var(--m-color-success-fg)' }} />;
  if (status === 'error') return <TriangleAlert size={ICON.button} strokeWidth={ICON.strokeWidth} aria-label="Failed" style={{ color: 'var(--m-color-danger-fg)' }} />;
  return <CircleDashed size={ICON.button} strokeWidth={ICON.strokeWidth} aria-label="Not started" style={{ color: 'var(--m-color-fg-subtle)' }} />;
}

function PlanCard({ item, onRun, disabled }: { item: Item<'plan'>; onRun: () => void; disabled: boolean }) {
  return (
    <div className="m-card-body m-stack" data-gap="3">
      <div className="m-cluster" data-justify="between" data-align="start" style={{ flexWrap: 'nowrap', gap: 'var(--m-space-3)' }}>
        <div className="m-cluster" data-gap="2" data-align="start" style={{ flexWrap: 'nowrap' }}>
          <span style={{ display: 'inline-flex', paddingBlockStart: 2, color: 'var(--m-color-fg-muted)' }}>
            <ListChecks size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
          </span>
          <Header title={item.title} subtitle={item.summary} />
        </div>
        {item.state === 'done' ? (
          <span className="m-badge" data-tone="success" data-variant="solid">
            Done
          </span>
        ) : item.state === 'failed' ? (
          <span className="m-badge" data-tone="danger" data-variant="solid">
            Stopped
          </span>
        ) : (
          <span className="m-badge">{item.state === 'running' ? 'Running' : 'Plan'}</span>
        )}
      </div>
      <ol className="m-stack" data-gap="0" style={plainList}>
        {item.steps.map((step, index) => (
          <li key={step.id} className="m-cluster" data-gap="3" data-align="start" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
            <span style={{ display: 'inline-flex', paddingBlockStart: 2, flexShrink: 0 }}>
              <StepIcon status={step.status} />
            </span>
            <span className="m-stack" data-gap="0">
              <span>{step.label}</span>
              {step.detail ? <span style={small}>{step.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {item.state === 'proposed' ? (
        <button type="button" className="m-button" data-variant="primary" disabled={disabled} onClick={onRun} style={{ inlineSize: '100%' }}>
          <Play size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Run the plan
        </button>
      ) : null}
      {item.state === 'done' && item.doneLink ? (
        <Link to={item.doneLink.to} style={link}>
          {item.doneLink.label}
        </Link>
      ) : null}
    </div>
  );
}

function HandoffCard({ item }: { item: Item<'handoff'> }) {
  return (
    <div className="m-card-body m-stack" data-gap="3">
      <Header title={item.title} subtitle="Handled by Ensemble, not by the assistant" />
      <blockquote style={{ margin: 0, padding: 'var(--m-space-2) var(--m-space-3)', borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-sunken)' }}>{item.request}</blockquote>
      <ol className="m-stack" data-gap="2" style={{ margin: 0, paddingInlineStart: 'var(--m-space-5)' }}>
        {item.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <button type="button" className="m-button" data-variant="primary" style={{ inlineSize: '100%' }}>
        <ExternalLink size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Plan this change in Ensemble
      </button>
    </div>
  );
}

function DraftCard({ item }: { item: Item<'draft'> }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${item.subject}\n\n${item.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="m-card-body m-stack" data-gap="3">
      <Header title={item.title} subtitle="A draft. Nothing has been sent." />
      <dl className="m-stack" data-gap="1" style={{ margin: 0 }}>
        <div className="m-cluster" data-gap="2">
          <dt style={small}>To</dt>
          <dd style={{ margin: 0 }}>
            {item.toName} &lt;{item.to}&gt;
          </dd>
        </div>
        <div className="m-cluster" data-gap="2">
          <dt style={small}>Subject</dt>
          <dd style={{ margin: 0, ...medium }}>{item.subject}</dd>
        </div>
      </dl>
      <div style={{ whiteSpace: 'pre-wrap', padding: 'var(--m-space-3)', borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-sunken)' }}>{item.body}</div>
      <div className="m-cluster" data-gap="2">
        <a className="m-button" data-variant="primary" data-size="sm" href={`mailto:${item.to}?subject=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(item.body)}`}>
          <Mail size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Open in your email
        </a>
        <button type="button" className="m-button" data-size="sm" onClick={() => void copy()}>
          <Copy size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/** The assistant's work, beside the conversation: charts, tables, column matches, plans. Newest first. */
export function Canvas({ items, working, onRunPlan }: { items: CanvasItem[]; working: boolean; onRunPlan: (planId: string) => void }) {
  return (
    <div className="m-stack" data-gap="4">
      {items.map((item) => (
        <section key={item.id} className="m-card" aria-label={item.title} style={item.kind === 'table' || item.kind === 'mapping' ? { padding: 0, overflow: 'hidden' } : undefined}>
          {item.kind === 'chart' ? <ChartCard item={item} /> : null}
          {item.kind === 'table' ? <TableCard item={item} /> : null}
          {item.kind === 'mapping' ? <MappingCard item={item} /> : null}
          {item.kind === 'plan' ? <PlanCard item={item} disabled={working} onRun={() => onRunPlan(item.id)} /> : null}
          {item.kind === 'handoff' ? <HandoffCard item={item} /> : null}
          {item.kind === 'draft' ? <DraftCard item={item} /> : null}
        </section>
      ))}
    </div>
  );
}
