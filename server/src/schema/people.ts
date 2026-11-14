import { column, defineTable, type InferEntity } from '@mariachi/database';

/** The people who use the CRM. Sign-in is the auth provider's job; this is who records belong to and what each person may do. */
export const peopleTable = defineTable('people', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  name: column.text().notNull(),
  email: column.text().notNull(),
  roleId: column.text().notNull(),
  teamId: column.text(),
  /** `active`, `invited` (not signed in yet) or `deactivated` (no access; kept so their history still has a name). */
  status: column.text().notNull().default('active'),
  /** Set while an administrator is looking at the CRM as someone else: that person's id. */
  viewingAs: column.text(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type PersonRow = InferEntity<typeof peopleTable>;
