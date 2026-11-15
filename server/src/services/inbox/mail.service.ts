import type { Context } from '@mariachi/core';
import type { Outbox } from '@mariachi/events/outbox';
import { randomUUID } from 'node:crypto';
import type { PropertyValue } from '../../../../src/contracts/metadata';
import type { EmailDesign } from '../../../../src/contracts/emailDesign';
import type { CrmRecord } from '../../../../src/contracts/records';
import { type Fill, renderEmailHtml, renderEmailText, sampleFill } from '../../../../src/lib/emailDesign';
import { type EmailProvider, PermanentSendError } from '../../email';
import { emailQueued, emailReceived } from '../../events';
import type { InboundPayload } from '../../schema';
import type { ActivityRepository } from '../activity/activity.repository';
import type { NotificationsService } from '../notifications/notifications.service';
import type { RecordEvents } from '../records/records.events';
import type { RecordsRepository } from '../records/records.repository';
import { type EmailRules, type Purpose, Suppressed } from './email-rules.service';
import type { ConversationsRepository, InboundEmailsRepository, MailCursorsRepository, MessagesRepository } from './inbox.repository';

/**
 * Moving email in and out without losing any. The rules:
 *
 * In: an arrival is stored before the provider is told it was received (`receive`). It is filed
 * into a conversation afterwards, from the stored copy (`file`), and filing twice changes nothing.
 * Out: sending stores the message as queued in the caller's transaction (`queue`). The worker
 * sends it (`deliver`) with the message's id as the idempotency key, so a retry cannot send twice.
 * Both: `sweep` runs on a timer and picks up whatever the first path did not finish, and asks the
 * provider for anything that arrived without the CRM being told.
 */

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
/** After this many tries a message is marked failed. It is kept either way. */
const MAX_ATTEMPTS = 6;
/** How long the first path gets before the sweep steps in. */
const GRACE_SECONDS = 10;
/** A message being sent for longer than this was abandoned by its worker. */
const STUCK_SECONDS = 120;

const stripPrefixes = (subject: string) => subject.replace(/^((re|fwd?):\s*)+/i, '').trim();

export class MailService {
  constructor(
    private readonly provider: EmailProvider,
    private readonly inbound: InboundEmailsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly cursors: MailCursorsRepository,
    private readonly records: RecordsRepository,
    private readonly activities: ActivityRepository,
    private readonly notifications: NotificationsService,
    private readonly outbox: Outbox,
    private readonly recordEvents: RecordEvents,
    private readonly transaction: <T>(ctx: Context, fn: () => Promise<T>) => Promise<T>,
    private readonly rules: EmailRules,
  ) {}

  /** Told, inside the filing transaction, that a contact has written in. Sequences use it to stop. */
  onReply?: (ctx: Context, contactId: string) => Promise<void>;

  /** Stores an arrival. Only when this returns may the provider be told "received". */
  async receive(ctx: Context, provider: string, providerMessageId: string, payload: InboundPayload): Promise<'stored' | 'duplicate'> {
    return this.transaction(ctx, async () => {
      const stored = await this.inbound.store(ctx, id('in'), provider, providerMessageId, payload);
      if (!stored) return 'duplicate';
      await this.outbox.add(ctx, emailReceived, { inboundId: stored });
      return 'stored';
    });
  }

