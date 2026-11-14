import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileText,
  Handshake,
  House,
  type LucideIcon,
  Mail,
  Phone,
  StickyNote,
  Video,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../app/Page';
import {
  type ActivityKind,
  type DealStatus,
  type TaskKind,
  activity,
  closingDeals,
  currentUser,
  kpis,
  revenue,
  stages,
  tasks,
} from '../mock/dashboard';
import { AreaChart, Bar, SparkBars, TrendValue } from '../ui/charts';
import {
  ICON,
  cardTitle,
  compactCurrency,
  currency,
  figure,
  initials,
  link,
  medium,
  muted,
  plainList,
  rowDivider,
  small,
  tabular,
  toolbarButton,
} from '../ui/styles';

const dotted: CSSProperties = {
  textDecoration: 'underline dotted var(--m-color-border-strong)',
  textUnderlineOffset: '0.3em',
};

const taskIcons: Record<TaskKind, LucideIcon> = { call: Phone, email: Mail, meeting: Video, todo: ClipboardList };

const activityIcons: Record<ActivityKind, LucideIcon> = {
  email: Mail,
  call: Phone,
  meeting: Video,
  note: StickyNote,
  deal: Handshake,
  form: FileText,
};

const dealStatus: Record<DealStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  'on-track': { label: 'On track', tone: 'success' },
  'at-risk': { label: 'At risk', tone: 'warning' },
  stalled: { label: 'Stalled', tone: 'danger' },
};

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
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
  );
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

