import { BarChart3, Pencil, Pin, PinOff, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { type CSSProperties, type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import { draftReport } from '../assistant/mock-engine';
import type { Filter, ObjectDefinition } from '../contracts/metadata';
import type { ChartType, Dashboard, Measure, ReportDefinition, ReportSettings } from '../contracts/reports';
import { Modal } from '../ui/Modal';
import { ReportChart, measureLabel } from '../ui/ReportChart';
import { describeFilter } from '../ui/filters';
import { ICON, cardTitle, figure, link, medium, plainList, rowDivider, small } from '../ui/styles';
import { FilterDialog } from './FilterDialog';

const CHART_LABELS: Record<ChartType, string> = { bars: 'Bars', columns: 'Columns', line: 'Line', table: 'Table', number: 'Single number' };

/** A report in one line: "Total amount by stage". */
function describe(settings: ReportSettings, object: ObjectDefinition | undefined): string {
  const by = object?.properties.find((property) => property.id === settings.groupBy)?.label.toLowerCase();
  const bucket = settings.bucket && by ? `, by ${settings.bucket}` : '';
  return `${measureLabel(settings, object)}${by ? ` by ${by}${bucket}` : ''}`;
}

/** One report on the dashboard. It runs itself, so a dashboard is just a list of report ids. */
function ReportCard({ report, onUnpin }: { report: ReportDefinition; onUnpin: () => void }) {
  const { object: findObject, revision } = useWorkspace();
  const object = findObject(report.objectId);
  const { data, error } = useQuery(() => api.runReport(report), [JSON.stringify(report), revision]);
  return (
    <section className="m-card" aria-label={report.name}>
      <div className="m-card-body m-stack" data-gap="3">
        <div className="m-cluster" data-justify="between" data-align="start" style={{ flexWrap: 'nowrap', gap: 'var(--m-space-2)' }}>
          <div className="m-stack" data-gap="0" style={{ minInlineSize: 0 }}>
            <h2 style={cardTitle}>
              <Link to={`/reports/${report.id}`} style={{ color: 'inherit', textDecoration: 'underline dotted var(--m-color-border-strong)', textUnderlineOffset: '0.3em' }}>
                {report.name}
              </Link>
            </h2>
            <span style={small}>{describe(report, object)}</span>
          </div>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Remove "${report.name}" from the dashboard`} title="Remove from the dashboard" onClick={onUnpin}>
            <X size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </div>
        {error ? (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            This report didn't run: {error.message}
          </p>
        ) : data ? (
          <ReportChart settings={report} result={data} object={object} />
        ) : (
          <span className="m-skeleton" style={{ display: 'block', blockSize: 120 }} />
        )}
      </div>
    </section>
  );
}

/** Reports home: the dashboard, and the list of every saved report. */
export function Reports() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const reports = useQuery(() => api.listReports(), [version, workspace.revision]);
  const dashboards = useQuery(() => api.listDashboards(), [version, workspace.revision]);
  const dashboard = dashboards.data?.[0];
  const tab = params.get('tab') === 'all' ? 'all' : 'dashboard';
  const pinned = dashboard ? dashboard.reportIds.map((id) => reports.data?.find((report) => report.id === id)).filter((report): report is ReportDefinition => report !== undefined) : [];

  async function setPinned(board: Dashboard, reportId: string, on: boolean) {
    await api.saveDashboard({ ...board, reportIds: on ? [...board.reportIds.filter((id) => id !== reportId), reportId] : board.reportIds.filter((id) => id !== reportId) });
    setVersion((value) => value + 1);
  }

  return (
    <Page
      icon={BarChart3}
      crumbs={[{ label: 'Reports' }]}
      wide={tab === 'dashboard'}
      actions={
        <Link to="/reports/new" className="m-button" data-variant="primary" data-size="sm">
          <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Report
        </Link>
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-cluster" data-justify="between" data-gap="3">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>{tab === 'all' ? 'All reports' : (dashboard?.name ?? 'Reports')}</h1>
          <div className="m-cluster" data-gap="1" role="group" aria-label="Show">
            {[
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'all', label: `All reports${reports.data ? ` ${reports.data.length}` : ''}` },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className="m-button"
                data-variant="ghost"
                data-size="sm"
                aria-pressed={tab === item.id}
                style={tab === item.id ? ({ '--m-button-ghost-bg': 'var(--m-button-secondary-bg)' } as CSSProperties) : undefined}
                onClick={() => setParams(item.id === 'all' ? { tab: 'all' } : {}, { replace: true })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'dashboard' ? (
          <>
            {dashboard && reports.data && pinned.length === 0 ? <p style={small}>Nothing is on this dashboard yet. Pin a report from “All reports”, or ask the assistant for a chart and save it.</p> : null}
            <div className="m-grid" style={{ '--m-layout-grid-min': '360px' } as CSSProperties}>
              {dashboard ? pinned.map((report) => <ReportCard key={report.id} report={report} onUnpin={() => void setPinned(dashboard, report.id, false)} />) : null}
            </div>
          </>
        ) : (
          <section className="m-card" aria-label="All reports" style={{ padding: 0, overflow: 'hidden' }}>
            <ul style={{ ...plainList }}>
              {(reports.data ?? []).map((report, index) => {
                const object = workspace.object(report.objectId);
                const isPinned = dashboard?.reportIds.includes(report.id) ?? false;
                return (
                  <li key={report.id} className="m-cluster" data-justify="between" data-gap="3" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : rowDivider) }}>
                    <Link to={`/reports/${report.id}`} className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0, color: 'inherit', textDecoration: 'none' }}>
                      <span style={medium}>{report.name}</span>
                      <span style={small}>
                        {object?.plural ?? report.objectId} · {describe(report, object)} · {CHART_LABELS[report.chart]}
                      </span>
                    </Link>
                    {dashboard ? (
                      <button type="button" className="m-button" data-size="sm" data-variant={isPinned ? undefined : 'ghost'} onClick={() => void setPinned(dashboard, report.id, !isPinned)}>
                        {isPinned ? <PinOff size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> : <Pin size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />}
                        {isPinned ? 'On the dashboard' : 'Add to dashboard'}
                      </button>
                    ) : null}
                    <Link to={`/reports/${report.id}`} className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Edit ${report.name}`}>
                      <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Page>
  );
}

const NUMERIC_TYPES = new Set(['number', 'currency']);
const DATE_TYPES = new Set(['date', 'datetime']);
/** Properties with one value per record make poor groups. */
const UNGROUPABLE = new Set(['email', 'phone', 'url', 'number', 'currency']);

function startingSettings(object: ObjectDefinition | undefined): ReportSettings {
  const groupBy = object?.properties.find((property) => property.type === 'select')?.id;
  return { name: '', objectId: object?.id ?? '', measure: { kind: 'count' }, groupBy, filters: [], chart: groupBy ? 'bars' : 'number' };
}

/** Build a report, or change one: pick what to count and how to split it, and watch the result as you go. */
export function ReportBuilder() {
  const { reportId } = useParams();
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const isNew = !reportId || reportId === 'new';
  const saved = useQuery(() => api.listReports(), []);
  const existing = isNew ? undefined : saved.data?.find((report) => report.id === reportId);
  const [draft, setDraft] = useState<ReportSettings>();
  const [pin, setPin] = useState(true);
  const [dialog, setDialog] = useState<{ index?: number }>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ask, setAsk] = useState('');
  const [missed, setMissed] = useState(false);

  // The form starts from the saved report, or from a sensible first report on the first object.
  const settings = draft ?? existing ?? (isNew ? startingSettings(workspace.objects[0]) : undefined);
  const object = workspace.object(settings?.objectId);
  const preview = useQuery(() => (settings && object ? api.runReport(settings) : Promise.resolve(undefined)), [JSON.stringify(settings), workspace.revision]);

  if (!isNew && saved.data && !existing) return <Navigate to="/reports" replace />;
  if (!settings || !object) {
    return (
      <Page icon={BarChart3} crumbs={[{ label: 'Reports', to: '/reports' }, { label: 'Report' }]}>
        <span className="m-spinner" role="status" aria-label="Loading the report" />
      </Page>
    );
  }

  const set = (changes: Partial<ReportSettings>) => setDraft({ ...settings, ...changes });
  const numeric = object.properties.filter((property) => NUMERIC_TYPES.has(property.type));
  const groupable = object.properties.filter((property) => !UNGROUPABLE.has(property.type) && property.id !== object.primaryProperty);
  const groupProperty = object.properties.find((property) => property.id === settings.groupBy);
  const dated = groupProperty ? DATE_TYPES.has(groupProperty.type) : false;
  const charts: ChartType[] = !settings.groupBy ? ['number'] : dated ? ['columns', 'line', 'bars', 'table'] : ['bars', 'columns', 'table'];

  function setObject(objectId: string) {
    setDraft({ ...startingSettings(workspace.object(objectId)), name: settings?.name ?? '' });
  }

  function setMeasure(kind: Measure['kind'], property?: string) {
    if (kind === 'count') set({ measure: { kind } });
    else set({ measure: { kind, property: property ?? numeric[0]?.id ?? '' } });
  }

  function setGroup(groupBy: string) {
    const next = object?.properties.find((property) => property.id === groupBy);
    const nextDated = next ? DATE_TYPES.has(next.type) : false;
    set({ groupBy: groupBy || undefined, bucket: nextDated ? (settings?.bucket ?? 'month') : undefined, chart: !groupBy ? 'number' : nextDated ? 'columns' : 'bars' });
  }

  async function save() {
    if (!settings) return;
    if (settings.name.trim() === '') {
      setError('Give the report a name.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const report = await api.saveReport({ ...settings, id: existing?.id });
      if (isNew && pin) {
        const board = (await api.listDashboards())[0];
        if (board) await api.saveDashboard({ ...board, reportIds: [...board.reportIds, report.id] });
      }
      workspace.touch();
      navigate('/reports');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The report could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    try {
      await api.deleteReport(existing.id);
      workspace.touch();
      navigate('/reports?tab=all');
    } finally {
      setBusy(false);
    }
  }

  const setFilters = (filters: Filter[]) => set({ filters });

  /** Fills the builder in from a sentence. The controls below then show what it understood. */
  function draftFromSentence(event: FormEvent) {
    event.preventDefault();
    const drafted = draftReport(ask, workspace.objects);
    setMissed(!drafted);
    if (drafted) setDraft(drafted);
  }

  return (
    <Page
      icon={BarChart3}
      crumbs={[{ label: 'Reports', to: '/reports' }, { label: isNew ? 'New report' : settings.name || 'Report' }]}
      wide
      actions={
        <>
          {existing ? (
            <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setConfirming(true)}>
              <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Delete
            </button>
          ) : null}
          <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : isNew ? 'Save report' : 'Save changes'}
          </button>
        </>
      }
    >
      <form className="m-stack" data-gap="1" onSubmit={draftFromSentence} style={{ marginBlockEnd: 'var(--m-space-4)' }}>
        <label className="m-sr-only" htmlFor="report-ask">
          Describe the report
        </label>
        <div className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
          <input className="m-input" id="report-ask" value={ask} placeholder="Describe the report: total amount of won deals by owner" onChange={(event) => setAsk(event.target.value)} style={{ flex: 1 }} />
          <button type="submit" className="m-button" disabled={ask.trim() === ''}>
            <Sparkles size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Draft it
          </button>
        </div>
        {missed ? (
          <p className="m-field-hint" role="status">
            I couldn't tell what to split by. Say what to count and "by" what, such as "contacts by lifecycle stage" or "deals by month".
          </p>
        ) : null}
      </form>
      <div className="m-split" style={{ '--m-layout-split-side': '340px', '--m-layout-split-gap': 'var(--m-space-5)', alignItems: 'flex-start' } as CSSProperties}>
        <section className="m-card" aria-label="Report settings">
          <div className="m-card-body m-stack" data-gap="3">
            <div className="m-field">
              <label className="m-field-label" htmlFor="report-name">
                Name
              </label>
              <input className="m-input" id="report-name" value={settings.name} placeholder="Deals by source" onChange={(event) => set({ name: event.target.value })} />
            </div>
            <div className="m-field">
              <label className="m-field-label" htmlFor="report-object">
                Report on
              </label>
              <select className="m-select" id="report-object" value={settings.objectId} onChange={(event) => setObject(event.target.value)}>
                {workspace.objects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.plural}
                  </option>
                ))}
              </select>
            </div>
            <div className="m-field">
              <label className="m-field-label" htmlFor="report-measure">
                Show
              </label>
              <select className="m-select" id="report-measure" value={settings.measure.kind} onChange={(event) => setMeasure(event.target.value as Measure['kind'])}>
                <option value="count">How many {object.plural.toLowerCase()}</option>
                {numeric.length > 0 ? <option value="sum">The total of a number</option> : null}
                {numeric.length > 0 ? <option value="average">The average of a number</option> : null}
              </select>
            </div>
            {settings.measure.kind !== 'count' ? (
              <div className="m-field">
                <label className="m-field-label" htmlFor="report-measure-property">
                  Which number
                </label>
                <select className="m-select" id="report-measure-property" value={settings.measure.property} onChange={(event) => setMeasure(settings.measure.kind, event.target.value)}>
                  {numeric.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="m-field">
              <label className="m-field-label" htmlFor="report-group">
                Split by
              </label>
              <select className="m-select" id="report-group" value={settings.groupBy ?? ''} onChange={(event) => setGroup(event.target.value)}>
                <option value="">Nothing: one number</option>
                {groupable.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </select>
            </div>
            {dated ? (
              <div className="m-field">
                <label className="m-field-label" htmlFor="report-bucket">
                  Each
                </label>
                <select className="m-select" id="report-bucket" value={settings.bucket ?? 'month'} onChange={(event) => set({ bucket: event.target.value as 'month' | 'quarter' })}>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                </select>
              </div>
            ) : null}
            <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="m-field-label">Draw it as</legend>
              <div className="m-cluster" data-gap="1">
                {charts.map((chart) => (
                  <button key={chart} type="button" className="m-button" data-size="sm" data-variant={settings.chart === chart ? 'primary' : undefined} aria-pressed={settings.chart === chart} onClick={() => set({ chart })}>
                    {CHART_LABELS[chart]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="m-field-label">Only include</legend>
              <div className="m-cluster" data-gap="1">
                {settings.filters.map((filter, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: filters have no identity beyond their position
                  <span key={index} className="m-badge" style={{ gap: 'var(--m-space-1)' }}>
                    <button type="button" onClick={() => setDialog({ index })} style={{ all: 'unset', cursor: 'pointer' }}>
                      {describeFilter(filter, object, workspace.users)}
                    </button>
                    <button type="button" aria-label="Remove this filter" onClick={() => setFilters(settings.filters.filter((_, position) => position !== index))} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}>
                      <X size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </button>
                  </span>
                ))}
                {settings.filters.length === 0 ? <span style={small}>Every {object.singular.toLowerCase()}</span> : null}
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setDialog({})}>
                  <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Filter
                </button>
              </div>
            </fieldset>
            {isNew ? (
              <label className="m-field" data-layout="inline">
                <input className="m-checkbox" type="checkbox" checked={pin} onChange={(event) => setPin(event.target.checked)} /> Put it on the dashboard
              </label>
            ) : null}
            {error ? (
              <p className="m-field-error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            ) : null}
          </div>
        </section>

        <section className="m-card" aria-label="Preview">
          <div className="m-card-body m-stack" data-gap="3">
            <div className="m-stack" data-gap="0">
              <h1 style={cardTitle}>{settings.name || 'Untitled report'}</h1>
              <span style={small}>
                {describe(settings, object)}
                {preview.data ? ` · ${preview.data.records.toLocaleString('en-US')} ${preview.data.records === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase()}` : ''}
              </span>
            </div>
            {preview.error ? (
              <p className="m-field-error" role="alert" style={{ margin: 0 }}>
                This report didn't run: {preview.error.message}
              </p>
            ) : preview.data ? (
              <div style={{ opacity: preview.loading ? 0.6 : 1 }}>
                <ReportChart settings={settings} result={preview.data} object={object} height={260} />
              </div>
            ) : (
              <span className="m-skeleton" style={{ display: 'block', blockSize: 200 }} />
            )}
            {preview.data?.truncated ? <span style={small}>Showing the largest groups; the rest are combined into “Other”.</span> : null}
            {existing ? (
              <Link to={`/${object.id}`} style={{ ...link, fontSize: 'var(--m-font-size-sm)' }}>
                Open {object.plural.toLowerCase()}
              </Link>
            ) : null}
          </div>
        </section>
      </div>
      {dialog ? (
        <FilterDialog
          object={object}
          initial={dialog.index === undefined ? undefined : settings.filters[dialog.index]}
          onClose={() => setDialog(undefined)}
          onSave={(filter) => {
            setFilters(dialog.index === undefined ? [...settings.filters, filter] : settings.filters.map((item, position) => (position === dialog.index ? filter : item)));
            setDialog(undefined);
          }}
        />
      ) : null}
      <Modal open={confirming} size="sm" tone="danger" title={`Delete "${existing?.name ?? ''}"?`} description="It is removed from the dashboard too. This can't be undone." submitLabel="Delete report" busy={busy} onClose={() => setConfirming(false)} onSubmit={remove} />
    </Page>
  );
}
