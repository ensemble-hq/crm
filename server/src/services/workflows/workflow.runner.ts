import { type Context, MariachiError } from '@mariachi/core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ObjectDefinition, PropertyValue } from '../../../../src/contracts/metadata';
import type { CrmRecord } from '../../../../src/contracts/records';
import type { Action, WorkflowSettings } from '../../../../src/contracts/workflows';
import type { WorkflowRow } from '../../schema';
import type { EmailTemplatesRepository } from '../inbox/inbox.repository';
import type { MailService } from '../inbox/mail.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PeopleService } from '../people/people.service';
import type { RecordEvents } from '../records/records.events';
import { condition, tokens } from '../records/records.query';
import type { RecordsRepository } from '../records/records.repository';
import type { SequencesService } from '../sequences/sequences.service';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { WorkflowRunsRepository, WorkflowsRepository } from './workflows.repository';

/**
 * Runs workflows when records change. It listens for record events in the worker, so a workflow
 * fires the same way whether the change came from a person, an import or an agent. What a
 * workflow changes is announced as coming from a workflow, and those events are ignored here, so
 * two workflows can never chase each other.
 */

export type RecordEvent = { kind: 'created'; recordId: string } | { kind: 'changed'; recordId: string; changed: Record<string, PropertyValue> };

const DAY = 86_400_000;
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

class ActionFailed extends MariachiError {
  constructor(message: string) {
    super('workflows/action-failed', message);
  }
}