function Filters() {
  return (
    <div className="m-cluster" data-gap="2">
      <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
        <Calendar size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Last 28 days
      </button>
      {[`Compare: ${revenue.previousLabel}`, 'Sales pipeline', 'All owners'].map((label) => (
        <button key={label} type="button" className="m-button" data-size="sm" style={toolbarButton}>
          {label} <ChevronDown size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function KpiStrip() {
  return (
    <section className="m-card" aria-label="This period" style={{ padding: 0 }}>
      <div className="m-cluster" data-gap="0" style={{ alignItems: 'stretch' }}>
        {kpis.map((kpi, index) => (
          <div
            key={kpi.id}
            className="m-stack"
            data-gap="1"
            style={{
              flex: '1 1 180px',
              padding: 'var(--m-space-3) var(--m-space-4)',
              borderInlineStart: index === 0 ? undefined : 'var(--m-border-width-thin) solid var(--m-color-border-muted)',
            }}
          >
            <span style={{ ...dotted, ...muted, inlineSize: 'fit-content' }}>{kpi.label}</span>
            <div className="m-cluster" data-justify="between" data-align="end">
              <span className="m-cluster" data-gap="2" data-align="baseline">
                <span style={figure}>{kpi.value}</span>
                <TrendValue trend={kpi.trend} />
              </span>
              <SparkBars series={kpi.series} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RevenueCard() {
  return (
    <Card
      id="dash-revenue"
      title={<span style={dotted}>Closed won over time</span>}
      action={
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Open the report">
          <ExternalLink size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
      }
    >
      <div className="m-cluster" data-gap="2" data-align="baseline">
        <span style={figure}>{revenue.total}</span>
        <TrendValue trend={revenue.trend} />
      </div>
      <AreaChart current={revenue.current} previous={revenue.previous} label={`Closed won revenue, ${revenue.currentLabel}, above ${revenue.previousLabel}`} />
      <div className="m-cluster" data-justify="between" style={{ ...small, ...tabular }}>
        {revenue.ticks.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
      <div className="m-cluster" data-gap="4" style={small}>
        <span className="m-cluster" data-gap="1">
          <span aria-hidden style={{ inlineSize: 12, blockSize: 2, background: 'var(--m-color-info-border)' }} />
          {revenue.currentLabel}
        </span>
        <span className="m-cluster" data-gap="1">
          <span aria-hidden style={{ inlineSize: 12, blockSize: 0, borderBlockStart: '2px dashed var(--m-color-info-solid)' }} />
          {revenue.previousLabel}
        </span>
      </div>
    </Card>
  );
}

function PipelineCard() {
  const largest = Math.max(...stages.map((stage) => stage.amount), 1);
  return (
    <Card
      id="dash-pipeline"
      gap="3"
      title={<span style={dotted}>Pipeline by stage</span>}
      action={
        <Link to="/deals?layout=board" style={link}>
          Open board
        </Link>
      }
    >
      <ul className="m-stack" data-gap="3" style={plainList}>
        {stages.map((stage) => (
          <li key={stage.id} className="m-stack" data-gap="1">
            <div className="m-cluster" data-justify="between">
              <span>{stage.name}</span>
              <span style={{ ...small, ...tabular }}>{stage.deals} deals</span>
            </div>
            <div className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
              <Bar share={stage.amount / largest} />
              <strong style={{ fontWeight: 'var(--m-font-weight-semibold)', ...tabular }}>{compactCurrency(stage.amount)}</strong>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ClosingDeals() {
  return (
    <section className="m-card" aria-labelledby="dash-closing" style={{ padding: 0 }}>
      <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-3) var(--m-space-4)' }}>
        <h2 id="dash-closing" style={cardTitle}>
          Deals closing soon
        </h2>
        <Link to="/deals?view=closing-this-month" style={link}>
          View all
        </Link>
      </div>
      <div className="m-table-wrap" style={{ border: 0, borderRadius: 0, boxShadow: 'none' }}>
        <table className="m-table">
          <thead>
            <tr>
              <th scope="col">Deal</th>
              <th scope="col">Stage</th>
              <th scope="col">Owner</th>
              <th scope="col">Close date</th>
              <th scope="col">Status</th>
              <th scope="col" style={{ textAlign: 'end' }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {closingDeals.map((deal) => {
              const status = dealStatus[deal.status];
              return (
                <tr key={deal.id}>
                  <td>
                    <div className="m-stack" data-gap="0">
                      <Link to="/deals" style={{ ...medium, color: 'inherit', textDecoration: 'none' }}>
                        {deal.name}
                      </Link>
                      <span style={small}>{deal.company}</span>
                    </div>
                  </td>
                  <td>
                    <div className="m-stack" data-gap="1" style={{ minInlineSize: 120 }}>
                      <span>{deal.stage}</span>
                      <progress className="m-progress" data-size="sm" value={deal.probability} max={100} aria-label={`${deal.probability}% likely to close`} />
                    </div>
                  </td>
                  <td>
                    <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                      <span className="m-avatar" data-size="sm" style={{ '--m-avatar-size-sm': '20px', fontSize: 'var(--m-font-size-xs)' } as CSSProperties}>
                        {initials(deal.owner)}
                      </span>
                      {deal.owner}
                    </span>
                  </td>
                  <td style={{ ...tabular, whiteSpace: 'nowrap' }}>{deal.closes}</td>
                  <td>
                    <span className="m-badge" data-tone={status.tone} data-variant="solid">
                      {status.label}
                    </span>
                  </td>
                  <td style={{ textAlign: 'end', ...tabular, ...medium }}>{currency(deal.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TasksCard() {
  return (
    <Card
      id="dash-tasks"
      gap="1"
      title="Your tasks today"
      action={
        <Link to="/tasks" style={link}>
          View all
        </Link>
      }
    >
      <ul className="m-stack" data-gap="0" style={{ ...plainList, marginInline: 'calc(var(--m-space-2) * -1)' }}>
        {tasks.map((task) => (
          <li key={task.id}>
            <Link
              to="/tasks"
              className="m-cluster"
              data-gap="3"
              style={{ flexWrap: 'nowrap', padding: 'var(--m-space-2)', borderRadius: 'var(--m-radius-md)', color: 'inherit', textDecoration: 'none' }}
            >
              <IconTile icon={taskIcons[task.kind]} />
              <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                <span style={medium}>{task.title}</span>
                <span style={small}>{task.related}</span>
              </span>
              {task.overdue ? (
                <span className="m-badge" data-tone="danger">
                  Overdue
                </span>
              ) : (
                <span style={{ ...small, ...tabular }}>{task.due}</span>
              )}
              <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
                <ChevronRight size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityCard() {
  return (
    <Card id="dash-activity" gap="1" title="Recent activity">
      <ul className="m-stack" data-gap="0" style={plainList}>
        {activity.map((item, index) => (
          <li
            key={item.id}
            className="m-cluster"
            data-gap="3"
            style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}
          >
            <IconTile icon={activityIcons[item.kind]} />
            <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
              <span>
                <span style={medium}>{item.actor}</span> {item.summary}
              </span>
              <span style={small}>{item.target}</span>
            </span>
            <span style={{ ...small, whiteSpace: 'nowrap' }}>{item.when}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Dashboard() {
  const overdue = tasks.filter((task) => task.overdue).length;
  const atRisk = closingDeals.filter((deal) => deal.status !== 'on-track').length;
  return (
    <Page
      icon={House}
      crumbs={[{ label: 'Overview' }]}
      actions={
        <button type="button" className="m-button" data-size="sm" style={toolbarButton}>
          Customize
        </button>
      }
    >
    <div className="m-stack" data-gap="5">
      <div className="m-stack" data-gap="1">
        <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>Good afternoon, {currentUser.firstName}</h1>
        <p style={muted}>
          {closingDeals.length} deals close in the next two weeks, and {atRisk} of them need attention. You have {tasks.length} tasks today
          {overdue > 0 ? `, ${overdue} overdue` : ''}.
        </p>
      </div>
      <Filters />
      <KpiStrip />
      <div className="m-grid" style={{ '--m-layout-grid-min': '352px' } as CSSProperties}>
        <RevenueCard />
        <PipelineCard />
      </div>
      <ClosingDeals />
      <div className="m-grid" style={{ '--m-layout-grid-min': '352px' } as CSSProperties}>
        <TasksCard />
        <ActivityCard />
      </div>
    </div>
    </Page>
  );
}
