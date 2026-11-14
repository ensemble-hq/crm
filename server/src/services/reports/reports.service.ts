import { type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { type SQL, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { PropertyDefinition } from '../../../../src/contracts/metadata';
import type { Dashboard, Delivery, ReportDefinition, ReportResult, ReportRow, ReportSettings } from '../../../../src/contracts/reports';
import type { Forecast } from '../../../../src/contracts/sales';
import type { EmailProvider } from '../../email/provider';
import type { NotificationsService } from '../notifications/notifications.service';
import { actingContext, actorOf, assertAllowed } from '../people/access';
import type { PeopleService } from '../people/people.service';
import { propertyJson, propertyText } from '../records/records.query';
import type { RecordsRepository } from '../records/records.repository';
import type { RecordsService } from '../records/records.service';
import { latestSlot } from '../workflows/timing';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { DashboardsRepository, GoalsRepository, ReportsRepository } from './reports.repository';

/**
 * Reports and the forecast. Both are grouping and adding up done by the database, over the records
 * the acting person may see, so a report is the same whoever runs it apart from what their role hides.
 */

/** A chart with more groups than this folds the smallest into "Other". */
const MAX_GROUPS = 12;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** What a person with no goal set is measured against. */
const DEFAULT_GOAL = 1_000_000;

function bucketLabel(key: string): string {
  const [year = '', part = ''] = key.split('-');
  return part.startsWith('Q') ? `${part} ${year}` : `${MONTHS[Number(part) - 1] ?? part} ${year}`;
}

export class ReportsService {
  constructor(
    private readonly reports: ReportsRepository,
    private readonly dashboards: DashboardsRepository,
    private readonly goals: GoalsRepository,
    private readonly records: RecordsService,
    private readonly recordRows: RecordsRepository,
    private readonly people: PeopleService,
    private readonly workspace: WorkspaceService,
    private readonly email: EmailProvider,
    private readonly notifications: NotificationsService,
    private readonly appOrigin: string,
  ) {}

  async list(ctx: Context): Promise<ReportDefinition[]> {
    const rows = await this.reports.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 });
    return rows.map((row) => ({ id: row.id, ...row.settings }));
  }

  /** Runs settings as they stand, saved or not. */
  async run(ctx: Context, settings: ReportSettings): Promise<ReportResult> {
    const { object, where } = await this.records.conditions(ctx, settings.objectId, settings.filters);
    const measured = settings.measure.kind === 'count' ? undefined : settings.measure.property;
    if (measured && !object.properties.some((item) => item.id === measured)) throw new ValidationError(`${object.plural} have no property "${measured}".`);
    const finish = (sum: number, count: number) => (settings.measure.kind === 'count' ? count : settings.measure.kind === 'sum' ? sum : count === 0 ? 0 : sum / count);

    const [all] = await this.recordRows.aggregate(ctx, where, [], measured);
    const total = finish(all?.sum ?? 0, all?.count ?? 0);
    const records = all?.count ?? 0;
    const property = settings.groupBy ? object.properties.find((item) => item.id === settings.groupBy) : undefined;
    if (!property) return { rows: [], total, records, truncated: false };

    const dated = property.type === 'date' || property.type === 'datetime';
    const bucket = dated ? (settings.bucket ?? 'month') : undefined;
    const text = propertyText(property.id);
    const json = propertyJson(property.id);
    let key: SQL = sql`nullif(${text}, '')`;
    let from: SQL | undefined;
    if (property.type === 'multiselect') {
      // A record with several tags counts once under each; one with none counts under "no value".
      from = sql`records left join lateral jsonb_array_elements_text(case when jsonb_typeof(${json}) = 'array' then ${json} else '[]'::jsonb end) as item(value) on true`;
      key = sql`item.value`;
    } else if (bucket === 'quarter') key = sql`case when ${text} ~ '^\\d{4}-\\d{2}' then left(${text}, 4) || '-Q' || ceil(substr(${text}, 6, 2)::int / 3.0)::int end`;
    else if (bucket === 'month') key = sql`case when ${text} ~ '^\\d{4}-\\d{2}' then left(${text}, 7) end`;
    const groups = await this.recordRows.aggregate(ctx, where, [key], measured, from);

    const labels = await this.labels(ctx, property, groups.map((group) => group.keys[0]).filter((value): value is string => value !== null && value !== undefined));
    let rows: ReportRow[] = groups.map((group) => {
      const value = group.keys[0] ?? null;
      return { key: value, label: value === null ? `No ${property.label.toLowerCase()}` : dated && bucket ? bucketLabel(value) : (labels.get(value) ?? value), value: finish(group.sum, group.count), count: group.count };
    });

    if (dated) rows.sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''));
    else if (property.type === 'select') {
      // Stages and statuses read in their own order, not by size.
      const order = (value: string | null) => (value === null ? Number.MAX_SAFE_INTEGER : (property.options?.findIndex((option) => option.id === value) ?? 0));
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
    return { rows, total, records, truncated };
  }

  /** What each group is called: an option's label, a person's name, a linked record's name. */
  private async labels(ctx: Context, property: PropertyDefinition, keys: string[]): Promise<Map<string, string>> {
    switch (property.type) {
      case 'select':
      case 'multiselect':
        return new Map((property.options ?? []).map((option) => [option.id, option.label]));
      case 'user':
        return new Map((await this.people.directory(ctx)).members.map((member) => [member.id, member.name]));
      case 'boolean':
        return new Map([
          ['true', 'Yes'],
          ['false', 'No'],
        ]);
      case 'reference': {
        const objects = await this.workspace.definitions(ctx);
        // Only the largest groups are shown, so only a page of names is ever needed.
        const result = new Map<string, string>();
        for (const record of await this.recordRows.byIds(ctx, keys.slice(0, 5_000))) {
          const primary = objects.find((object) => object.id === record.objectId)?.primaryProperty;
          const label = primary ? record.properties[primary] : undefined;
          if (typeof label === 'string') result.set(record.id, label);
        }
        return result;
      }
      default:
        return new Map();
    }
  }

  async save(ctx: Context, input: ReportSettings & { id?: string }): Promise<ReportDefinition> {
    const { id, ...settings } = input;
    if (settings.name.trim() === '') throw new ValidationError('Give the report a name.');
    await this.workspace.definition(ctx, settings.objectId);
    let lastSlot: string | null = null;
    if (settings.delivery) {
      const delivery = settings.delivery;
      if (delivery.every === 'week' && delivery.weekday === undefined) throw new ValidationError('Choose which day of the week the report is sent on.');
      const people = (await this.people.users(ctx)).filter((user) => user.kind !== 'agent');
      const unknown = delivery.to.find((userId) => !people.some((user) => user.id === userId));
      if (unknown) throw new ValidationError('A report can only be emailed to people who are members of this CRM.');
      // It comes from whoever set it up, and starts from the next time it is due.
      settings.delivery = { ...delivery, to: [...new Set(delivery.to)], by: actorOf(ctx).signedInId };
      lastSlot = latestSlot(delivery, new Date());
    }
    if (id) {
      if (!(await this.reports.findById(ctx, id))) throw new NotFoundError('report', id);
      return { id, ...(await this.reports.update(ctx, id, { settings, lastSlot })).settings };
    }
    const created = await this.reports.create(ctx, { id: `rep_${randomUUID().replace(/-/g, '').slice(0, 12)}`, settings, lastSlot });
    return { id: created.id, ...created.settings };
  }

  /**
   * Emails every report that has come due since it was last sent. Called on a timer. Each person
   * is sent the report as their own role lets them see it, so the email never shows anyone more
   * than the app would. A report missed while the worker was down is sent late, once. Returns how
   * many emails went.
   */
  async deliverDue(ctx: Context, now = new Date()): Promise<number> {
    let sent = 0;
    for (const row of await this.reports.findMany(ctx, {}, { limit: 500 })) {
      const delivery = row.settings.delivery;
      if (!delivery) continue;
      const slot = latestSlot(delivery, now);
      if (row.lastSlot !== null && row.lastSlot >= slot) continue;
      const people = (await this.people.users(ctx)).filter((user) => user.kind !== 'agent');
      const from = people.find((user) => user.id === delivery.by) ?? people.find((user) => delivery.to.includes(user.id));
      for (const userId of delivery.to) {
        const person = people.find((user) => user.id === userId);
        // Someone who has left is passed over.
        if (!person || !from) continue;
        try {
          const asThem = { ...ctx, userId };
          const acting = actingContext(asThem, await this.people.actor(asThem));
          const text = await this.asText(acting, row.id, row.settings, delivery);
          // The key names the report, the moment and the person, so trying again cannot send it twice.
          const key = `report:${row.id}:${slot}:${userId}`;
          await this.email.send({ fromName: from.name, fromEmail: from.email, toEmail: person.email, subject: row.settings.name, text, messageId: `<${key}@crm>` }, { idempotencyKey: key });
          sent += 1;
        } catch (error) {
          // One person's email failing does not hold up the others; whoever set it up is told.
          if (delivery.by) await this.notifications.send(ctx, delivery.by, `The report "${row.settings.name}" could not be emailed to ${person.name}: ${error instanceof Error ? error.message : 'the email service refused it'}`, null);
        }
      }
      await this.reports.reached(ctx, row.id, slot);
    }
    return sent;
  }

  /** A report as the plain text of an email. */
  private async asText(ctx: Context, id: string, settings: ReportSettings, delivery: Delivery): Promise<string> {
    const result = await this.run(ctx, settings);
    const object = await this.workspace.definition(ctx, settings.objectId);
    const measure = settings.measure;
    const measured = measure.kind === 'count' ? undefined : object.properties.find((property) => property.id === measure.property);
    const show = (value: number) => (measured?.type === 'currency' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value));
    const what = settings.measure.kind === 'count' ? 'Count' : `${settings.measure.kind === 'sum' ? 'Total' : 'Average'} ${measured?.label.toLowerCase() ?? ''}`.trim();
    const noun = (result.records === 1 ? object.singular : object.plural).toLowerCase();
    const lines = [settings.name, '', `${what}: ${show(result.total)}, from ${new Intl.NumberFormat('en-US').format(result.records)} ${noun}.`];
    if (result.rows.length > 0) {
      const width = Math.max(...result.rows.map((row) => row.label.length));
      lines.push('', ...result.rows.map((row) => `${row.label.padEnd(width)}  ${show(row.value)}${settings.measure.kind === 'count' ? '' : `  (${row.count})`}`));
    }
    const day = delivery.every === 'week' ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][(delivery.weekday ?? 1) - 1] : 'day';
    lines.push('', `Open it: ${this.appOrigin}/reports/${id}`, '', `You are sent this every ${day} at ${String(delivery.hour).padStart(2, '0')}:00 UTC, with the numbers your role lets you see. It can be changed or stopped on the report.`);
    return lines.join('\n');
  }

  async remove(ctx: Context, id: string): Promise<void> {
    await this.reports.deleteWhere(ctx, { id });
    for (const dashboard of await this.dashboards.findMany(ctx, {}, { limit: 100 })) {
      if (dashboard.reportIds.includes(id)) await this.dashboards.update(ctx, dashboard.id, { reportIds: dashboard.reportIds.filter((reportId) => reportId !== id) });
    }
  }

  async listDashboards(ctx: Context): Promise<Dashboard[]> {
    const rows = await this.dashboards.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 100 });
    return rows.map((row) => ({ id: row.id, name: row.name, reportIds: row.reportIds }));
  }

  async saveDashboard(ctx: Context, input: Dashboard): Promise<Dashboard> {
    if (!(await this.dashboards.findById(ctx, input.id))) throw new NotFoundError('dashboard', input.id);
    const row = await this.dashboards.update(ctx, input.id, { name: input.name, reportIds: input.reportIds });
    return { id: row.id, name: row.name, reportIds: row.reportIds };
  }

  /** This quarter, one row per person whose deals the acting person may see: what they have won and what is still open, by forecast category. */
  async forecast(ctx: Context): Promise<Forecast> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const index = Math.floor(now.getUTCMonth() / 3);
    const start = new Date(Date.UTC(year, index * 3, 1));
    const end = new Date(Date.UTC(year, index * 3 + 3, 0));
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const { object, where } = await this.records.conditions(ctx, 'deals', [{ property: 'closeDate', operator: 'between', value: [iso(start), iso(end)] }]);
    // A stage that ends well is won; one that ends badly is lost; the rest are open.
    const stages = object.properties.find((item) => item.id === object.board?.groupBy)?.options ?? [];
    const won = new Set(stages.filter((stage) => stage.tone === 'success').map((stage) => stage.id));
    const lost = new Set(stages.filter((stage) => stage.tone === 'danger').map((stage) => stage.id));
    const groups = await this.recordRows.aggregate(ctx, where, [propertyText('owner'), propertyText(object.board?.groupBy ?? 'stage'), propertyText('forecast')], 'amount');

    const [users, goals] = await Promise.all([this.people.users(ctx), this.goals.findMany(ctx, {}, { limit: 1000 })]);
    const rows = users
      .map((user) => {
        const row = { userId: user.id, goal: goals.find((goal) => goal.id === user.id)?.amount ?? DEFAULT_GOAL, won: 0, commit: 0, best: 0, pipeline: 0, openDeals: 0 };
        for (const group of groups) {
          const [owner, stage, category] = group.keys;
          if (owner !== user.id || !stage || lost.has(stage)) continue;
          if (won.has(stage)) row.won += group.sum;
          else {
            if (category === 'commit' || category === 'best' || category === 'pipeline') row[category] += group.sum;
            if (category !== 'omitted') row.openDeals += group.count;
          }
        }
        return row;
      })
      // People whose deals the acting person cannot see would show as zeros; leave them out.
      .filter((row) => row.won + row.commit + row.best + row.pipeline > 0);
    return { period: `Q${index + 1} ${year}`, from: iso(start), to: iso(end), elapsed: Math.min(1, (Date.parse(iso(now)) - start.getTime()) / (end.getTime() - start.getTime())), rows };
  }

  async setGoal(ctx: Context, input: { userId: string; amount: number }): Promise<void> {
    assertAllowed(actorOf(ctx), 'managePeople', 'set goals');
    const amount = Math.max(0, Math.round(input.amount));
    if (await this.goals.findById(ctx, input.userId)) await this.goals.update(ctx, input.userId, { amount });
    else await this.goals.create(ctx, { id: input.userId, amount });
  }
}
