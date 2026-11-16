import { column, defineTable, index, type InferEntity } from '@mariachi/database';
import type { Assessment, StepCounts, StepSpec } from '../../../src/contracts/migration';

/** One move into the CRM from another system. */
export const migrationRunsTable = defineTable(
  'migration_runs',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    /** The system being left: `hubspot`. */
    source: column.text().notNull(),
    /** `draft`, `running`, `paused`, `checked`, `done`, `failed` or `cancelled`. */
    status: column.text().notNull().default('draft'),
    /** `check` reads and reports; `import` writes. */
    mode: column.text().notNull().default('check'),
    /** The other system's key, encrypted. Cleared when the import finishes or is cancelled. */
    keyEncrypted: column.text(),
    /** Who started it. Steps run as this person, so they can do only what that person may. */
    startedBy: column.text().notNull(),
    /** Held by the worker carrying the run, so two never work the same run. */
    lockedUntil: column.timestamp(),
    /** What the connected model made of the account, and what was decided about each thing it put forward. */
    assessment: column.json().$type<Assessment>(),
    error: column.text(),
    startedAt: column.timestamp(),
    finishedAt: column.timestamp(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('migration_runs_status_idx').on('tenantId', 'status')] },
);
export type MigrationRunRow = InferEntity<typeof migrationRunsTable>;

/** One step of a run, with everything it has done so far. */
export const migrationStepsTable = defineTable(
  'migration_steps',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    runId: column.text().notNull(),
    position: column.integer().notNull(),
    title: column.text().notNull(),
    spec: column.json().$type<StepSpec>().notNull(),
    /** `waiting`, `running`, `done`, `failed` or `skipped`. */
    status: column.text().notNull().default('waiting'),
    required: column.boolean().notNull().default(false),
    /** Where the step got to in the other system, so it carries on from there. */
    cursor: column.json().$type<unknown>(),
    counts: column.json().$type<StepCounts>().notNull(),
    note: column.text(),
    error: column.text(),
    addedBy: column.text().notNull().default('plan'),
    startedAt: column.timestamp(),
    finishedAt: column.timestamp(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('migration_steps_run_idx').on('tenantId', 'runId', 'position')] },
);
export type MigrationStepRow = InferEntity<typeof migrationStepsTable>;

/** Something a step wants a person to know. */
export const migrationIssuesTable = defineTable(
  'migration_issues',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    runId: column.text().notNull(),
    stepId: column.text().notNull(),
    /** `note`, `warning` or `problem`. */
    level: column.text().notNull(),
    sourceId: column.text(),
    message: column.text().notNull(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('migration_issues_step_idx').on('tenantId', 'stepId', 'createdAt')] },
);
export type MigrationIssueRow = InferEntity<typeof migrationIssuesTable>;

/**
 * What a thing in the other system became here: a record, a person, a field, a choice. This is
 * what lets a run be repeated without making anything twice, and lets one step find what an
 * earlier step brought.
 */
export const migrationLinksTable = defineTable(
  'migration_links',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    source: column.text().notNull(),
    /** What kind of thing: `record:contacts`, `owner`, `field:deals`, `option:deals.stage`, `object`. */
    kind: column.text().notNull(),
    sourceId: column.text().notNull(),
    targetId: column.text().notNull(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('migration_links_source_idx').on('tenantId', 'source', 'kind', 'sourceId').unique(), index('migration_links_target_idx').on('tenantId', 'source', 'kind', 'targetId')] },
);
export type MigrationLinkRow = InferEntity<typeof migrationLinksTable>;
