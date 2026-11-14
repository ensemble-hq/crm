import type { ObjectDefinition, PropertyDefinition } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import type { Dashboard, ReportDefinition, ReportResult, ReportRow, ReportSettings, ReportsApi } from '../contracts/reports';
import { OPEN_STAGES, users } from './definitions';

/** The report engine and the saved reports, in memory. */

const MAX_GROUPS = 12;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const reports: ReportDefinition[] = [
  { id: 'rep_pipeline', name: 'Open pipeline by stage', objectId: 'deals', measure: { kind: 'sum', property: 'amount' }, groupBy: 'stage', filters: [{ property: 'stage', operator: 'in', value: OPEN_STAGES }], chart: 'bars' },
  {
    id: 'rep_won_month',
    name: 'Closed won by month',
    objectId: 'deals',
    measure: { kind: 'sum', property: 'amount' },
    groupBy: 'closeDate',
    bucket: 'month',
    filters: [
      { property: 'stage', operator: 'in', value: ['won'] },
      { property: 'closeDate', operator: 'gt', value: '$12monthsAgo' },
    ],
    chart: 'columns',
  },
  {
    id: 'rep_won_owner',
    name: 'Closed won this year by owner',
    objectId: 'deals',
    measure: { kind: 'sum', property: 'amount' },
    groupBy: 'owner',
    filters: [
      { property: 'stage', operator: 'in', value: ['won'] },
      { property: 'closeDate', operator: 'gt', value: '$yearStart' },
    ],
    chart: 'bars',
  },
  { id: 'rep_deal_size', name: 'Average won deal size', objectId: 'deals', measure: { kind: 'average', property: 'amount' }, filters: [{ property: 'stage', operator: 'in', value: ['won'] }], chart: 'number' },
  { id: 'rep_lifecycle', name: 'Contacts by lifecycle stage', objectId: 'contacts', measure: { kind: 'count' }, groupBy: 'lifecycleStage', filters: [], chart: 'bars' },
  {
    id: 'rep_new_contacts',
    name: 'New contacts by month',
    objectId: 'contacts',
    measure: { kind: 'count' },
    groupBy: 'createdAt',
    bucket: 'month',
    filters: [{ property: 'createdAt', operator: 'gt', value: '$12monthsAgo' }],
    chart: 'line',
  },
  { id: 'rep_source', name: 'Won deals by source', objectId: 'deals', measure: { kind: 'count' }, groupBy: 'source', filters: [{ property: 'stage', operator: 'in', value: ['won'] }], chart: 'table' },
  { id: 'rep_tasks', name: 'Open tasks by person', objectId: 'tasks', measure: { kind: 'count' }, groupBy: 'owner', filters: [{ property: 'status', operator: 'in', value: ['open'] }], chart: 'bars' },
];

const dashboards: Dashboard[] = [{ id: 'dash_sales', name: 'Sales overview', reportIds: ['rep_deal_size', 'rep_pipeline', 'rep_won_month', 'rep_won_owner', 'rep_new_contacts', 'rep_lifecycle'] }];

function bucketKey(value: string, bucket: 'month' | 'quarter'): string {
  const month = Number(value.slice(5, 7));
  return bucket === 'quarter' ? `${value.slice(0, 4)}-Q${Math.ceil(month / 3)}` : value.slice(0, 7);
}

function bucketLabel(key: string): string {
  const [year = '', part = ''] = key.split('-');
  return part.startsWith('Q') ? `${part} ${year}` : `${MONTHS[Number(part) - 1] ?? part} ${year}`;
}

let sequence = 0;

/**
 * The reports half of the mock API. `respond` adds latency; `select` returns the records of an
 * object that pass a set of filters; `definition` and `labelOf` come from the records half.
 */
