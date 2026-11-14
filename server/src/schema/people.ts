import { column, defineTable, type InferEntity } from '@mariachi/database';

/** The people who use the CRM. Sign-in is the auth provider's job; this is who records belong to. */
export const peopleTable = defineTable('people', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  name: column.text().notNull(),
  email: column.text().notNull(),
  active: column.boolean().notNull().default(true),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type PersonRow = InferEntity<typeof peopleTable>;
