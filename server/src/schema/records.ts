import { column, defineTable, index, type InferEntity } from '@mariachi/database';
import type { PropertyValue } from '../../../src/contracts/metadata';

/**
 * Every record of every object: a contact, a deal, a custom object's row. The fixed columns are
 * what all records share; `properties` holds the fields the object's definition describes.
 */
export const recordsTable = defineTable(
  'records',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    objectId: column.text().notNull(),
    properties: column.json().$type<Record<string, PropertyValue>>().notNull().defaultSql("'{}'::jsonb"),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
    deletedAt: column.timestamp(),
    /** Who deleted it. `merge` when it went because it was merged into another, which is not something to restore. */
    deletedBy: column.text(),
  },
  { indexes: [index('records_object_idx').on('tenantId', 'objectId', 'createdAt')] },
);
export type RecordRow = InferEntity<typeof recordsTable>;

/** Why a field the model fills in says what it says on a record. One row per record and field, replaced each time the model is asked again. */
export const judgementsTable = defineTable(
  'judgements',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    recordId: column.text().notNull(),
    propertyId: column.text().notNull(),
    reason: column.text().notNull(),
    model: column.text().notNull(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('judgements_record_idx').on('tenantId', 'recordId')] },
);
export type JudgementRow = InferEntity<typeof judgementsTable>;
