import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { Conversation, ConversationDetail, ConversationList, ConversationQuery, EmailHealth, EmailTemplate, InboxCounts, Message, UpdateConversation } from '../../../../src/contracts/inbox';
import type { Reference } from '../../../../src/contracts/records';
import type { ConversationRow, MessageRow } from '../../schema';
import type { ActivityRepository } from '../activity/activity.repository';
import { actorOf, assertAllowed } from '../people/access';
import type { PeopleService } from '../people/people.service';
import type { RecordsRepository } from '../records/records.repository';
import type { WorkspaceService } from '../workspace/workspace.service';
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
    sentAt: row.sentAt.toISOString(),
    // "Being sent right now" is still waiting as far as a person is concerned.
    ...(outgoing ? { status: row.status === 'sent' ? 'sent' : row.status === 'failed' ? 'failed' : 'queued' } : {}),
    ...(outgoing && row.status !== 'sent' && row.lastError ? { problem: row.lastError } : {}),
  };
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
  async reply(ctx: Context, input: { conversationId: string; body: string }): Promise<Message> {
    const body = input.body.trim();
    if (!body) throw new ValidationError('Write something before sending.');
    const conversation = await this.find(ctx, input.conversationId);
    const me = (await this.people.users(ctx)).find((user) => user.id === ctx.userId);
    if (!me) throw new ValidationError('You need to be an active member to send email.');
    const contact = await this.records.one(ctx, conversation.contactId);
    const toEmail = typeof contact?.properties.email === 'string' ? contact.properties.email : '';
    if (!toEmail) throw new ValidationError('This contact has no email address.');
    const messageId = await this.transaction(ctx, async () => {
      const queued = await this.mail.queue(ctx, { conversationId: conversation.id, sender: me, toEmail, subject: /^re:/i.test(conversation.subject) ? conversation.subject : `Re: ${conversation.subject}`, body });
      // Replying to something in the shared queue takes it.
      if (conversation.assigneeId === null) await this.conversations.update(ctx, conversation.id, { assigneeId: me.id });
      for (const recordId of [conversation.contactId, conversation.dealId]) {
        if (recordId) await this.activities.create(ctx, { id: id('act'), recordId, kind: 'email', title: `Email sent: ${conversation.subject}`, body, actorId: me.id });
      }
      return queued;
    });
    return toMessage(await this.messages.getById(ctx, messageId));
  }

  counts(ctx: Context): Promise<InboxCounts> {
    return this.conversations.counts(ctx);
  }

  async health(ctx: Context): Promise<EmailHealth> {
    const [numbers, cursors] = await Promise.all([this.inbound.health(ctx), this.cursors.findMany(ctx, {}, { sort: { field: 'sweptAt', direction: 'desc' }, limit: 1 })]);
    return { ...numbers, lastSweepAt: cursors[0]?.sweptAt.toISOString() ?? null };
  }

  async listTemplates(ctx: Context): Promise<EmailTemplate[]> {
    const rows = await this.templates.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 });
    return rows.map((row) => ({ id: row.id, name: row.name, subject: row.subject, body: row.body }));
  }

  async saveTemplate(ctx: Context, input: { id?: string; name: string; subject: string; body: string }): Promise<EmailTemplate> {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Give the template a name.');
    if (input.id && !(await this.templates.findById(ctx, input.id))) throw new NotFoundError('template', input.id);
    const row = input.id ? await this.templates.update(ctx, input.id, { name, subject: input.subject, body: input.body }) : await this.templates.create(ctx, { id: id('tpl'), name, subject: input.subject, body: input.body });
    return { id: row.id, name: row.name, subject: row.subject, body: row.body };
  }

  async deleteTemplate(ctx: Context, templateId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'delete templates');
    const used = await this.templateUsedBy?.(ctx, templateId);
    if (used) throw new ConflictError(`"${used}" uses this template. Change that step first.`);
    await this.templates.deleteWhere(ctx, { id: templateId });
  }
}
