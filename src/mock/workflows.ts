import type { Filter, ObjectDefinition, PropertyValue } from '../contracts/metadata';
import type { CrmRecord, Reference } from '../contracts/records';
import type { Action, Workflow, WorkflowRun, WorkflowSettings, WorkflowsApi } from '../contracts/workflows';
import { MOCK_NOW, MOCK_TODAY, users } from './definitions';
import { mulberry32 } from './generate';
import { emailTemplates } from './inbox';

/**
 * Workflows that really run, in memory. When the mock creates or changes a record, `fire` checks
 * every workflow that is on and carries out its actions. Changes made by a workflow do not set off
 * other workflows, so two can never chase each other.
 */

type Stored = WorkflowSettings & { id: string };

const workflows: Stored[] = [
  {
    id: 'wf_won',
    name: 'Welcome pack when a deal is won',
    on: true,
    objectId: 'deals',
    trigger: { kind: 'changed', property: 'stage', to: 'won' },
    conditions: [],
    actions: [
      { id: 'a1', kind: 'create-task', title: 'Send the welcome pack', dueInDays: 2 },
      { id: 'a2', kind: 'notify', message: 'A deal you own was won. A welcome-pack task is on your list.' },
    ],
  },
  {
    id: 'wf_route',
    name: 'Share out new contacts with no owner',
    on: true,
    objectId: 'contacts',
    trigger: { kind: 'created' },
    conditions: [{ property: 'owner', operator: 'empty' }],
    actions: [
      { id: 'a1', kind: 'assign', userIds: ['usr_priya', 'usr_jonas', 'usr_dario'] },
      { id: 'a2', kind: 'create-task', title: 'Call the new lead', dueInDays: 1 },
    ],
  },
  {
    id: 'wf_big',
    name: 'Flag large new deals',
    on: false,
    objectId: 'deals',
    trigger: { kind: 'created' },
    conditions: [{ property: 'amount', operator: 'gt', value: 100_000 }],
    actions: [
      { id: 'a1', kind: 'set-property', property: 'priority', value: 'high' },
      { id: 'a2', kind: 'notify', message: 'A deal over $100,000 was created.' },
    ],
  },
];

const runs: WorkflowRun[] = [];
const turn = new Map<string, number>();
let counter = 0;
let seeded = false;

export type RecordEvent = { kind: 'created'; record: CrmRecord } | { kind: 'changed'; record: CrmRecord; changed: Record<string, PropertyValue> };

export type WorkflowDeps = {
  respond: <T>(compute: () => T) => Promise<T>;
  definition: (objectId: string) => ObjectDefinition;
  matches: (record: CrmRecord, filter: Filter) => boolean;
  records: (objectId: string) => CrmRecord[];
  find: (recordId: string) => CrmRecord | undefined;
  labelOf: (recordId: string) => string;
  /** Writes straight to the store, without setting off workflows. */
  createTask: (properties: Record<string, PropertyValue>) => void;
  logEmail: (recordId: string, subject: string, body: string) => void;
  enroll: (sequenceId: string, contactId: string) => string;
  /** Puts a notification in a user's bell. */
  notify: (userId: string, message: string, recordId: string) => void;
};

