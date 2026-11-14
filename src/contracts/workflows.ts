import { z } from 'zod';
import { filterSchema, propertyValueSchema } from './metadata';
import { referenceSchema } from './records';

/**
 * Workflow contracts. A workflow reads as one sentence: when something happens to a record of an
 * object, and it passes the conditions, do these things in order.
 */

export const triggerSchema = z.discriminatedUnion('kind', [
  /** A record of the object is created. */
  z.object({ kind: z.literal('created') }),
  /** A property changes; optionally only when it changes to one value. */
  z.object({ kind: z.literal('changed'), property: z.string(), to: z.string().optional() }),
  /** On a schedule: every day, or every week on one weekday (1 Monday to 7 Sunday), at an hour of the day in UTC. It runs for each record that passes the conditions at that moment. */
  z.object({ kind: z.literal('schedule'), every: z.enum(['day', 'week']), hour: z.number().int().min(0).max(23), weekday: z.number().int().min(1).max(7).optional() }),
  /** When another system calls the workflow's own address, naming a record. */
  z.object({ kind: z.literal('called') }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('set-property'), property: z.string(), value: propertyValueSchema }),
  /** A task about the record, for its owner. */
  z.object({ id: z.string(), kind: z.literal('create-task'), title: z.string(), dueInDays: z.number().int().min(0) }),
  /** An email to the record's contact, from a template. */
  z.object({ id: z.string(), kind: z.literal('send-email'), templateId: z.string() }),
  /** A notification to the record's owner. */
  z.object({ id: z.string(), kind: z.literal('notify'), message: z.string() }),
  z.object({ id: z.string(), kind: z.literal('enroll'), sequenceId: z.string() }),
  /** Gives the record to the next person in turn. */
  z.object({ id: z.string(), kind: z.literal('assign'), userIds: z.array(z.string()).min(1) }),
  /** Posts the record to another system. */
  z.object({ id: z.string(), kind: z.literal('webhook'), url: z.string() }),
]);
export type Action = z.infer<typeof actionSchema>;
export type ActionKind = Action['kind'];

export const workflowSettingsSchema = z.object({
  name: z.string().min(1),
  /** An off workflow is kept but never runs. */
  on: z.boolean(),
  objectId: z.string(),
  trigger: triggerSchema,
  conditions: z.array(filterSchema),
  actions: z.array(actionSchema),
});
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

export const workflowSchema = workflowSettingsSchema.extend({
  id: z.string(),
  runs: z.number().int(),
  lastRunAt: z.string().nullable(),
  /** For a workflow another system calls: the address to call. Anyone who has it can set the workflow off, so it is shown only to people who manage settings. */
  hookUrl: z.string().optional(),
});
export type Workflow = z.infer<typeof workflowSchema>;

export const workflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  recordId: z.string(),
  status: z.enum(['done', 'failed']),
  startedAt: z.string(),
  /** What each action did, in words. */
  steps: z.array(z.string()),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const workflowDetailSchema = z.object({
  workflow: workflowSchema,
  /** The most recent runs. */
  runs: z.array(workflowRunSchema),
  references: z.record(referenceSchema),
});
export type WorkflowDetail = z.infer<typeof workflowDetailSchema>;

export interface WorkflowsApi {
  listWorkflows(): Promise<Workflow[]>;
  getWorkflow(id: string): Promise<WorkflowDetail>;
  /** Creates a workflow, or replaces one when `id` is given. */
  saveWorkflow(input: WorkflowSettings & { id?: string }): Promise<Workflow>;
  deleteWorkflow(id: string): Promise<void>;
  /** How many records pass the conditions right now. A check before switching a workflow on. */
  countWorkflowMatches(input: { objectId: string; conditions: WorkflowSettings['conditions'] }): Promise<{ matching: number; total: number }>;
}
