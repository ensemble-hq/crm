import { column, defineTable, type InferEntity } from '@mariachi/database';
import type { ObjectDefinition } from '../../../src/contracts/metadata';

/**
 * What kinds of record exist and what fields they have. Definitions are data, so adding an object
 * or a field in the CRM never needs a migration.
 */
export const objectsTable = defineTable('objects', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  /** Order in the navigation. */
  position: column.integer().notNull().default(0),
  definition: column.json().$type<ObjectDefinition>().notNull(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type ObjectRow = InferEntity<typeof objectsTable>;
