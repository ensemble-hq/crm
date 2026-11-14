import { column, defineTable, index, type InferEntity } from '@mariachi/database';

/** What a person finds under the bell: something happened that they should know about. */
export const notificationsTable = defineTable(
  'notifications',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    userId: column.text().notNull(),
    message: column.text().notNull(),
    recordId: column.text(),
    read: column.boolean().notNull().default(false),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('notifications_user_idx').on('tenantId', 'userId', 'createdAt')] },
);
export type NotificationRow = InferEntity<typeof notificationsTable>;
