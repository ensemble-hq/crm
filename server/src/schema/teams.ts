import { column, defineTable, type InferEntity } from '@mariachi/database';

export const teamsTable = defineTable('teams', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  name: column.text().notNull(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type TeamRow = InferEntity<typeof teamsTable>;
