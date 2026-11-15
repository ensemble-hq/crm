import type { Context } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type SQL, and, sql } from 'drizzle-orm';
import type { EmailHealth, EmailReport, InboxFolder } from '../../../../src/contracts/inbox';
import { type ConversationRow, type EmailTemplateRow, type InboundEmailRow, type InboundPayload, type MailCursorRow, type MessageRow, conversationsTable, emailTemplatesTable, inboundEmailsTable, mailCursorsTable, messagesTable } from '../../schema';

const like = (needle: string) => `%${needle.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

export class ConversationsRepository extends DrizzleRepository<ConversationRow> {
  constructor(db: DrizzleDb) {
    super(conversationsTable, db);
  }

  private folder(folder: InboxFolder, userId: string | null): SQL {
    switch (folder) {
      case 'mine':
        return sql`conversations.status = 'open' and conversations.assignee_id = ${userId ?? ''}`;
      case 'unassigned':
        return sql`conversations.status = 'open' and conversations.assignee_id is null`;
      case 'open':
        return sql`conversations.status = 'open'`;
      case 'closed':
        return sql`conversations.status = 'closed'`;
    }
  }

  /** One folder's conversation ids, newest first, with the total. Search covers the subject, the latest message and the contact's name. */
  async page(ctx: Context, query: { folder: InboxFolder; search?: string; limit: number; offset: number }): Promise<{ ids: string[]; total: number }> {
    const needle = query.search?.trim();
    const matches = needle
      ? sql`(conversations.subject ilike ${like(needle)} or conversations.preview ilike ${like(needle)} or exists (select 1 from records contact where contact.id = conversations.contact_id and contact.tenant_id = conversations.tenant_id and contact.properties->>'name' ilike ${like(needle)}))`
      : sql`true`;
    const where = and(this.buildWhere(ctx), this.folder(query.folder, ctx.userId), matches);
    const rows = (await this.db.execute(sql`select conversations.id, count(*) over ()::int as total from conversations where ${where} order by conversations.last_message_at desc, conversations.id limit ${query.limit} offset ${query.offset}`)) as unknown as Array<{ id: string; total: number }>;
    if (rows.length > 0) return { ids: rows.map((row) => row.id), total: rows[0]?.total ?? 0 };
    const [count] = (await this.db.execute(sql`select count(*)::int as total from conversations where ${where}`)) as unknown as Array<{ total: number }>;
    return { ids: [], total: count?.total ?? 0 };
  }

  async counts(ctx: Context): Promise<{ mineUnread: number; mine: number; unassigned: number; open: number }> {
    const me = ctx.userId ?? '';
    const [row] = (await this.db.execute(sql`
      select count(*) filter (where assignee_id = ${me} and unread)::int as "mineUnread", count(*) filter (where assignee_id = ${me})::int as mine,
             count(*) filter (where assignee_id is null)::int as unassigned, count(*)::int as open
      from conversations where ${and(this.buildWhere(ctx), sql`conversations.status = 'open'`)}`)) as unknown as Array<{ mineUnread: number; mine: number; unassigned: number; open: number }>;
    return row ?? { mineUnread: 0, mine: 0, unassigned: 0, open: 0 };
  }

  /** Brings the conversation's summary in line with its messages. Called in the same transaction as any change to them. */
  async refresh(ctx: Context, id: string, changes: { unread?: boolean; reopen?: boolean }): Promise<void> {
    await this.db.execute(sql`
      update conversations set
        message_count = (select count(*) from messages where messages.conversation_id = conversations.id),
        last_message_at = coalesce((select max(sent_at) from messages where messages.conversation_id = conversations.id), conversations.last_message_at),
        preview = coalesce((select left(regexp_replace(body, '\\s+', ' ', 'g'), 120) from messages where messages.conversation_id = conversations.id order by sent_at desc, id desc limit 1), ''),
        unread = ${changes.unread ?? sql`conversations.unread`},
        status = ${changes.reopen ? sql`'open'` : sql`conversations.status`},
        updated_at = now()
      where ${and(this.buildWhere(ctx), sql`conversations.id = ${id}`)}`);
  }

  /** The newest open conversation with a contact on a subject, ignoring "Re:" and "Fwd:". */
  async bySubject(ctx: Context, contactId: string, subject: string): Promise<string | undefined> {
    const [row] = (await this.db.execute(
      sql`select id from conversations where ${and(this.buildWhere(ctx), sql`conversations.contact_id = ${contactId}`, sql`conversations.status = 'open'`, sql`lower(regexp_replace(conversations.subject, '^((re|fwd?):\\s*)+', '', 'i')) = ${subject.toLowerCase()}`)} order by last_message_at desc limit 1`,
    )) as unknown as Array<{ id: string }>;
    return row?.id;
  }
}

export class MessagesRepository extends DrizzleRepository<MessageRow> {
  constructor(db: DrizzleDb) {
    super(messagesTable, db);
  }

  /** The conversation a message belongs to, found by the Message-IDs it answers. */
  async conversationOf(ctx: Context, headers: string[]): Promise<string | undefined> {
    if (headers.length === 0) return undefined;
    const list = sql.join(headers.map((header) => sql`${header}`), sql`, `);
    const [row] = (await this.db.execute(sql`select conversation_id from messages where ${and(this.buildWhere(ctx), sql`messages.message_id_header in (${list})`)} order by sent_at desc limit 1`)) as unknown as Array<{ conversation_id: string }>;
    return row?.conversation_id;
  }

  /** Adds an incoming message unless it is already there. True if it was added. */
  async addIncoming(ctx: Context, message: { id: string; conversationId: string; fromName: string; fromEmail: string; toEmail: string; subject: string; body: string; html: string | null; messageIdHeader: string | null; sentAt: Date }): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      insert into messages (id, tenant_id, conversation_id, direction, from_name, from_email, to_email, subject, body, html, status, message_id_header, sent_at)
      values (${message.id}, ${ctx.tenantId}, ${message.conversationId}, 'in', ${message.fromName}, ${message.fromEmail}, ${message.toEmail}, ${message.subject}, ${message.body}, ${message.html}, 'received', ${message.messageIdHeader}, ${message.sentAt.toISOString()}::timestamptz)
      on conflict (id) do nothing returning id`)) as unknown as unknown[];
    return rows.length > 0;
  }

  /** An outgoing message by the id the email service gave it, or by its Message-ID header. */
  async sentAs(ctx: Context, providerId: string | undefined, header: string | undefined): Promise<MessageRow | undefined> {
    if (providerId) {
      const [found] = await this.findMany(ctx, { providerId, direction: 'out' }, { limit: 1 });
      if (found) return found;
    }
    return header ? (await this.findMany(ctx, { messageIdHeader: header, direction: 'out' }, { limit: 1 }))[0] : undefined;
  }

  /** What became of the email sent in the last `days` days. */
  async report(ctx: Context, days: number): Promise<EmailReport> {
    const since = sql`now() - make_interval(days => ${days})`;
    const mine = sql`tenant_id = ${ctx.tenantId} and direction = 'out' and sent_at >= ${since}`;
    const [totals] = (await this.db.execute(sql`
      select
        count(*) filter (where status = 'sent')::int as sent,
        count(*) filter (where delivery = 'delivered')::int as delivered,
        count(*) filter (where delivery = 'bounced')::int as bounced,
        count(*) filter (where delivery = 'complained')::int as complained,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'sent' and purpose = 'automated')::int as "autoSent",
        count(*) filter (where delivery = 'delivered' and purpose = 'automated')::int as "autoDelivered",
        count(*) filter (where delivery = 'bounced' and purpose = 'automated')::int as "autoBounced",
        count(*) filter (where delivery = 'complained' and purpose = 'automated')::int as "autoComplained"
      from messages where ${mine}`)) as unknown as Array<Record<string, number>>;
    const daily = (await this.db.execute(sql`
      select to_char(date_trunc('day', sent_at), 'YYYY-MM-DD') as date, count(*) filter (where status = 'sent')::int as sent, count(*) filter (where status = 'failed' or delivery in ('bounced', 'complained'))::int as problems
      from messages where ${mine} group by 1 order by 1`)) as unknown as Array<{ date: string; sent: number; problems: number }>;
    const problems = (await this.db.execute(sql`
      select id as "messageId", conversation_id as "conversationId", to_email as "toEmail", subject,
             case when status = 'failed' then 'failed' else delivery end as kind,
             coalesce(case when status = 'failed' then last_error else delivery_detail end, '') as reason,
             to_char(coalesce(delivered_at, updated_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from messages where ${mine} and (status = 'failed' or delivery in ('bounced', 'complained'))
      order by coalesce(delivered_at, updated_at) desc limit 50`)) as unknown as EmailReport['problems'];
    const n = (key: string) => totals?.[key] ?? 0;
    return {
      from: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10),
      sent: n('sent'), delivered: n('delivered'), bounced: n('bounced'), complained: n('complained'), failed: n('failed'),
      automated: { sent: n('autoSent'), delivered: n('autoDelivered'), bounced: n('autoBounced'), complained: n('autoComplained') },
      days: daily,
      problems,
    };
  }

  /**
   * Takes a queued message for sending, if it is due and nobody else has it. Two workers asking at
   * once get it once, which is what stops a message going out twice.
   */
  async claim(ctx: Context, id: string): Promise<MessageRow | undefined> {
    const rows = (await this.db.execute(
      sql`update messages set status = 'sending', attempts = attempts + 1, updated_at = now() where ${and(this.buildWhere(ctx), sql`messages.id = ${id}`, sql`messages.status = 'queued'`, sql`messages.next_attempt_at <= now()`)} returning id`,
    )) as unknown as unknown[];
    return rows.length > 0 ? ((await this.findById(ctx, id)) ?? undefined) : undefined;
  }

  /** Queued messages that are due, oldest first. */
  /** Removes a message that is waiting for a time its sender chose, if it is still waiting. Says which conversation it was in, or nothing if it was too late. */
  async cancelScheduled(ctx: Context, id: string): Promise<string | undefined> {
    const rows = (await this.db.execute(
      sql`delete from messages where ${and(this.buildWhere(ctx), sql`messages.id = ${id}`, sql`messages.direction = 'out'`, sql`messages.status = 'queued'`, sql`messages.attempts = 0`, sql`messages.next_attempt_at > now()`)} returning conversation_id`,
    )) as unknown as Array<{ conversation_id: string }>;
    return rows[0]?.conversation_id;
  }

  async due(ctx: Context, limit: number): Promise<string[]> {
    const rows = (await this.db.execute(sql`select id from messages where ${and(this.buildWhere(ctx), sql`messages.status = 'queued'`, sql`messages.next_attempt_at <= now()`)} order by next_attempt_at limit ${limit}`)) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** Puts back messages a worker took and never finished, such as when it was stopped mid-send. The idempotency key makes sending them again safe. */
  async releaseStuck(ctx: Context, olderThanSeconds: number): Promise<number> {
    const rows = (await this.db.execute(
      sql`update messages set status = 'queued', next_attempt_at = now(), updated_at = now() where ${and(this.buildWhere(ctx), sql`messages.status = 'sending'`, sql`messages.updated_at < now() - make_interval(secs => ${olderThanSeconds})`)} returning id`,
    )) as unknown as unknown[];
    return rows.length;
  }
}