  /** Files a stored arrival into a conversation. A failure is recorded on the arrival, which stays stored for the next try. */
  async file(ctx: Context, inboundId: string): Promise<void> {
    const arrival = await this.inbound.findById(ctx, inboundId);
    if (!arrival || arrival.status !== 'received') return;
    try {
      await this.transaction(ctx, async () => {
        const mail = arrival.payload;
        const contact = (await this.records.byText(ctx, 'contacts', 'email', mail.fromEmail)) ?? (await this.newContact(ctx, mail));
        const conversationId =
          (await this.messages.conversationOf(ctx, [mail.inReplyTo, ...(mail.references ?? [])].filter((header): header is string => Boolean(header)))) ??
          (await this.conversations.bySubject(ctx, contact.id, stripPrefixes(mail.subject))) ??
          (await this.startConversation(ctx, contact, mail.subject));
        const added = await this.messages.addIncoming(ctx, {
          id: `msg_${arrival.id}`,
          conversationId,
          fromName: mail.fromName?.trim() || String(contact.properties.name ?? mail.fromEmail),
          fromEmail: mail.fromEmail,
          toEmail: mail.toEmail ?? '',
          subject: mail.subject,
          body: mail.text,
          html: mail.html ?? null,
          messageIdHeader: mail.messageId ?? null,
          sentAt: mail.receivedAt ? new Date(mail.receivedAt) : arrival.receivedAt,
        });
        if (added) {
          await this.conversations.refresh(ctx, conversationId, { unread: true, reopen: true });
          await this.activities.create(ctx, { id: id('act'), recordId: contact.id, kind: 'email', title: `Email received: ${mail.subject}`, body: mail.text.slice(0, 500), actorId: 'system' });
          await this.onReply?.(ctx, contact.id);
        }
        await this.inbound.update(ctx, arrival.id, { status: 'processed', conversationId, processedAt: new Date(), lastError: null });
      });
    } catch (error) {
      const attempts = arrival.attempts + 1;
      await this.inbound.update(ctx, arrival.id, { attempts, lastError: error instanceof Error ? error.message : String(error), status: attempts >= MAX_ATTEMPTS ? 'failed' : 'received' });
      ctx.logger.error({ inboundId: arrival.id, attempts, error }, 'An incoming email could not be filed');
    }
  }

  /** Someone the CRM has never heard from becomes a contact, so their email has somewhere to live. Announced like any new contact, so routing workflows give them an owner. */
  private async newContact(ctx: Context, mail: InboundPayload): Promise<CrmRecord> {
    const name = mail.fromName?.trim() || (mail.fromEmail.split('@')[0] ?? mail.fromEmail);
    const properties: Record<string, PropertyValue> = { name, email: mail.fromEmail.toLowerCase(), createdAt: new Date().toISOString().slice(0, 10) };
    const contact = await this.records.insert(ctx, { id: id('con'), objectId: 'contacts', properties });
    await this.recordEvents.created(ctx, contact);
    return contact;
  }

  private async startConversation(ctx: Context, contact: CrmRecord, subject: string): Promise<string> {
    const text = (key: string) => (typeof contact.properties[key] === 'string' ? (contact.properties[key] as string) : null);
    const created = await this.conversations.create(ctx, { id: id('conv'), subject: subject || '(no subject)', status: 'open', assigneeId: text('owner'), contactId: contact.id, companyId: text('company'), dealId: null, unread: true, preview: '', messageCount: 0 });
    return created.id;
  }

  /** Stores an outgoing message as queued. Call it inside the transaction of whatever caused the send. */
  async queue(ctx: Context, input: { conversationId: string; sender: { id: string; name: string; email: string }; toEmail: string; subject: string; body: string; design?: EmailDesign | null; fill?: Fill; purpose?: Purpose; sendAt?: Date }): Promise<string> {
    const purpose = input.purpose ?? 'conversation';
    // Refused here if the address has opted out or had its share this week, before anything is stored.
    await this.rules.check(ctx, input.toEmail, purpose);
    // A designed email is sent as HTML with its own words as the plain-text version beside it.
    const words = input.design ? renderEmailText(input.design, input.fill) : input.body;
    const body = purpose === 'automated' ? `${words}${await this.rules.footer(ctx, input.toEmail)}` : words;
    const html = input.design ? renderEmailHtml(input.design, { subject: input.subject, fill: input.fill, ...(purpose === 'automated' ? { footer: await this.rules.footerParts(ctx, input.toEmail) } : {}) }) : null;
    const messageId = id('msg');
    await this.messages.create(ctx, {
      id: messageId,
      conversationId: input.conversationId,
      direction: 'out',
      fromName: input.sender.name,
      fromEmail: input.sender.email,
      toEmail: input.toEmail,
      subject: input.subject,
      body,
      html,
      purpose,
      status: 'queued',
      messageIdHeader: `<${messageId}@crm>`,
      providerId: null,
      senderId: input.sender.id,
      attempts: 0,
      lastError: null,
      // A message for later waits in the same queue; it just is not due until its time.
      ...(input.sendAt ? { nextAttemptAt: input.sendAt } : {}),
    });
    await this.conversations.refresh(ctx, input.conversationId, { unread: false });
    await this.outbox.add(ctx, emailQueued, { messageId });
    return messageId;
  }

