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
  },
  { indexes: [index('records_object_idx').on('tenantId', 'objectId', 'createdAt')] },
);
export type RecordRow = InferEntity<typeof recordsTable>;