/** Past runs, so the history is not empty on first load. */
function seed(deps: WorkflowDeps): void {
  if (seeded) return;
  seeded = true;
  const random = mulberry32(31_2026);
  const now = Date.parse(MOCK_NOW);
  for (const workflow of workflows) {
    const pool = deps.records(workflow.objectId);
    const count = workflow.on ? 12 + Math.floor(random() * 30) : 0;
    for (let index = 0; index < count; index += 1) {
      const record = pool[Math.floor(random() * pool.length)];
      if (!record) continue;
      counter += 1;
      runs.push({
        id: `run_${String(counter).padStart(4, '0')}`,
        workflowId: workflow.id,
        recordId: record.id,
        status: random() < 0.96 ? 'done' : 'failed',
        startedAt: new Date(now - Math.floor(1 + random() ** 2 * 60 * 24) * 3_600_000).toISOString(),
        steps: workflow.actions.map((action) => describeDone(action, record, deps)),
      });
    }
  }
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function ownerName(record: CrmRecord): string {
  return users.find((user) => user.id === record.properties.owner)?.name ?? 'nobody (no owner)';
}

/** What an action did, in words, for the run history. Used for seeded runs, where nothing is carried out. */
function describeDone(action: Action, record: CrmRecord, deps: WorkflowDeps): string {
  switch (action.kind) {
    case 'set-property': {
      const property = deps.definition(record.objectId).properties.find((item) => item.id === action.property);
      const shown = property?.options?.find((option) => option.id === action.value)?.label ?? String(action.value);
      return `Set ${property?.label.toLowerCase() ?? action.property} to ${shown}`;
    }
    case 'create-task':
      return `Created the task "${action.title}" for ${ownerName(record)}`;
    case 'send-email':
      return `Sent "${emailTemplates.find((template) => template.id === action.templateId)?.name ?? 'an email'}"`;
    case 'notify':
      return `Notified ${ownerName(record)}`;
    case 'enroll':
      return 'Enrolled the contact in a sequence';
    case 'assign':
      return 'Assigned an owner in turn';
    case 'webhook':
      return `Posted to ${action.url}`;
  }
}

/** The contact an email or sequence step goes to: the record itself, or the one it points at. */
function contactOf(record: CrmRecord): string | undefined {
  if (record.objectId === 'contacts') return record.id;
  return typeof record.properties.contact === 'string' ? record.properties.contact : undefined;
}

function perform(workflow: Stored, action: Action, record: CrmRecord, deps: WorkflowDeps): string {
  switch (action.kind) {
    case 'set-property':
      record.properties[action.property] = action.value;
      return describeDone(action, record, deps);
    case 'assign': {
      const position = turn.get(workflow.id) ?? 0;
      const userId = action.userIds[position % action.userIds.length] as string;
      turn.set(workflow.id, position + 1);
      record.properties.owner = userId;
      return `Assigned to ${users.find((user) => user.id === userId)?.name ?? userId}`;
    }
    case 'create-task': {
      const due = new Date(Date.parse(MOCK_TODAY) + action.dueInDays * 86_400_000).toISOString().slice(0, 10);
      deps.createTask({
        name: action.title,
        type: 'todo',
        dueDate: due,
        priority: 'medium',
        status: 'open',
        owner: typeof record.properties.owner === 'string' ? record.properties.owner : null,
        deal: record.objectId === 'deals' ? record.id : null,
        contact: contactOf(record) ?? null,
        company: record.objectId === 'companies' ? record.id : typeof record.properties.company === 'string' ? record.properties.company : null,
      });
      return describeDone(action, record, deps);
    }
    case 'send-email': {
      const template = emailTemplates.find((item) => item.id === action.templateId);
      const contactId = contactOf(record);
      if (!template) throw new Error('The email template no longer exists.');
      if (!contactId) throw new Error('There is no contact to email on this record.');
      deps.logEmail(contactId, template.subject || template.name, template.body);
      if (contactId !== record.id) deps.logEmail(record.id, template.subject || template.name, template.body);
      return `${describeDone(action, record, deps)} to ${deps.labelOf(contactId)}`;
    }
    case 'enroll': {
      const contactId = contactOf(record);
      if (!contactId) throw new Error('There is no contact to enrol on this record.');
      return deps.enroll(action.sequenceId, contactId);
    }
    case 'notify':
      if (typeof record.properties.owner === 'string') deps.notify(record.properties.owner, action.message, record.id);
      return `${describeDone(action, record, deps)}: “${action.message}”`;
    case 'webhook':
      return `Would post to ${action.url} (nothing leaves this browser in the mock)`;
  }
}

function triggered(workflow: Stored, event: RecordEvent): boolean {
  if (workflow.trigger.kind === 'created') return event.kind === 'created';
  if (event.kind !== 'changed' || !(workflow.trigger.property in event.changed)) return false;
  return workflow.trigger.to === undefined || event.record.properties[workflow.trigger.property] === workflow.trigger.to;
}

/** Runs every workflow that is on and fits what just happened. Returns how many ran. */
export function fire(event: RecordEvent, deps: WorkflowDeps): number {
  seed(deps);
  let ran = 0;
  for (const workflow of workflows) {
    if (!workflow.on || workflow.objectId !== event.record.objectId || !triggered(workflow, event)) continue;
    if (!workflow.conditions.every((condition) => deps.matches(event.record, condition))) continue;
    const steps: string[] = [];
    let status: WorkflowRun['status'] = 'done';
    for (const action of workflow.actions) {
      try {
        steps.push(perform(workflow, action, event.record, deps));
      } catch (error) {
        steps.push(`Stopped: ${error instanceof Error ? error.message : 'an action failed'}`);
        status = 'failed';
        break;
      }
    }
    counter += 1;
    runs.unshift({ id: `run_new_${counter}`, workflowId: workflow.id, recordId: event.record.id, status, startedAt: new Date().toISOString(), steps });
    ran += 1;
  }
  return ran;
}

function summarize(workflow: Stored): Workflow {
  const mine = runs.filter((run) => run.workflowId === workflow.id);
  return { ...workflow, runs: mine.length, lastRunAt: mine[0]?.startedAt ?? null };
}

/** The workflows half of the mock API. */
export function createWorkflowsApi(deps: WorkflowDeps): WorkflowsApi {
  function find(id: string): Stored {
    const workflow = workflows.find((item) => item.id === id);
    if (!workflow) throw new Error('That workflow no longer exists.');
    return workflow;
  }

  return {
    listWorkflows: () =>
      deps.respond(() => {
        seed(deps);
        return workflows.map(summarize);
      }),

    getWorkflow: (id) =>
      deps.respond(() => {
        seed(deps);
        const workflow = find(id);
        const recent = runs.filter((run) => run.workflowId === id).slice(0, 25);
        const references: Record<string, Reference> = {};
        for (const run of recent) {
          const record = deps.find(run.recordId);
          if (record) references[run.recordId] = { objectId: record.objectId, label: deps.labelOf(run.recordId) };
        }
        return { workflow: summarize(workflow), runs: recent, references };
      }),

    saveWorkflow: (input) =>
      deps.respond(() => {
        const { id, ...settings } = input;
        if (settings.actions.length === 0) throw new Error('A workflow needs at least one action.');
        const object = deps.definition(settings.objectId);
        if (settings.trigger.kind === 'changed' && !object.properties.some((property) => property.id === (settings.trigger as { property: string }).property)) throw new Error('Choose which property the workflow watches.');
        for (const action of settings.actions) {
          if (action.kind === 'create-task' && action.title.trim() === '') throw new Error('Say what the task is.');
          if (action.kind === 'notify' && action.message.trim() === '') throw new Error('Write the notification.');
          if (action.kind === 'webhook' && !/^https:\/\//.test(action.url)) throw new Error('A webhook needs an https:// address.');
          if (action.kind === 'send-email' && !emailTemplates.some((template) => template.id === action.templateId)) throw new Error('Choose a template for the email.');
        }
        if (id) {
          const existing = find(id);
          Object.assign(existing, settings);
          return summarize(existing);
        }
        counter += 1;
        const created: Stored = { id: `wf_new_${counter}`, ...settings };
        workflows.push(created);
        return summarize(created);
      }),

    deleteWorkflow: (id) =>
      deps.respond(() => {
        const index = workflows.findIndex((workflow) => workflow.id === id);
        if (index >= 0) workflows.splice(index, 1);
      }),

    countWorkflowMatches: (input) =>
      deps.respond(() => {
        const all = deps.records(input.objectId);
        return { matching: all.filter((record) => input.conditions.every((condition) => deps.matches(record, condition))).length, total: all.length };
      }),
  };
}
