import { z } from 'zod';
import { emailDesignSchema } from './emailDesign';
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
  /** The designed version, when the message has one. `body` is always there as plain text. */
  html: z.string().optional(),
  sentAt: z.string(),
  /** Where an outgoing message has got to. Absent on incoming ones. `queued` is waiting to go or being retried. */
  status: z.enum(['queued', 'sent', 'failed']).optional(),
  /** Why it failed, in words, when it did. */
  problem: z.string().optional(),
  /** Set while an outgoing message is waiting for a time its sender chose. Until then it can be cancelled. */
  scheduledFor: z.string().optional(),
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
  /** How it looks, when it was made in the designer. Absent on a plain email. `body` is then the same words as plain text. */
  design: emailDesignSchema.optional(),
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

/**
 * Whether an address may be emailed. Kept by address, not by contact, so it survives a contact being
 * merged or deleted and re-imported.
 *
 * - `subscribed`: anything may be sent.
 * - `unsubscribed`: no automated email (sequences, workflows). A person may still reply to them one to one.
 * - `blocked`: nothing at all. Set when an address bounces or complains, or by hand.
 */
export const emailStatusSchema = z.enum(['subscribed', 'unsubscribed', 'blocked']);
export type EmailStatus = z.infer<typeof emailStatusSchema>;

export const emailPreferenceSchema = z.object({
  email: z.string(),
  status: emailStatusSchema,
  /** Who changed it last: the recipient themselves, a member of the team, or the email service reporting a bounce. */
  source: z.enum(['recipient', 'member', 'bounce', 'none']),
  reason: z.string().nullable(),
  changedAt: z.string().nullable(),
  /** When this person agreed to be emailed, and what they agreed to, if a form recorded it. */
  consent: z.object({ text: z.string(), source: z.string(), at: z.string() }).nullable(),
  /** Automated emails sent to them in the last seven days, against the limit. */
  sentThisWeek: z.number().int(),
  weeklyLimit: z.number().int(),
});
export type EmailPreference = z.infer<typeof emailPreferenceSchema>;

export const setEmailPreferenceSchema = z.object({ email: z.string(), status: emailStatusSchema, reason: z.string().optional() });

export const emailSettingsSchema = z.object({
  /** The most automated emails one address is sent in seven days. Replies written by a person do not count. */
  weeklyLimit: z.number().int().min(1).max(50),
  /** Your organization's postal address, put at the foot of automated email. Many countries require it. */
  postalAddress: z.string(),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

/** What the unsubscribe page shows the person who followed the link. */
export const unsubscribePageSchema = z.object({ email: z.string(), status: emailStatusSchema, organization: z.string() });

export interface InboxApi {
  listConversations(query: ConversationQuery): Promise<ConversationList>;
  getConversation(id: string): Promise<ConversationDetail>;
  updateConversation(input: UpdateConversation): Promise<Conversation>;
  /** Sends a reply on the thread, and logs it on the contact and the deal. */
  /** With `sendAt`, the reply is kept and sent at that time instead of now. */
  sendReply(input: { conversationId: string; body: string; sendAt?: string }): Promise<Message>;
  /** Takes back a reply that is waiting for its time. Refused once it has gone or is going. */
  cancelScheduledReply(messageId: string): Promise<void>;
  listEmailTemplates(): Promise<EmailTemplate[]>;
  inboxCounts(): Promise<InboxCounts>;
  getEmailHealth(): Promise<EmailHealth>;
  getEmailPreference(email: string): Promise<EmailPreference>;
  /** Stops or resumes email to an address. Resuming needs a reason, and only an admin may undo a choice the recipient made. */
  setEmailPreference(input: z.infer<typeof setEmailPreferenceSchema>): Promise<EmailPreference>;
  getEmailSettings(): Promise<EmailSettings>;
  saveEmailSettings(input: EmailSettings): Promise<EmailSettings>;
  /** What the public unsubscribe page loads, from the link in an email. */
  getUnsubscribePage(token: string): Promise<z.infer<typeof unsubscribePageSchema>>;
  /** What the public unsubscribe page calls. `resubscribe` undoes it, for someone who clicked by mistake. */
  unsubscribe(input: { token: string; resubscribe?: boolean }): Promise<z.infer<typeof unsubscribePageSchema>>;
}