  /** Starts a new conversation with a contact by sending them an email: what a workflow's "send an email" does. */
  async compose(ctx: Context, input: { contact: CrmRecord; sender: { id: string; name: string; email: string }; subject: string; body: string; design?: EmailDesign | null; fill?: Fill; dealId?: string | null; purpose?: Purpose }): Promise<{ messageId: string; conversationId: string }> {
    const toEmail = typeof input.contact.properties.email === 'string' ? input.contact.properties.email : '';
    if (!toEmail) throw new Error(`${String(input.contact.properties.name ?? 'The contact')} has no email address.`);
    return this.transaction(ctx, async () => {
      const company = typeof input.contact.properties.company === 'string' ? input.contact.properties.company : null;
      const conversation = await this.conversations.create(ctx, { id: id('conv'), subject: input.subject, status: 'open', assigneeId: input.sender.id, contactId: input.contact.id, companyId: company, dealId: input.dealId ?? null, unread: false, preview: '', messageCount: 0 });
      const messageId = await this.queue(ctx, { conversationId: conversation.id, sender: input.sender, toEmail, subject: input.subject, body: input.body, design: input.design, fill: input.fill, purpose: input.purpose });
      await this.activities.create(ctx, { id: id('act'), recordId: input.contact.id, kind: 'email', title: `Email sent: ${input.subject}`, body: input.body, actorId: input.sender.id });
      return { messageId, conversationId: conversation.id };
    });
  }

  /** Sends an email straight to a member of the team so they can see how it arrives. Merge fields get example names. Nothing is kept. */
  async sendTest(ctx: Context, to: { name: string; email: string }, input: { subject: string; body: string; design?: EmailDesign }): Promise<void> {
    const subject = `[Test] ${sampleFill(input.subject) || 'No subject'}`;
    const key = id('test');
    await this.provider.send(
      { fromName: to.name, fromEmail: to.email, toEmail: to.email, subject, text: input.design ? renderEmailText(input.design, sampleFill) : sampleFill(input.body), ...(input.design ? { html: renderEmailHtml(input.design, { subject, fill: sampleFill, footer: await this.rules.footerParts(ctx, to.email) }) } : {}), messageId: `<${key}@crm>` },
      { idempotencyKey: key },
    );
  }

  /** Sends a queued message, if it is due and no other worker has taken it. */
  async deliver(ctx: Context, messageId: string): Promise<void> {
    const message = await this.messages.claim(ctx, messageId);
    if (!message) return;
    const purpose: Purpose = message.purpose === 'automated' ? 'automated' : 'conversation';
    try {
      // Checked again now: they may have unsubscribed, or bounced, since it was queued.
      await this.rules.check(ctx, message.toEmail, purpose, { countingItself: true });
    } catch (error) {
      if (error instanceof Suppressed) {
        await this.messages.update(ctx, message.id, { status: 'failed', lastError: error.message });
        return;
      }
      // Over the limit at the last moment is not a reason to drop it; it goes as planned.
    }
    try {
      const previous = await this.messages.findMany(ctx, { conversationId: message.conversationId, direction: 'in' }, { sort: { field: 'sentAt', direction: 'desc' }, limit: 1 });
      const sent = await this.provider.send(
        { fromName: message.fromName, fromEmail: message.fromEmail, toEmail: message.toEmail, subject: message.subject, text: message.body, ...(message.html ? { html: message.html } : {}), messageId: message.messageIdHeader ?? `<${message.id}@crm>`, inReplyTo: previous[0]?.messageIdHeader ?? undefined, ...(purpose === 'automated' ? { unsubscribeUrl: this.rules.oneClickUrl(message.toEmail) } : {}) },
        { idempotencyKey: message.id },
      );
      await this.messages.update(ctx, message.id, { status: 'sent', providerId: sent.providerId, lastError: null, sentAt: new Date() });
      await this.conversations.refresh(ctx, message.conversationId, {});
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // An address the service says does not exist is never tried again, by anyone.
      if (error instanceof PermanentSendError) await this.rules.bounced(ctx, message.toEmail, reason);
      if (error instanceof PermanentSendError || message.attempts >= MAX_ATTEMPTS) {
        await this.messages.update(ctx, message.id, { status: 'failed', lastError: reason });
        if (message.senderId) await this.notifications.send(ctx, message.senderId, `Your email to ${message.toEmail} could not be sent: ${reason}`, null);
        return;
      }
      // Back to the queue, waiting a little longer each time: 5s, 10s, 20s, 40s, 80s.
      await this.messages.update(ctx, message.id, { status: 'queued', lastError: reason, nextAttemptAt: new Date(Date.now() + 5_000 * 2 ** (message.attempts - 1)) });
    }
  }