export class InboundEmailsRepository extends DrizzleRepository<InboundEmailRow> {
  constructor(db: DrizzleDb) {
    super(inboundEmailsTable, db);
  }

  /** Stores an arrival unless this provider message is already stored. Returns the new row's id, or nothing for a repeat. */
  async store(ctx: Context, id: string, provider: string, providerMessageId: string, payload: InboundPayload): Promise<string | undefined> {
    const rows = (await this.db.execute(sql`
      insert into inbound_emails (id, tenant_id, provider, provider_message_id, payload)
      values (${id}, ${ctx.tenantId}, ${provider}, ${providerMessageId}, ${JSON.stringify(payload)}::jsonb)
      on conflict (tenant_id, provider, provider_message_id) do nothing returning id`)) as unknown as Array<{ id: string }>;
    return rows[0]?.id;
  }

  /** Arrivals that were stored but not filed within the time the first path should have taken. */
  async waiting(ctx: Context, olderThanSeconds: number, limit: number): Promise<string[]> {
    const rows = (await this.db.execute(
      sql`select id from inbound_emails where ${and(this.buildWhere(ctx), sql`inbound_emails.status = 'received'`, sql`inbound_emails.received_at < now() - make_interval(secs => ${olderThanSeconds})`)} order by received_at limit ${limit}`,
    )) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  async health(ctx: Context): Promise<Omit<EmailHealth, 'lastSweepAt'>> {
    const [row] = (await this.db.execute(sql`
      select
        (select count(*)::int from messages where tenant_id = ${ctx.tenantId} and status in ('queued', 'sending') and (attempts > 0 or next_attempt_at <= now())) as queued,
        (select extract(epoch from now() - min(created_at))::int from messages where tenant_id = ${ctx.tenantId} and status in ('queued', 'sending') and (attempts > 0 or next_attempt_at <= now())) as "oldestQueuedSeconds",
        (select count(*)::int from messages where tenant_id = ${ctx.tenantId} and status = 'failed') as "failedOutgoing",
        (select count(*)::int from inbound_emails where tenant_id = ${ctx.tenantId} and status = 'received') as "waitingIncoming",
        (select count(*)::int from inbound_emails where tenant_id = ${ctx.tenantId} and status = 'failed') as "failedIncoming"`)) as unknown as Array<Omit<EmailHealth, 'lastSweepAt'>>;
    return row ?? { queued: 0, oldestQueuedSeconds: null, failedOutgoing: 0, waitingIncoming: 0, failedIncoming: 0 };
  }
}

export class EmailTemplatesRepository extends DrizzleRepository<EmailTemplateRow> {
  constructor(db: DrizzleDb) {
    super(emailTemplatesTable, db);
  }
}

export class MailCursorsRepository extends DrizzleRepository<MailCursorRow> {
  constructor(db: DrizzleDb) {
    super(mailCursorsTable, db);
  }
}
