import { type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { Reference } from '../../../../src/contracts/records';
import type { Workflow, WorkflowDetail, WorkflowSettings } from '../../../../src/contracts/workflows';
import type { WorkflowRow } from '../../schema';
import { actorOf, assertAllowed } from '../people/access';
import type { RecordsRepository } from '../records/records.repository';
import type { RecordsService } from '../records/records.service';
import type { WorkspaceService } from '../workspace/workspace.service';
import { hookToken, latestSlot } from './timing';
import type { WorkflowRunsRepository, WorkflowsRepository } from './workflows.repository';

/** Setting workflows up and reading their history. Running them is the worker's job (`workflow.runner.ts`). */
export class WorkflowsService {
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly runs: WorkflowRunsRepository,
    private readonly records: RecordsService,
    private readonly recordRows: RecordsRepository,
    private readonly workspace: WorkspaceService,
    private readonly secret: string,
    private readonly appOrigin: string,
  ) {}

  private summarize(ctx: Context, row: WorkflowRow, totals: Map<string, { runs: number; lastRunAt: string | null }>): Workflow {
    // The address sets the workflow off for anyone who has it, so only people who could change the workflow are shown it.
    const hookUrl = row.settings.trigger.kind === 'called' && actorOf(ctx).role.manageSettings ? `${this.appOrigin}/api/hooks/${hookToken(this.secret, row.id)}` : undefined;
    return { id: row.id, ...row.settings, runs: totals.get(row.id)?.runs ?? 0, lastRunAt: totals.get(row.id)?.lastRunAt ?? null, ...(hookUrl ? { hookUrl } : {}) };
  }

  async list(ctx: Context): Promise<Workflow[]> {
    const [rows, totals] = await Promise.all([this.workflows.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 }), this.runs.totals(ctx)]);
    return rows.map((row) => this.summarize(ctx, row, totals));
  }

  async get(ctx: Context, id: string): Promise<WorkflowDetail> {
    const row = await this.workflows.findById(ctx, id);
    if (!row) throw new NotFoundError('workflow', id);
    const [recent, totals, objects] = await Promise.all([
      this.runs.findMany(ctx, { workflowId: id }, { sort: { field: 'startedAt', direction: 'desc' }, limit: 25 }),
      this.runs.totals(ctx),
      this.workspace.definitions(ctx),
    ]);
    const references: Record<string, Reference> = {};
    for (const record of await this.recordRows.byIds(ctx, [...new Set(recent.map((run) => run.recordId))])) {
      const primary = objects.find((object) => object.id === record.objectId)?.primaryProperty;
      const label = primary ? record.properties[primary] : undefined;
      references[record.id] = { objectId: record.objectId, label: typeof label === 'string' ? label : record.id };
    }
    return {
      workflow: this.summarize(ctx, row, totals),
      runs: recent.map((run) => ({ id: run.id, workflowId: run.workflowId, recordId: run.recordId, status: run.status as 'done' | 'failed', startedAt: run.startedAt.toISOString(), steps: run.steps })),
      references,
    };
  }

  async save(ctx: Context, input: WorkflowSettings & { id?: string }): Promise<Workflow> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'change workflows');
    const { id, ...settings } = input;
    if (settings.actions.length === 0) throw new ValidationError('A workflow needs at least one action.');
    const object = await this.workspace.definition(ctx, settings.objectId);
    const has = (propertyId: string) => object.properties.some((property) => property.id === propertyId);
    if (settings.trigger.kind === 'changed' && !has(settings.trigger.property)) throw new ValidationError('Choose which property the workflow watches.');
    if (settings.trigger.kind === 'schedule' && settings.trigger.every === 'week' && settings.trigger.weekday === undefined) throw new ValidationError('Choose which day of the week the workflow runs on.');
    // A schedule starts from the next time it is due: saving it never sets it off for a moment already past.
    const lastSlot = settings.trigger.kind === 'schedule' ? latestSlot(settings.trigger, new Date()) : null;
    for (const condition of settings.conditions) if (!has(condition.property)) throw new ValidationError(`${object.plural} have no property "${condition.property}".`);
    for (const action of settings.actions) {
      if (action.kind === 'create-task' && action.title.trim() === '') throw new ValidationError('Say what the task is.');
      if (action.kind === 'notify' && action.message.trim() === '') throw new ValidationError('Write the notification.');
      if (action.kind === 'webhook' && !/^https:\/\//.test(action.url)) throw new ValidationError('A webhook needs an https:// address.');
      if (action.kind === 'set-property' && !has(action.property)) throw new ValidationError('Choose which property the workflow sets.');
    }
    if (id) {
      if (!(await this.workflows.findById(ctx, id))) throw new NotFoundError('workflow', id);
      return this.summarize(ctx, await this.workflows.update(ctx, id, { settings, lastSlot }), await this.runs.totals(ctx));
    }
    return this.summarize(ctx, await this.workflows.create(ctx, { id: `wf_${randomUUID().replace(/-/g, '').slice(0, 12)}`, settings, turn: 0, lastSlot }), new Map());
  }

  async remove(ctx: Context, id: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'delete workflows');
    await this.workflows.deleteWhere(ctx, { id });
  }

  countMatches(ctx: Context, input: { objectId: string; conditions: WorkflowSettings['conditions'] }): Promise<{ matching: number; total: number }> {
    return this.records.count(ctx, input.objectId, input.conditions);
  }
}
