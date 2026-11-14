import { column, defineTable, type InferEntity } from '@mariachi/database';
import type { RoleSettings } from '../../../src/contracts/team';

/** A role: how far its people can see, change and delete records, and whether they can run the workspace. */
export const rolesTable = defineTable('roles', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  settings: column.json().$type<RoleSettings>().notNull(),
  /** Roles that come with the CRM can be changed but not deleted. */
  builtIn: column.boolean().notNull().default(false),
  position: column.integer().notNull().default(0),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type RoleRow = InferEntity<typeof rolesTable>;