export class WorkflowRunner {
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly runs: WorkflowRunsRepository,
    private readonly records: RecordsRepository,
    private readonly events: RecordEvents,
    private readonly workspace: WorkspaceService,
    private readonly people: PeopleService,
    private readonly notifications: NotificationsService,
    private readonly templates: EmailTemplatesRepository,
    private readonly mail: MailService,
    private readonly sequences: SequencesService,
  ) {}

  /** Runs every workflow that is on and fits what happened. Returns how many ran. Safe to call twice for the same event. */
  async handle(ctx: Context, event: RecordEvent, eventId: string): Promise<number> {
    const record = await this.records.one(ctx, event.recordId);
    if (!record) return 0;
    const objects = await this.workspace.definitions(ctx);
    const object = objects.find((item) => item.id === record.objectId);
    if (!object) return 0;
    let ran = 0;
    for (const workflow of await this.workflows.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 })) {
      const settings = workflow.settings;
      if (!settings.on || settings.objectId !== record.objectId || !this.triggered(settings, event, record)) continue;
      if (!(await this.passes(ctx, object, record, settings))) continue;
      if (await this.runs.exists(ctx, { workflowId: workflow.id, eventId })) continue;
      await this.run(ctx, workflow, record.id, eventId, objects);
      ran += 1;
    }
    return ran;
  }

  private triggered(settings: WorkflowSettings, event: RecordEvent, record: CrmRecord): boolean {
    const trigger = settings.trigger;
    if (trigger.kind === 'created') return event.kind === 'created';
    if (event.kind !== 'changed' || !(trigger.property in event.changed)) return false;
    return trigger.to === undefined || record.properties[trigger.property] === trigger.to;
  }

  /** The conditions are the same filters lists use, asked of this one record. */
  private async passes(ctx: Context, object: ObjectDefinition, record: CrmRecord, settings: WorkflowSettings): Promise<boolean> {
    if (settings.conditions.length === 0) return true;
    const resolve = tokens(ctx.userId);
    return (await this.records.total(ctx, [sql`records.id = ${record.id}`, ...settings.conditions.map((item) => condition(object, item, resolve))])) > 0;
  }

  private async run(ctx: Context, workflow: WorkflowRow, recordId: string, eventId: string, objects: ObjectDefinition[]): Promise<void> {
    const steps: string[] = [];
    let status: 'done' | 'failed' = 'done';
    for (const action of workflow.settings.actions) {
      try {
        // Each action sees what the ones before it did.
        const record = await this.records.one(ctx, recordId);
        if (!record) throw new ActionFailed('The record was deleted.');
        steps.push(await this.perform(ctx, workflow, action, record, objects));
      } catch (error) {
        steps.push(`Stopped: ${error instanceof Error ? error.message : 'an action failed'}`);
        status = 'failed';
        break;
      }
    }
    await this.runs.create(ctx, { id: id('run'), workflowId: workflow.id, recordId, eventId, status, steps });
  }

  private async change(ctx: Context, record: CrmRecord, changes: Record<string, PropertyValue>): Promise<void> {
    await this.events.transaction(ctx, async () => {
      const updated = await this.records.patch(ctx, record.id, changes);
      if (updated) await this.events.changed(ctx, updated, changes, 'workflow');
    });
  }

  private async perform(ctx: Context, workflow: WorkflowRow, action: Action, record: CrmRecord, objects: ObjectDefinition[]): Promise<string> {
    const object = objects.find((item) => item.id === record.objectId);
    const users = await this.people.users(ctx);
    const owner = typeof record.properties.owner === 'string' ? record.properties.owner : null;
    const ownerName = users.find((user) => user.id === owner)?.name ?? 'nobody (no owner)';
    switch (action.kind) {
      case 'set-property': {
        const property = object?.properties.find((item) => item.id === action.property);
        if (!property) throw new ActionFailed(`The property "${action.property}" no longer exists.`);
        await this.change(ctx, record, { [action.property]: action.value });
        const shown = property.options?.find((option) => option.id === action.value)?.label ?? String(action.value);
        return `Set ${property.label.toLowerCase()} to ${shown}`;
      }
      case 'assign': {
        const active = action.userIds.filter((userId) => users.some((user) => user.id === userId));
        if (active.length === 0) throw new ActionFailed('None of the people it shares between are active any more.');
        // The turn is taken in the database, so two records arriving together go to two different people.
        const userId = active[(await this.workflows.takeTurn(ctx, workflow.id)) % active.length] as string;
        await this.change(ctx, record, { owner: userId });
        return `Assigned to ${users.find((user) => user.id === userId)?.name ?? userId}`;
      }
      case 'create-task': {
        const tasks = objects.find((item) => item.completion);
        if (!tasks?.completion) throw new ActionFailed('There is no task object to create a task in.');
        const contact = record.objectId === 'contacts' ? record.id : typeof record.properties.contact === 'string' ? record.properties.contact : null;
        const wanted: Record<string, PropertyValue> = {
          [tasks.primaryProperty]: action.title,
          type: 'todo',
          dueDate: new Date(Date.now() + action.dueInDays * DAY).toISOString().slice(0, 10),
          priority: 'medium',
          [tasks.completion.property]: tasks.completion.open,
          owner,
          deal: record.objectId === 'deals' ? record.id : null,
          contact,
          company: record.objectId === 'companies' ? record.id : typeof record.properties.company === 'string' ? record.properties.company : null,
          createdAt: new Date().toISOString().slice(0, 10),
        };
        // Only the fields the task object really has, so a customized task object still works.
        const properties = Object.fromEntries(Object.entries(wanted).filter(([key]) => tasks.properties.some((property) => property.id === key)));
        await this.events.transaction(ctx, async () => {
          const task = await this.records.insert(ctx, { id: id('tas'), objectId: tasks.id, properties });
          await this.events.created(ctx, task, 'workflow');
        });
        return `Created the task "${action.title}" for ${ownerName}`;
      }
      case 'notify':
        if (owner) await this.notifications.send(ctx, owner, action.message, record.id);
        return `Notified ${ownerName}: “${action.message}”`;
      case 'webhook': {
        if (!/^https:\/\//.test(action.url)) throw new ActionFailed('A webhook needs an https:// address.');
        const response = await fetch(action.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflow: workflow.settings.name, record }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new ActionFailed(`${action.url} answered ${response.status}.`);
        return `Posted to ${action.url}`;
      }
      case 'send-email': {
        const template = await this.templates.findById(ctx, action.templateId);
        if (!template) throw new ActionFailed('The email template no longer exists.');
        const contactId = record.objectId === 'contacts' ? record.id : typeof record.properties.contact === 'string' ? record.properties.contact : null;
        const contact = contactId ? await this.records.one(ctx, contactId) : undefined;
        if (!contact) throw new ActionFailed('There is no contact to email on this record.');
        const sender = users.find((user) => user.id === owner);
        if (!sender) throw new ActionFailed('The record has no owner to send the email from.');
        const fill = (text: string) => text.replace(/\{\{firstName\}\}/g, String(contact.properties.name ?? '').split(' ')[0] ?? '').replace(/\{\{myName\}\}/g, sender.name.split(' ')[0] ?? sender.name);
        await this.mail.compose(ctx, { contact, sender, subject: fill(template.subject || template.name), body: fill(template.body), dealId: record.objectId === 'deals' ? record.id : null });
        return `Sent "${template.name}" to ${String(contact.properties.name ?? 'the contact')}`;
      }
      case 'enroll': {
        const contactId = record.objectId === 'contacts' ? record.id : typeof record.properties.contact === 'string' ? record.properties.contact : null;
        const contact = contactId ? await this.records.one(ctx, contactId) : undefined;
        if (!contact) throw new ActionFailed('There is no contact to enrol on this record.');
        return this.sequences.enrollFromWorkflow(ctx, action.sequenceId, contact, owner);
      }
    }
  }
}