export function createReportsApi(deps: {
  respond: <T>(compute: () => T) => Promise<T>;
  select: (query: { objectId: string; filters: ReportSettings['filters'] }) => CrmRecord[];
  definition: (objectId: string) => ObjectDefinition;
  labelOf: (recordId: string) => string;
}): ReportsApi {
  function groupLabel(key: string, property: PropertyDefinition, bucket: ReportSettings['bucket']): string {
    switch (property.type) {
      case 'select':
      case 'multiselect':
        return property.options?.find((option) => option.id === key)?.label ?? key;
      case 'user':
        return users.find((user) => user.id === key)?.name ?? key;
      case 'reference':
        return deps.labelOf(key);
      case 'boolean':
        return key === 'true' ? 'Yes' : 'No';
      case 'date':
      case 'datetime':
        return bucket ? bucketLabel(key) : key;
      default:
        return key;
    }
  }

  function run(settings: ReportSettings): ReportResult {
    const object = deps.definition(settings.objectId);
    const records = deps.select({ objectId: settings.objectId, filters: settings.filters });
    const measured = settings.measure.kind === 'count' ? undefined : settings.measure.property;
    const amount = (record: CrmRecord) => (measured && typeof record.properties[measured] === 'number' ? (record.properties[measured] as number) : 0);
    const finish = (sum: number, count: number) => (settings.measure.kind === 'count' ? count : settings.measure.kind === 'sum' ? sum : count === 0 ? 0 : sum / count);

    const totalSum = records.reduce((sum, record) => sum + amount(record), 0);
    const total = finish(totalSum, records.length);
    const property = settings.groupBy ? object.properties.find((item) => item.id === settings.groupBy) : undefined;
    if (!property) return { rows: [], total, records: records.length, truncated: false };

    const dated = property.type === 'date' || property.type === 'datetime';
    const bucket = dated ? (settings.bucket ?? 'month') : undefined;
    const groups = new Map<string | null, { sum: number; count: number }>();
    const add = (key: string | null, record: CrmRecord) => {
      const group = groups.get(key) ?? { sum: 0, count: 0 };
      group.sum += amount(record);
      group.count += 1;
      groups.set(key, group);
    };
    for (const record of records) {
      const value = record.properties[property.id];
      if (Array.isArray(value)) {
        if (value.length === 0) add(null, record);
        for (const item of value) add(item, record);
      } else if (value === null || value === undefined || value === '') add(null, record);
      else if (dated && bucket) add(bucketKey(String(value), bucket), record);
      else add(String(value), record);
    }

    let rows: ReportRow[] = [...groups.entries()].map(([key, group]) => ({
      key,
      label: key === null ? `No ${property.label.toLowerCase()}` : groupLabel(key, property, bucket),
      value: finish(group.sum, group.count),
      count: group.count,
    }));

    if (dated) rows.sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''));
    else if (property.type === 'select') {
      // Stages and statuses read in their own order, not by size.
      const order = (key: string | null) => (key === null ? Number.MAX_SAFE_INTEGER : (property.options?.findIndex((option) => option.id === key) ?? 0));
      rows.sort((a, b) => order(a.key) - order(b.key));
    } else rows.sort((a, b) => b.value - a.value);

    let truncated = false;
    if (!dated && rows.length > MAX_GROUPS) {
      const kept = [...rows].sort((a, b) => b.value - a.value).slice(0, MAX_GROUPS - 1);
      const rest = rows.filter((row) => !kept.includes(row));
      const restCount = rest.reduce((sum, row) => sum + row.count, 0);
      const restSum = rest.reduce((sum, row) => sum + (settings.measure.kind === 'average' ? row.value * row.count : row.value), 0);
      rows = [...kept, { key: '__other', label: `Other (${rest.length})`, value: settings.measure.kind === 'average' ? (restCount === 0 ? 0 : restSum / restCount) : restSum, count: restCount }];
      truncated = true;
    }
    return { rows, total, records: records.length, truncated };
  }

  return {
    listReports: () => deps.respond(() => reports),
    runReport: (settings) => deps.respond(() => run(settings)),
    saveReport: (input) =>
      deps.respond(() => {
        const { id, ...settings } = input;
        if (id) {
          const existing = reports.find((report) => report.id === id);
          if (!existing) throw new Error('That report no longer exists.');
          Object.assign(existing, settings);
          return existing;
        }
        sequence += 1;
        const created: ReportDefinition = { id: `rep_new_${sequence}`, ...settings };
        reports.push(created);
        return created;
      }),
    deleteReport: (id) =>
      deps.respond(() => {
        const index = reports.findIndex((report) => report.id === id);
        if (index >= 0) reports.splice(index, 1);
        for (const dashboard of dashboards) dashboard.reportIds = dashboard.reportIds.filter((reportId) => reportId !== id);
      }),
    listDashboards: () => deps.respond(() => dashboards),
    saveDashboard: (input) =>
      deps.respond(() => {
        const existing = dashboards.find((dashboard) => dashboard.id === input.id);
        if (!existing) throw new Error('That dashboard no longer exists.');
        existing.name = input.name;
        existing.reportIds = input.reportIds;
        return existing;
      }),
  };
}
