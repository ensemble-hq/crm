import { column, defineTable, type InferEntity } from '@mariachi/database';

/** Which model the assistant runs on. One row. The key is stored encrypted and is never sent back to a browser. */
export const assistantSettingsTable = defineTable('assistant_settings', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  provider: column.text().notNull(),
  model: column.text().notNull(),
  baseUrl: column.text(),
  apiKeyEncrypted: column.text(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type AssistantSettingsRow = InferEntity<typeof assistantSettingsTable>;
