import { ChevronRight, House, Sparkles } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { Filter, ObjectDefinition } from '../contracts/metadata';
import type { CrmRecord, ListResult } from '../contracts/records';
import { CompleteButton } from '../ui/CompleteButton';
import { PropertyValue, formatDate } from '../ui/PropertyValue';
import { Bar, type Trend, TrendValue } from '../ui/charts';
import { cardTitle, compactCurrency, currency, figure, ICON, link, medium, muted, plainList, rowDivider, small, tabular } from '../ui/styles';

const MINE: Filter = { property: 'owner', operator: 'in', value: ['$me'] };
const BIG_DEAL = 50_000;

const dotted: CSSProperties = { textDecoration: 'underline dotted var(--m-color-border-strong)', textUnderlineOffset: '0.3em' };

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

function sumOf(records: CrmRecord[], property: string): number {
  return records.reduce((total, record) => total + (typeof record.properties[property] === 'number' ? (record.properties[property] as number) : 0), 0);
}

/** Everything the page shows, read in one go so it appears together. */
async function loadToday(deals: ObjectDefinition, tasks: ObjectDefinition | undefined) {
  const openStages = deals.views.find((view) => view.id === 'open')?.filters ?? [];
  const mineOpen = [MINE, ...openStages];
  const won = (from: string, to: string) =>
    api.summarize({ objectId: deals.id, filters: [{ property: 'stage', operator: 'in', value: ['won'] }, { property: 'closeDate', operator: 'between', value: [from, to] }], groupBy: 'stage', sumProperty: 'amount' });
  const none: ListResult = { records: [], total: 0, references: {} };

  const [due, overdue, closing, quiet, pipeline, wonThis, wonLast] = await Promise.all([
    tasks ? api.listRecords({ objectId: tasks.id, viewId: tasks.views[0]?.id, page: 1, pageSize: 7 }) : none,
    tasks ? api.listRecords({ objectId: tasks.id, viewId: tasks.views[0]?.id, filters: [{ property: 'dueDate', operator: 'lt', value: '$today' }], page: 1, pageSize: 1 }) : none,
    api.listRecords({ objectId: deals.id, filters: [...mineOpen, { property: 'closeDate', operator: 'lt', value: '$in14days' }], sort: { property: 'closeDate', direction: 'asc' }, page: 1, pageSize: 200 }),
    api.listRecords({
      objectId: deals.id,
      filters: [...mineOpen, { property: 'amount', operator: 'gt', value: BIG_DEAL }, { property: 'lastActivity', operator: 'lt', value: '$14daysAgo' }],
      sort: { property: 'amount', direction: 'desc' },
      page: 1,
      pageSize: 5,
    }),
    api.summarize({ objectId: deals.id, filters: openStages, groupBy: 'stage', sumProperty: 'amount' }),
    won('$monthStart', '$monthEnd'),
    won('$lastMonthStart', '$lastMonthEnd'),
  ]);
  return { due, overdue: overdue.total, closing, quiet, pipeline, wonThis: wonThis[0]?.sum ?? 0, wonLast: wonLast[0]?.sum ?? 0 };
}

