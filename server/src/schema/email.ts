import { column, defineTable, index, type InferEntity } from '@mariachi/database';
import type { EmailDesign } from '../../../src/contracts/emailDesign';
import type { FileInfo } from '../../../src/contracts/files';

/** What an email provider hands over, in one shape whichever provider it is. */
export type InboundPayload = {
  fromEmail: string;
  fromName?: string;
  toEmail?: string;
  subject: string;
  text: string;
  /** Files that came with it, base64 encoded. They are moved to the file store when the email is filed. */
  attachments?: Array<{ name: string; contentType: string; content: string }>;
  /** The HTML version, when the email had one. Shown in a sandbox, never trusted. */
  html?: string;
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
    /** The designed version, when there is one. `body` is always the plain text. */
    html: column.text(),
    /** The files sent with it. The bytes are in the file store. */
    attachments: column.json().$type<FileInfo[]>().notNull().defaultSql("'[]'::jsonb"),
    /** In: `received`. Out: `queued`, `sending`, `sent` or `failed`. */
    status: column.text().notNull(),
    /** The Message-ID header, so a reply can be matched to its thread. */
    messageIdHeader: column.text(),
    /** The provider's id once it has accepted the message. */
    providerId: column.text(),
    /** `conversation` for something a person wrote to one contact; `automated` for a sequence step or a workflow's email. Only automated email obeys unsubscribes and the weekly limit, and carries an unsubscribe link. */
    purpose: column.text().notNull().default('conversation'),
    /** Who sent it, to tell when it fails. */
    senderId: column.text(),
    attempts: column.integer().notNull().default(0),
    lastError: column.text(),
    /** What the email service said became of it after accepting it: `delivered`, `bounced` or `complained`. Null until it says. */
    delivery: column.text(),
    deliveryDetail: column.text(),
    deliveredAt: column.timestamp(),
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
  /** The design, when it was made in the designer. `body` is then its plain text. */
  design: column.json().$type<EmailDesign>(),
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

/** Whether an address may be emailed. Kept by address so it outlives the contact. */
export const emailPreferencesTable = defineTable(
  'email_preferences',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    /** Lower case. */
    email: column.text().notNull(),
    status: column.text().notNull(),
    source: column.text().notNull(),
    reason: column.text(),
    changedBy: column.text(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('email_preferences_email_idx').on('tenantId', 'email').unique()] },
);
export type EmailPreferenceRow = InferEntity<typeof emailPreferencesTable>;

/** That someone agreed to be emailed: the words they agreed to, where, and when. Never changed afterwards. */
export const consentsTable = defineTable(
  'consents',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    email: column.text().notNull(),
    text: column.text().notNull(),
    /** Where it was given, such as the form's name. */
    source: column.text().notNull(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('consents_email_idx').on('tenantId', 'email', 'createdAt')] },
);
export type ConsentRow = InferEntity<typeof consentsTable>;

/** The rules for automated email. One row. */
export const emailSettingsTable = defineTable('email_settings', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  weeklyLimit: column.integer().notNull().default(3),
  postalAddress: column.text().notNull().default(''),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type EmailSettingsRow = InferEntity<typeof emailSettingsTable>;