  /**
   * What the email service reports about a message after accepting it. Reported twice, it changes
   * nothing the second time. A bounce or a spam complaint blocks the address for everyone and
   * tells whoever sent the message.
   */
  async delivery(ctx: Context, event: { providerId?: string; messageId?: string; type: 'delivered' | 'bounced' | 'complained'; reason?: string; at?: string }): Promise<'recorded' | 'unchanged' | 'unknown'> {
    const message = await this.messages.sentAs(ctx, event.providerId, event.messageId);
    if (!message) return 'unknown';
    // A complaint outranks a bounce, which outranks a delivery; news that says less than what is known is ignored.
    const rank = { delivered: 1, bounced: 2, complained: 3 } as const;
    if (message.delivery && rank[event.type] <= (rank[message.delivery as keyof typeof rank] ?? 0)) return 'unchanged';
    const reason = event.type === 'complained' ? 'They marked it as spam.' : (event.reason?.trim().slice(0, 500) ?? '');
    await this.transaction(ctx, async () => {
      await this.messages.update(ctx, message.id, { delivery: event.type, deliveryDetail: reason || null, deliveredAt: event.at ? new Date(event.at) : new Date() });
      if (event.type === 'delivered') return;
      if (event.type === 'bounced') await this.rules.bounced(ctx, message.toEmail, reason || 'The mailbox refused it.');
      else await this.rules.complained(ctx, message.toEmail);
      if (message.senderId) await this.notifications.send(ctx, message.senderId, event.type === 'bounced' ? `Your email to ${message.toEmail} bounced${reason ? `: ${reason}` : '.'} They will not be emailed again.` : `${message.toEmail} marked your email as spam. They will not be emailed again.`, null);
    });
    return 'recorded';
  }

  /** Finishes whatever the first path did not, and asks the provider what arrived since last time. */
  async sweep(ctx: Context): Promise<{ filed: number; sent: number; released: number; found: number }> {
    const waiting = await this.inbound.waiting(ctx, GRACE_SECONDS, 100);
    for (const inboundId of waiting) await this.file(ctx, inboundId);

    const released = await this.messages.releaseStuck(ctx, STUCK_SECONDS);
    const due = await this.messages.due(ctx, 100);
    for (const messageId of due) await this.deliver(ctx, messageId);

    let found = 0;
    if (this.provider.listInboundSince) {
      const cursor = await this.cursors.findById(ctx, this.provider.name);
      const page = await this.provider.listInboundSince(cursor?.position ?? null);
      for (const message of page.messages) if ((await this.receive(ctx, this.provider.name, message.providerMessageId, message.payload)) === 'stored') found += 1;
      // The position moves only now, after everything read is stored: a failure above repeats this page instead of skipping it.
      if (cursor) await this.cursors.update(ctx, cursor.id, { position: page.position, sweptAt: new Date() });
      else await this.cursors.create(ctx, { id: this.provider.name, position: page.position, sweptAt: new Date() });
    }
    return { filed: waiting.length, sent: due.length, released, found };
  }
}
