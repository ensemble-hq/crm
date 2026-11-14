import { column, defineTable, index, type InferEntity } from '@mariachi/database';

/** What an email provider hands over, in one shape whichever provider it is. */
export type InboundPayload = {
  fromEmail: string;
  fromName?: string;
  toEmail?: string;
  subject: string;
  text: string;
  /** The email's own Message-ID header, and the ones it answers. Used to find its thread. */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  receivedAt?: string;
};

/**
 * Every email that arrives, stored exactly as received before anything else happens to it. The
 * provider is only told "received" after this row is written, and filing it into a conversation is
 * done from this row, so a crash at any later point loses nothing.
 */
export const inboundEmailsTable = defineTable(
  'inbound_emails',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    provider: column.text().notNull(),
    /** The provider's id for the message. The same message delivered twice is stored once. */
    providerMessageId: column.text().notNull(),
    payload: column.json().$type<InboundPayload>().notNull(),
    /** `received` (waiting to be filed), `processed`, or `failed` (gave up after retries; still here). */
    status: column.text().notNull().default('received'),
    attempts: column.integer().notNull().default(0),
    lastError: column.text(),
    conversationId: column.text(),
    receivedAt: column.timestamp().notNull().defaultNow(),
    processedAt: column.timestamp(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('inbound_emails_provider_idx').on('tenantId', 'provider', 'providerMessageId').unique(), index('inbound_emails_status_idx').on('tenantId', 'status', 'receivedAt')] },
);
export type InboundEmailRow = InferEntity<typeof inboundEmailsTable>;

/** One email thread with a contact. */
export const conversationsTable = defineTable(
  'conversations',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    subject: column.text().notNull(),
    status: column.text().notNull().default('open'),
    assigneeId: column.text(),
    contactId: column.text().notNull(),
    companyId: column.text(),
    dealId: column.text(),
    unread: column.boolean().notNull().default(false),
    lastMessageAt: column.timestamp().notNull().defaultNow(),
    preview: column.text().notNull().default(''),
    messageCount: column.integer().notNull().default(0),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('conversations_folder_idx').on('tenantId', 'status', 'lastMessageAt'), index('conversations_contact_idx').on('tenantId', 'contactId')] },
);
export type ConversationRow = InferEntity<typeof conversationsTable>;

/**
 * One email in a conversation, in or out. An outgoing message is written here as `queued` in the
 * same transaction as the action that sent it; the worker does the sending and records how it went.
 */
export const messagesTable = defineTable(
  'messages',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    conversationId: column.text().notNull(),
    direction: column.text().notNull(),
    fromName: column.text().notNull(),
    fromEmail: column.text().notNull(),
    toEmail: column.text().notNull().default(''),
    subject: column.text().notNull().default(''),
    body: column.text().notNull(),
    /** In: `received`. Out: `queued`, `sending`, `sent` or `failed`. */
    status: column.text().notNull(),
    /** The Message-ID header, so a reply can be matched to its thread. */
    messageIdHeader: column.text(),
    /** The provider's id once it has accepted the message. */
    providerId: column.text(),
    /** Who sent it, to tell when it fails. */
    senderId: column.text(),
    attempts: column.integer().notNull().default(0),
    lastError: column.text(),
    /** When a queued message may next be tried. */
    nextAttemptAt: column.timestamp().notNull().defaultNow(),
    sentAt: column.timestamp().notNull().defaultNow(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('messages_conversation_idx').on('tenantId', 'conversationId', 'sentAt'), index('messages_header_idx').on('tenantId', 'messageIdHeader'), index('messages_outgoing_idx').on('tenantId', 'status', 'nextAttemptAt')] },
);
export type MessageRow = InferEntity<typeof messagesTable>;

export const emailTemplatesTable = defineTable('email_templates', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  name: column.text().notNull(),
  subject: column.text().notNull().default(''),
  body: column.text().notNull().default(''),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type EmailTemplateRow = InferEntity<typeof emailTemplatesTable>;

/** How far the sweep has read each provider's own record of what arrived. It only moves forward after what it read is stored. */
export const mailCursorsTable = defineTable('mail_cursors', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  position: column.text(),
  sweptAt: column.timestamp().notNull().defaultNow(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type MailCursorRow = InferEntity<typeof mailCursorsTable>;

/**
 * The development email provider's own store: the mail it "delivered" and the mail it "received".
 * It stands in for a real provider so sending, replaying and failures can be tried locally.
 */
export const devMailTable = defineTable('dev_mail', {
  id: column.text().primaryKey(),
  /** `out` for mail the CRM sent; `in` for mail waiting at the provider. */
  direction: column.text().notNull(),
  payload: column.json().$type<Record<string, unknown>>().notNull(),
  /** Order of arrival, which is what a position in the provider's record means. */
  sequence: column.bigint().notNull(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
