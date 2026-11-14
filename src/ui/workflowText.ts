import type { EmailTemplate } from '../contracts/inbox';
import type { ObjectDefinition, User } from '../contracts/metadata';
import type { Sequence } from '../contracts/sequences';
import type { Action, ActionKind, Trigger, WorkflowSettings } from '../contracts/workflows';
import { describeFilter } from './filters';

/** Everything needed to turn ids in a workflow into names. */
export type WorkflowNames = { object: ObjectDefinition | undefined; users: User[]; templates: EmailTemplate[]; sequences: Sequence[] };

export const ACTION_LABELS: Record<ActionKind, string> = {
  'set-property': 'Set a field',
  'create-task': 'Create a task',
  'send-email': 'Send an email',
  notify: 'Notify the owner',
  enroll: 'Enrol in a sequence',
  assign: 'Assign an owner in turn',
  webhook: 'Call a webhook',
};

/** "a deal's stage changes to Closed won" */
export function triggerText(trigger: Trigger, object: ObjectDefinition | undefined): string {
  const one = `a ${object?.singular.toLowerCase() ?? 'record'}`;
  if (trigger.kind === 'created') return `${one} is created`;
  if (trigger.kind === 'called') return `another system calls it about ${one}`;
  if (trigger.kind === 'schedule') {
    const day = trigger.every === 'week' ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][(trigger.weekday ?? 1) - 1] : 'day';
    return `every ${day} at ${String(trigger.hour).padStart(2, '0')}:00 UTC`;
  }
  const property = object?.properties.find((item) => item.id === trigger.property);
  const to = trigger.to === undefined ? '' : ` to ${property?.options?.find((option) => option.id === trigger.to)?.label ?? trigger.to}`;
  return `${one}'s ${property?.label.toLowerCase() ?? 'field'} changes${to}`;
}

/** "create the task “Send the welcome pack”, due in 2 days" */
export function actionText(action: Action, names: WorkflowNames): string {
  switch (action.kind) {
    case 'set-property': {
      const property = names.object?.properties.find((item) => item.id === action.property);
      const value = action.value === null ? 'empty' : (property?.options?.find((option) => option.id === action.value)?.label ?? (property?.type === 'user' ? names.users.find((user) => user.id === action.value)?.name : undefined) ?? String(action.value));
      return `set ${property?.label.toLowerCase() ?? 'a field'} to ${value}`;
    }
    case 'create-task':
      return `create the task “${action.title || '…'}” for the owner, due ${action.dueInDays === 0 ? 'the same day' : `in ${action.dueInDays} ${action.dueInDays === 1 ? 'day' : 'days'}`}`;
    case 'send-email':
      return `email the contact “${names.templates.find((template) => template.id === action.templateId)?.name ?? '…'}”`;
    case 'notify':
      return `notify the owner: “${action.message || '…'}”`;
    case 'enroll':
      return `enrol the contact in “${names.sequences.find((sequence) => sequence.id === action.sequenceId)?.name ?? '…'}”`;
    case 'assign':
      return `give it to the next of ${action.userIds.map((id) => names.users.find((user) => user.id === id)?.name.split(' ')[0] ?? id).join(', ')}`;
    case 'webhook':
      return `post it to ${action.url || '…'}`;
  }
}

export function conditionsText(settings: Pick<WorkflowSettings, 'conditions'>, names: WorkflowNames): string {
  if (settings.conditions.length === 0 || !names.object) return '';
  const object = names.object;
  return settings.conditions.map((condition) => describeFilter(condition, object, names.users).replace(/^./, (first) => first.toLowerCase())).join(', and ');
}

/** The whole workflow as one sentence. */
export function workflowSentence(settings: WorkflowSettings, names: WorkflowNames): string {
  const conditions = conditionsText(settings, names);
  const actions = settings.actions.map((action) => actionText(action, names));
  const then = actions.length === 0 ? 'do nothing yet' : actions.length === 1 ? actions[0] : `${actions.slice(0, -1).join('; ')}; then ${actions[actions.length - 1]}`;
  // A schedule is not something that happens to a record, so it reads as a time and the records it then goes through.
  if (settings.trigger.kind === 'schedule') {
    const each = `each ${names.object?.singular.toLowerCase() ?? 'record'}`;
    return `${triggerText(settings.trigger, names.object).replace(/^./, (first) => first.toUpperCase())}, for ${each}${conditions ? ` where ${conditions}` : ''}: ${then}.`;
  }
  return `When ${triggerText(settings.trigger, names.object)}${conditions ? `, and ${conditions}` : ''}: ${then}.`;
}

/** A new action of a kind, with sensible starting values. */
export function newAction(kind: ActionKind, names: WorkflowNames): Action {
  const id = `a${Date.now().toString(36)}`;
  switch (kind) {
    case 'set-property': {
      // Start on a harmless field, never the stage: a workflow that moves records between stages should be a deliberate choice.
      const selects = (names.object?.properties ?? []).filter((item) => item.type === 'select' && !item.system && item.id !== names.object?.board?.groupBy);
      const property = selects.find((item) => item.id === 'priority') ?? selects[0];
      return { id, kind, property: property?.id ?? '', value: property?.options?.[0]?.id ?? null };
    }
    case 'create-task':
      return { id, kind, title: 'Follow up', dueInDays: 1 };
    case 'send-email':
      return { id, kind, templateId: names.templates[0]?.id ?? '' };
    case 'notify':
      return { id, kind, message: 'Something needs your attention.' };
    case 'enroll':
      return { id, kind, sequenceId: names.sequences[0]?.id ?? '' };
    case 'assign':
      return { id, kind, userIds: names.users.slice(0, 3).map((user) => user.id) };
    case 'webhook':
      return { id, kind, url: 'https://' };
  }
}
