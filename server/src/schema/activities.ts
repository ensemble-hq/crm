import { column, defineTable, index, type InferEntity } from '@mariachi/database';

/** What happened on a record: notes, logged calls, meetings and emails, and changes. */
export const activitiesTable = defineTable(
  'activities',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    recordId: column.text().notNull(),
    kind: column.text().notNull(),
    title: column.text().notNull(),
    body: column.text(),
    actorId: column.text().notNull(),
    occurredAt: column.timestamp().notNull().defaultNow(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('activities_record_idx').on('tenantId', 'recordId', 'occurredAt')] },
);
export type ActivityRow = InferEntity<typeof activitiesTable>;
