import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { Conversation, ConversationDetail, ConversationList, ConversationQuery, EmailHealth, EmailReport, EmailTemplate, InboxCounts, Message, UpdateConversation } from '../../../../src/contracts/inbox';
import type { Reference } from '../../../../src/contracts/records';
import type { ConversationRow, MessageRow } from '../../schema';
import type { ActivityRepository } from '../activity/activity.repository';
import { actorOf, assertAllowed } from '../people/access';
import type { PeopleService } from '../people/people.service';
import type { RecordsRepository } from '../records/records.repository';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { EmailDesign } from '../../../../src/contracts/emailDesign';
import type { SaveEmailTemplate } from '../../../../src/contracts/sequences';
import { renderEmailText } from '../../../../src/lib/emailDesign';
import type { EmailTemplateRow } from '../../schema';
import type { ConversationsRepository, EmailTemplatesRepository, InboundEmailsRepository, MailCursorsRepository, MessagesRepository } from './inbox.repository';
import type { MailService } from './mail.service';

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

function toConversation(row: ConversationRow): Conversation {
  return { id: row.id, subject: row.subject, status: row.status as Conversation['status'], assigneeId: row.assigneeId, contactId: row.contactId, companyId: row.companyId, dealId: row.dealId, unread: row.unread, lastMessageAt: row.lastMessageAt.toISOString(), preview: row.preview, messageCount: row.messageCount };
}

function toMessage(row: MessageRow): Message {
  const outgoing = row.direction === 'out';
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: outgoing ? 'out' : 'in',
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    body: row.body,
    ...(row.html ? { html: row.html } : {}),
    ...(row.attachments && row.attachments.length > 0 ? { attachments: row.attachments } : {}),
    sentAt: row.sentAt.toISOString(),
    // "Being sent right now" is still waiting as far as a person is concerned.
    ...(outgoing ? { status: row.status === 'sent' ? 'sent' : row.status === 'failed' ? 'failed' : 'queued' } : {}),
    ...(outgoing && row.status !== 'sent' && row.lastError ? { problem: row.lastError } : {}),
    ...(outgoing && (row.delivery === 'delivered' || row.delivery === 'bounced' || row.delivery === 'complained') ? { delivery: row.delivery, ...(row.deliveryDetail ? { deliveryNote: row.deliveryDetail } : {}) } : {}),
    // Never tried and not yet due: it is waiting for the time its sender chose.
    ...(outgoing && row.status === 'queued' && row.attempts === 0 && row.nextAttemptAt.getTime() > Date.now() ? { scheduledFor: row.nextAttemptAt.toISOString() } : {}),
  };
}

function toTemplate(row: EmailTemplateRow): EmailTemplate {
  return { id: row.id, name: row.name, subject: row.subject, body: row.body, ...(row.design ? { design: row.design } : {}) };
}

