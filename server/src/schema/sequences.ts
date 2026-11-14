import { column, defineTable, index, type InferEntity } from '@mariachi/database';
import type { SequenceStep } from '../../../src/contracts/sequences';

/** A series of emails and tasks that each enrolled contact moves through on a schedule. */
export const sequencesTable = defineTable('sequences', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  name: column.text().notNull(),
  /** A paused sequence keeps its contacts but does nothing. */
  status: column.text().notNull().default('active'),
  steps: column.json().$type<SequenceStep[]>().notNull(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type SequenceRow = InferEntity<typeof sequencesTable>;

/** One contact's place in one sequence. */
export const enrollmentsTable = defineTable(
  'enrollments',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    sequenceId: column.text().notNull(),
    contactId: column.text().notNull(),
    /** `active`, `replied` (they answered, so it stopped), `finished` or `stopped`. */
    status: column.text().notNull().default('active'),
    stepsDone: column.integer().notNull().default(0),
    /** Who the emails come from and whose tasks the steps create: the person who enrolled the contact. */
    senderId: column.text(),
    /** The email thread the sequence's emails go out on, once the first has been sent. */
    conversationId: column.text(),
    /** Why it stopped, when a step could not be carried out. */
    problem: column.text(),
    enrolledAt: column.timestamp().notNull().defaultNow(),
    /** When the next step runs. Null when there is none, or while the sequence is paused. */
    nextRunAt: column.timestamp(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('enrollments_due_idx').on('tenantId', 'status', 'nextRunAt'), index('enrollments_sequence_idx').on('tenantId', 'sequenceId', 'enrolledAt'), index('enrollments_contact_idx').on('tenantId', 'contactId', 'status')] },
);
export type EnrollmentRow = InferEntity<typeof enrollmentsTable>;