function Card({ id, title, action, children, gap = '2' }: { id: string; title: ReactNode; action?: ReactNode; children: ReactNode; gap?: string }) {
  return (
    <section className="m-card" aria-labelledby={id}>
      <div className="m-card-body m-stack" data-gap={gap}>
        <div className="m-cluster" data-justify="between">
          <h2 id={id} style={cardTitle}>
            {title}
          </h2>
          {action}
        </div>
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p style={{ ...small, margin: 0, paddingBlock: 'var(--m-space-2)' }}>{children}</p>;
}

function Kpi({ label, value, note, trend, first = false }: { label: string; value: string; note?: string; trend?: Trend; first?: boolean }) {
  return (
    <div className="m-stack" data-gap="1" style={{ flex: '1 1 180px', padding: 'var(--m-space-3) var(--m-space-4)', borderInlineStart: first ? undefined : 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
      <span style={{ ...dotted, ...muted, inlineSize: 'fit-content' }}>{label}</span>
      <span className="m-cluster" data-gap="2" data-align="baseline">
        <span style={figure}>{value}</span>
        {trend ? <TrendValue trend={trend} /> : null}
      </span>
      {note ? <span style={small}>{note}</span> : null}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** The start of the day: what is due, what is closing, what has gone quiet, and where the pipeline stands. All of it is read live. */
export function Dashboard() {
  const workspace = useWorkspace();
  const deals = workspace.object('deals');
  const tasks = workspace.objects.find((object) => object.completion);
  const { data, error } = useQuery(() => (deals ? loadToday(deals, tasks) : Promise.resolve(undefined)), [deals?.id, tasks?.id, workspace.revision]);
  const firstName = workspace.currentUser.name.split(' ')[0] ?? workspace.currentUser.name;
  const stage = deals?.properties.find((property) => property.id === 'stage');

  const closingValue = data ? sumOf(data.closing.records, 'amount') : 0;
  const pipelineTotal = data?.pipeline.reduce((total, row) => total + row.sum, 0) ?? 0;
  const pipelineCount = data?.pipeline.reduce((total, row) => total + row.count, 0) ?? 0;
  const largestStage = Math.max(...(data?.pipeline.map((row) => row.sum) ?? [1]), 1);
  const change = data && data.wonLast > 0 ? Math.round(((data.wonThis - data.wonLast) / data.wonLast) * 100) : undefined;

  const briefing = data
    ? [
        data.due.total === 0 ? 'Nothing is due today.' : `You have ${plural(data.due.total, 'task')} due${data.overdue > 0 ? `, ${data.overdue.toLocaleString('en-US')} of them overdue` : ''}.`,
        data.closing.total === 0 ? 'None of your deals are due to close in the next two weeks.' : `${plural(data.closing.total, 'deal')} of yours ${data.closing.total === 1 ? 'is' : 'are'} due to close in the next two weeks, worth ${compactCurrency(closingValue)}.`,
        data.quiet.total > 0 ? `${plural(data.quiet.total, 'larger deal')} ${data.quiet.total === 1 ? 'has' : 'have'} had no activity in two weeks.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <Page icon={House} crumbs={[{ label: 'Today' }]}>
      <div className="m-stack" data-gap="5">
        <div className="m-stack" data-gap="2">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>
            {greeting()}, {firstName}
          </h1>
          {error ? (
            <p className="m-field-error" role="alert">
              Today's numbers didn't load: {error.message}
            </p>
          ) : (
            <p className="m-cluster" data-gap="2" data-align="start" style={{ ...muted, flexWrap: 'nowrap', margin: 0, minBlockSize: '1.5em' }}>
              <span style={{ display: 'inline-flex', paddingBlockStart: 2, flexShrink: 0 }}>
                <Sparkles size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
              </span>
              <span>{data ? briefing : 'Reading your day…'}</span>
            </p>
          )}
        </div>

        <section className="m-card" aria-label="At a glance" style={{ padding: 0 }}>
          <div className="m-cluster" data-gap="0" style={{ alignItems: 'stretch' }}>
            <Kpi first label="Tasks due" value={data ? data.due.total.toLocaleString('en-US') : '–'} note={data ? (data.overdue > 0 ? `${data.overdue.toLocaleString('en-US')} overdue` : 'None overdue') : undefined} />
            <Kpi label="Your deals closing in 14 days" value={data ? compactCurrency(closingValue) : '–'} note={data ? plural(data.closing.total, 'deal') : undefined} />
            <Kpi
              label="Team closed won this month"
              value={data ? compactCurrency(data.wonThis) : '–'}
              trend={change === undefined ? undefined : { direction: change >= 0 ? 'up' : 'down', value: `${Math.abs(change)}%`, good: change >= 0 }}
              note={data ? `${compactCurrency(data.wonLast)} last month` : undefined}
            />
            <Kpi label="Team open pipeline" value={data ? compactCurrency(pipelineTotal) : '–'} note={data ? plural(pipelineCount, 'deal') : undefined} />
          </div>
        </section>

        <div className="m-grid" style={{ '--m-layout-grid-min': '352px' } as CSSProperties}>
          <Card
            id="today-tasks"
            gap="1"
            title="Your tasks"
            action={
              tasks ? (
                <Link to={`/${tasks.id}`} style={link}>
                  View all
                </Link>
              ) : null
            }
          >
            {data && tasks && data.due.records.length === 0 ? <Empty>You are clear. Nothing is due.</Empty> : null}
            <ul className="m-stack" data-gap="0" style={plainList}>
              {tasks && data
                ? data.due.records.map((task, index) => {
                    const dueDate = String(task.properties.dueDate ?? '');
                    const about = ['deal', 'contact', 'company'].map((id) => task.properties[id]).find((value): value is string => typeof value === 'string');
                    const type = tasks.properties.find((property) => property.id === 'type');
                    return (
                      <li key={task.id} className="m-cluster" data-gap="3" data-align="start" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
                        <span style={{ display: 'inline-flex', paddingBlockStart: 2 }}>
                          <CompleteButton object={tasks} record={task} />
                        </span>
                        <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                          <Link to={`/${tasks.id}/${task.id}`} style={{ ...medium, color: 'inherit', textDecoration: 'none' }}>
                            {String(task.properties.name ?? 'Untitled')}
                          </Link>
                          {about ? <span style={small}>{data.due.references[about]?.label ?? ''}</span> : null}
                        </span>
                        {type ? <PropertyValue property={type} value={task.properties.type} /> : null}
                        <span style={{ ...small, ...tabular, whiteSpace: 'nowrap', color: dueDate < new Date().toISOString().slice(0, 10) ? 'var(--m-color-danger-fg)' : undefined }}>{dueDate ? formatDate(dueDate) : ''}</span>
                      </li>
                    );
                  })
                : null}
            </ul>
            {data && tasks && data.due.total > data.due.records.length ? (
              <Link to={`/${tasks.id}`} style={{ ...small, textDecoration: 'none' }}>
                {(data.due.total - data.due.records.length).toLocaleString('en-US')} more
              </Link>
            ) : null}
          </Card>

          <Card
            id="today-closing"
            gap="1"
            title="Your deals closing soon"
            action={
              <Link to="/deals?view=mine" style={link}>
                View all
              </Link>
            }
          >
            {data && data.closing.records.length === 0 ? <Empty>Nothing of yours is due to close in the next two weeks.</Empty> : null}
            <ul className="m-stack" data-gap="0" style={plainList}>
              {data?.closing.records.slice(0, 7).map((deal, index) => (
                <li key={deal.id}>
                  <Link to={`/deals/${deal.id}`} className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', color: 'inherit', textDecoration: 'none', ...(index === 0 ? {} : rowDivider) }}>
                    <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                      <span style={medium}>{String(deal.properties.name ?? 'Untitled')}</span>
                      <span style={small}>
                        {typeof deal.properties.company === 'string' ? (data.closing.references[deal.properties.company]?.label ?? '') : ''} · {stage?.options?.find((option) => option.id === deal.properties.stage)?.label ?? ''}
                      </span>
                    </span>
                    <span className="m-stack" data-gap="0" style={{ alignItems: 'flex-end' }}>
                      <span style={{ ...medium, ...tabular }}>{typeof deal.properties.amount === 'number' ? currency(deal.properties.amount) : ''}</span>
                      <span style={{ ...small, ...tabular }}>{typeof deal.properties.closeDate === 'string' ? formatDate(deal.properties.closeDate) : ''}</span>
                    </span>
                    <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
                      <ChevronRight size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            id="today-pipeline"
            gap="3"
            title={<span style={dotted}>Team pipeline by stage</span>}
            action={
              <Link to="/deals?layout=board" style={link}>
                Open board
              </Link>
            }
          >
            <ul className="m-stack" data-gap="3" style={plainList}>
              {(stage?.options ?? [])
                .map((option) => ({ option, row: data?.pipeline.find((item) => item.value === option.id) }))
                .filter((entry) => entry.row)
                .map(({ option, row }) => (
                  <li key={option.id} className="m-stack" data-gap="1">
                    <div className="m-cluster" data-justify="between">
                      <span>{option.label}</span>
                      <span style={{ ...small, ...tabular }}>{plural(row?.count ?? 0, 'deal')}</span>
                    </div>
                    <div className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
                      <Bar share={(row?.sum ?? 0) / largestStage} />
                      <strong style={{ fontWeight: 'var(--m-font-weight-semibold)', ...tabular }}>{compactCurrency(row?.sum ?? 0)}</strong>
                    </div>
                  </li>
                ))}
            </ul>
          </Card>

          <Card id="today-quiet" gap="1" title="Gone quiet">
            {data && data.quiet.records.length === 0 ? <Empty>Every larger deal of yours has had activity in the last two weeks.</Empty> : null}
            <ul className="m-stack" data-gap="0" style={plainList}>
              {data?.quiet.records.map((deal, index) => (
                <li key={deal.id}>
                  <Link to={`/deals/${deal.id}`} className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', color: 'inherit', textDecoration: 'none', ...(index === 0 ? {} : rowDivider) }}>
                    <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                      <span style={medium}>{String(deal.properties.name ?? 'Untitled')}</span>
                      <span style={small}>
                        {typeof deal.properties.company === 'string' ? (data.quiet.references[deal.properties.company]?.label ?? '') : ''} · last activity{' '}
                        {typeof deal.properties.lastActivity === 'string' ? formatDate(deal.properties.lastActivity) : 'never'}
                      </span>
                    </span>
                    <span style={{ ...medium, ...tabular }}>{typeof deal.properties.amount === 'number' ? currency(deal.properties.amount) : ''}</span>
                    <span className="m-badge" data-tone="warning" data-variant="solid">
                      Quiet
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {data && data.quiet.total > data.quiet.records.length ? <span style={small}>{(data.quiet.total - data.quiet.records.length).toLocaleString('en-US')} more. Ask the assistant: “which big deals have gone quiet?”</span> : null}
          </Card>
        </div>
      </div>
    </Page>
  );
}