/** The shared inbox: conversations, replies and the team's saved emails. */
export class InboxService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly templates: EmailTemplatesRepository,
    private readonly inbound: InboundEmailsRepository,
    private readonly cursors: MailCursorsRepository,
    private readonly mail: MailService,
    private readonly records: RecordsRepository,
    private readonly activities: ActivityRepository,
    private readonly people: PeopleService,
    private readonly workspace: WorkspaceService,
    private readonly transaction: <T>(ctx: Context, fn: () => Promise<T>) => Promise<T>,
  ) {}

  /** Announces, inside the transaction, that a conversation changed. */
  changed?: (ctx: Context, conversationId: string) => Promise<void>;

  /** Says which sequence uses a template, if one does. */
  templateUsedBy?: (ctx: Context, templateId: string) => Promise<string | undefined>;

  /** Names for the contacts, companies and deals conversations point at. */
  private async references(ctx: Context, rows: ConversationRow[]): Promise<Record<string, Reference>> {
    const ids = [...new Set(rows.flatMap((row) => [row.contactId, row.companyId, row.dealId]).filter((value): value is string => Boolean(value)))];
    const objects = await this.workspace.definitions(ctx);
    const result: Record<string, Reference> = {};
    for (const record of await this.records.byIds(ctx, ids)) {
      const primary = objects.find((object) => object.id === record.objectId)?.primaryProperty;
      const label = primary ? record.properties[primary] : undefined;
      result[record.id] = { objectId: record.objectId, label: typeof label === 'string' ? label : record.id };
    }
    return result;
  }

  private async find(ctx: Context, conversationId: string): Promise<ConversationRow> {
    const row = await this.conversations.findById(ctx, conversationId);
    if (!row) throw new NotFoundError('conversation', conversationId);
    return row;
  }

  async list(ctx: Context, query: ConversationQuery): Promise<ConversationList> {
    const page = await this.conversations.page(ctx, { folder: query.folder, search: query.search, limit: query.pageSize, offset: (query.page - 1) * query.pageSize });
    const found = page.ids.length > 0 ? await this.conversations.findMany(ctx, [{ field: 'id', op: 'in', value: page.ids }], { limit: page.ids.length }) : [];
    const rows = page.ids.map((conversationId) => found.find((row) => row.id === conversationId)).filter((row): row is ConversationRow => row !== undefined);
    return { conversations: rows.map(toConversation), total: page.total, references: await this.references(ctx, rows) };
  }

  async get(ctx: Context, conversationId: string): Promise<ConversationDetail> {
    const row = await this.find(ctx, conversationId);
    const messages = await this.messages.findMany(ctx, { conversationId }, { sort: { field: 'sentAt', direction: 'asc' }, limit: 500 });
    return { conversation: toConversation(row), messages: messages.map(toMessage), references: await this.references(ctx, [row]) };
  }

  async update(ctx: Context, input: UpdateConversation): Promise<Conversation> {
    await this.find(ctx, input.id);
    const { id: conversationId, ...changes } = input;
    return this.transaction(ctx, async () => {
      const updated = await this.conversations.update(ctx, conversationId, changes);
      await this.changed?.(ctx, conversationId);
      return toConversation(updated);
    });
  }

  /** Sends a reply on the thread. It is stored as queued here; the worker sends it. */
  async reply(ctx: Context, input: { conversationId: string; body: string; sendAt?: string; attachmentIds?: string[] }): Promise<Message> {
    const body = input.body.trim();
    if (!body) throw new ValidationError('Write something before sending.');
    const sendAt = input.sendAt ? new Date(input.sendAt) : undefined;
    if (sendAt && !(sendAt.getTime() > Date.now())) throw new ValidationError('Choose a time in the future to send it later.');
    if (sendAt && sendAt.getTime() > Date.now() + 366 * 86_400_000) throw new ValidationError('A reply can be held for up to a year.');
    const conversation = await this.find(ctx, input.conversationId);
    const me = (await this.people.users(ctx)).find((user) => user.id === ctx.userId);
    if (!me) throw new ValidationError('You need to be an active member to send email.');
    const contact = await this.records.one(ctx, conversation.contactId);
    const toEmail = typeof contact?.properties.email === 'string' ? contact.properties.email : '';
    if (!toEmail) throw new ValidationError('This contact has no email address.');
    const messageId = await this.transaction(ctx, async () => {
      const queued = await this.mail.queue(ctx, { conversationId: conversation.id, sender: me, toEmail, subject: /^re:/i.test(conversation.subject) ? conversation.subject : `Re: ${conversation.subject}`, body, sendAt, attachmentIds: input.attachmentIds });
      // Replying to something in the shared queue takes it.
      if (conversation.assigneeId === null) await this.conversations.update(ctx, conversation.id, { assigneeId: me.id });
      for (const recordId of [conversation.contactId, conversation.dealId]) {
        if (recordId) await this.activities.create(ctx, { id: id('act'), recordId, kind: 'email', title: `${sendAt ? 'Email scheduled' : 'Email sent'}: ${conversation.subject}`, body, actorId: me.id });
      }
      return queued;
    });
    return toMessage(await this.messages.getById(ctx, messageId));
  }

  /** Takes back a reply that is waiting for its time. */
  async cancelScheduled(ctx: Context, messageId: string): Promise<void> {
    const message = await this.messages.findById(ctx, messageId);
    if (!message) throw new NotFoundError('message', messageId);
    await this.find(ctx, message.conversationId);
    await this.transaction(ctx, async () => {
      const conversationId = await this.messages.cancelScheduled(ctx, messageId);
      if (!conversationId) throw new ConflictError('That email has already been sent, or is being sent now.');
      await this.conversations.refresh(ctx, conversationId, {});
      await this.changed?.(ctx, conversationId);
    });
  }

  counts(ctx: Context): Promise<InboxCounts> {
    return this.conversations.counts(ctx);
  }

  async health(ctx: Context): Promise<EmailHealth> {
    const [numbers, cursors] = await Promise.all([this.inbound.health(ctx), this.cursors.findMany(ctx, {}, { sort: { field: 'sweptAt', direction: 'desc' }, limit: 1 })]);
    return { ...numbers, lastSweepAt: cursors[0]?.sweptAt.toISOString() ?? null };
  }

  report(ctx: Context): Promise<EmailReport> {
    return this.messages.report(ctx, 30);
  }

  async listTemplates(ctx: Context): Promise<EmailTemplate[]> {
    const rows = await this.templates.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 });
    return rows.map(toTemplate);
  }

  async saveTemplate(ctx: Context, input: SaveEmailTemplate): Promise<EmailTemplate> {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Give the email a name.');
    const existing = input.id ? await this.templates.findById(ctx, input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('template', input.id);
    // Leaving `design` out keeps what is there; null makes it a plain email again.
    const design = input.design === undefined ? (existing?.design ?? null) : input.design;
    if (design && design.blocks.length === 0) throw new ValidationError('Add something to the email before saving it.');
    // A designed email keeps its words as plain text too: for the inbox, for search, and for mail apps that will not show HTML.
    const values = { name, subject: input.subject, body: design && input.design ? renderEmailText(design) : input.body, design };
    return toTemplate(existing ? await this.templates.update(ctx, existing.id, values) : await this.templates.create(ctx, { id: id('tpl'), ...values }));
  }

  /** Sends the email to the person asking, so they can see it in their own mail app. */
  async sendTest(ctx: Context, input: { subject: string; body: string; design?: EmailDesign }): Promise<{ to: string }> {
    const me = (await this.people.users(ctx)).find((user) => user.id === ctx.userId);
    if (!me?.email) throw new ValidationError('You need to be an active member with an email address to send a test.');
    await this.mail.sendTest(ctx, me, input);
    return { to: me.email };
  }

  async deleteTemplate(ctx: Context, templateId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'delete templates');
    const used = await this.templateUsedBy?.(ctx, templateId);
    if (used) throw new ConflictError(`"${used}" uses this template. Change that step first.`);
    await this.templates.deleteWhere(ctx, { id: templateId });
  }
}
