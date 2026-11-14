import { column, defineTable, index, type InferEntity } from '@mariachi/database';
import type { WorkflowSettings } from '../../../src/contracts/workflows';

/** A workflow: when something happens to a record and it passes the conditions, do these things in order. */
export const workflowsTable = defineTable('workflows', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  settings: column.json().$type<WorkflowSettings>().notNull(),
  /** Whose turn is next when the workflow shares records out between people. */
  turn: column.integer().notNull().default(0),
  /** For a workflow on a schedule: the last moment it was due that has been dealt with, so each one is gone through once. */
  lastSlot: column.text(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type WorkflowRow = InferEntity<typeof workflowsTable>;

/** One time a workflow ran on a record, with what each action did. */
export const workflowRunsTable = defineTable(
  'workflow_runs',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    workflowId: column.text().notNull(),
    recordId: column.text().notNull(),
    /** The event that set it off. An event can be delivered twice; a workflow runs once per event. */
    eventId: column.text().notNull(),
    status: column.text().notNull(),
    steps: column.json().$type<string[]>().notNull(),
    startedAt: column.timestamp().notNull().defaultNow(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('workflow_runs_event_idx').on('workflowId', 'eventId').unique(), index('workflow_runs_recent_idx').on('tenantId', 'workflowId', 'startedAt')] },
);
export type WorkflowRunRow = InferEntity<typeof workflowRunsTable>;
