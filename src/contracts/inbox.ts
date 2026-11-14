import { z } from 'zod';
import { referenceSchema } from './records';

/**
 * Inbox contracts. A conversation is one email thread with a contact. It can be assigned to a
 * person, linked to a deal, and closed when it needs nothing more. The mock fills these with
 * generated email; Gmail and Outlook sync will fill the same shapes.
 */

export const conversationSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(['open', 'closed']),
  /** Nobody yet when null: it sits in the shared queue. */
  assigneeId: z.string().nullable(),
  contactId: z.string(),
  companyId: z.string().nullable(),
  dealId: z.string().nullable(),
  /** The latest message came from the contact and nobody has opened it. */
  unread: z.boolean(),
  lastMessageAt: z.string(),
  /** The start of the latest message, for the list. */
  preview: z.string(),
  messageCount: z.number().int(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  /** `in` from the contact, `out` from someone on the team. */
  direction: z.enum(['in', 'out']),
  fromName: z.string(),
  fromEmail: z.string(),
  body: z.string(),
  sentAt: z.string(),
  /** Where an outgoing message has got to. Absent on incoming ones. `queued` is waiting to go or being retried. */
  status: z.enum(['queued', 'sent', 'failed']).optional(),
  /** Why it failed, in words, when it did. */
  problem: z.string().optional(),
});
export type Message = z.infer<typeof messageSchema>;

export const inboxFolderSchema = z.enum(['mine', 'unassigned', 'open', 'closed']);
export type InboxFolder = z.infer<typeof inboxFolderSchema>;

export const conversationQuerySchema = z.object({
  folder: inboxFolderSchema,
  search: z.string().optional(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});
export type ConversationQuery = z.infer<typeof conversationQuerySchema>;

export const conversationListSchema = z.object({
  conversations: z.array(conversationSchema),
  total: z.number().int(),
  /** Names for the contacts, companies and deals the conversations point at. */
  references: z.record(referenceSchema),
});
export type ConversationList = z.infer<typeof conversationListSchema>;

export const conversationDetailSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(messageSchema),
  references: z.record(referenceSchema),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const updateConversationSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'closed']).optional(),
  assigneeId: z.string().nullable().optional(),
  unread: z.boolean().optional(),
});
export type UpdateConversation = z.infer<typeof updateConversationSchema>;

export const emailTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  /** May contain `{{firstName}}` and `{{myName}}`, filled in when the template is used. */
  body: z.string(),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

export const inboxCountsSchema = z.object({ mineUnread: z.number().int(), mine: z.number().int(), unassigned: z.number().int(), open: z.number().int() });
export type InboxCounts = z.infer<typeof inboxCountsSchema>;

/** Whether email is flowing. Each number is a gap that should be zero or small; an admin can watch them. */
export const emailHealthSchema = z.object({
  /** Outgoing messages waiting to be sent, and how long the oldest has waited. */
  queued: z.number().int(),
  oldestQueuedSeconds: z.number().int().nullable(),
  /** Outgoing messages that could not be sent. They are kept, marked failed, and their senders were told. */
  failedOutgoing: z.number().int(),
  /** Incoming messages stored but not yet filed into a conversation. */
  waitingIncoming: z.number().int(),
  /** Incoming messages that could not be filed after several tries. They are kept. */
  failedIncoming: z.number().int(),
  /** When the sweep last checked the email service for anything missed. Null if it never has. */
  lastSweepAt: z.string().nullable(),
});
export type EmailHealth = z.infer<typeof emailHealthSchema>;

export interface InboxApi {
  listConversations(query: ConversationQuery): Promise<ConversationList>;
  getConversation(id: string): Promise<ConversationDetail>;
  updateConversation(input: UpdateConversation): Promise<Conversation>;
  /** Sends a reply on the thread, and logs it on the contact and the deal. */
  sendReply(input: { conversationId: string; body: string }): Promise<Message>;
  listEmailTemplates(): Promise<EmailTemplate[]>;
  inboxCounts(): Promise<InboxCounts>;
  getEmailHealth(): Promise<EmailHealth>;
}
