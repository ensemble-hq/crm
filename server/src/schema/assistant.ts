import { column, defineTable, index, type InferEntity } from '@mariachi/database';

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

/** One question put to the assistant and what answering it used. Kept so the cost of the model can be seen and traced to who asked. */
export const assistantTurnsTable = defineTable(
  'assistant_turns',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    userId: column.text().notNull(),
    /** The start of what was asked. */
    question: column.text().notNull(),
    provider: column.text().notNull(),
    model: column.text().notNull(),
    inputTokens: column.integer().notNull().default(0),
    outputTokens: column.integer().notNull().default(0),
    /** How many times it went back to the model. */
    rounds: column.integer().notNull().default(0),
    lookups: column.integer().notNull().default(0),
    plannedSteps: column.integer().notNull().default(0),
    durationMs: column.integer().notNull().default(0),
    /** Why it failed, when it did. */
    error: column.text(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('assistant_turns_recent_idx').on('tenantId', 'createdAt'), index('assistant_turns_user_idx').on('tenantId', 'userId', 'createdAt')] },
);
export type AssistantTurnRow = InferEntity<typeof assistantTurnsTable>;
