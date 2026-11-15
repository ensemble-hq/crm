import { column, defineTable, type InferEntity } from '@mariachi/database';

/** A file someone gave the CRM. The bytes are in the file store under `key`; this row says what they are. */
export const filesTable = defineTable('files', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  name: column.text().notNull(),
  contentType: column.text().notNull(),
  size: column.integer().notNull(),
  key: column.text().notNull(),
  /** Who uploaded it. Null when it arrived attached to an email. */
  uploadedBy: column.text(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type FileRow = InferEntity<typeof filesTable>;
