import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ConversationDetail, ConversationList, EmailPreference, Message } from '../../src/contracts/inbox';
import type { CrmRecord, RecordDetail } from '../../src/contracts/records';
import { type Crm, JONAS, MAYA, refusal, startCrm } from './harness';

let crm: Crm;
const sender = { id: MAYA, name: 'Maya Okafor', email: 'maya@northwind.example' };
const atProvider = (to: string) => crm.rows<{ text: string; unsubscribe: string | null }>(sql`select payload->>'text' as text, payload->>'unsubscribeUrl' as unsubscribe from dev_mail where direction = 'out' and payload->>'toEmail' = ${to} order by sequence`);
const contact = async (name: string, email: string) => (await crm.call<RecordDetail>(MAYA, 'records.get', (await crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'contacts', properties: { name, email, owner: MAYA } })).id)).record;
/** Receives an email and files it, as the provider and the worker would between them. */
async function arrive(id: string, from: string, subject: string, more: Record<string, unknown> = {}) {
  const status = await crm.services.mail.receive(crm.system(), 'dev', id, { fromEmail: from, subject, text: 'Hello there.', messageId: `<${id}@sender>`, ...more });
  const [row] = await crm.rows<{ id: string }>(sql`select id from inbound_emails where provider_message_id = ${id}`);
  await crm.services.mail.file(crm.system(), row?.id ?? '');
  return status;
}
const conversationWith = async (search: string) => (await crm.call<ConversationList>(MAYA, 'inbox.list', { folder: 'open', search, page: 1, pageSize: 5 })).conversations[0];
const makeDue = () => crm.db.execute(sql`update messages set next_attempt_at = now() where status = 'queued'`);

beforeAll(async () => {
  crm = await startCrm();
});

describe('email coming in', () => {
  it('stores a message once however many times it is delivered', async () => {
    expect(await arrive('in-1', 'stranger@example.com', 'A question')).toBe('stored');
    expect(await arrive('in-1', 'stranger@example.com', 'A question')).toBe('duplicate');
    const [count] = await crm.rows<{ total: number }>(sql`select count(*)::int as total from messages where direction = 'in'`);
    expect(count?.total).toBe(1);
  });

  it('makes a contact for someone unknown and puts their message in the shared queue', async () => {
    const conversation = await conversationWith('A question');
    expect(conversation).toMatchObject({ assigneeId: null, unread: true, messageCount: 1 });
    const made = await crm.call<{ total: number }>(MAYA, 'records.list', { objectId: 'contacts', search: 'stranger@example.com', page: 1, pageSize: 1 });
    expect(made.total).toBe(1);
  });

  it('files a reply onto the thread it answers', async () => {
    const conversation = await conversationWith('A question');
    const reply = await crm.call<Message>(MAYA, 'inbox.reply', { conversationId: conversation?.id, body: 'Happy to help.' });
    await crm.services.mail.deliver(crm.system(), reply.id);
    const [sent] = await crm.rows<{ header: string }>(sql`select message_id_header as header from messages where id = ${reply.id}`);
    await arrive('in-2', 'stranger@example.com', 'Re: something renamed entirely', { inReplyTo: sent?.header });
    const thread = await crm.call<ConversationDetail>(MAYA, 'inbox.get', conversation?.id);
    expect(thread.messages.map((message) => message.direction)).toEqual(['in', 'out', 'in']);
    // Replying to something in the shared queue takes it.
    expect(thread.conversation.assigneeId).toBe(MAYA);
  });

  it('finds a message the provider has but never told us about', async () => {
    await crm.email.arriveSilently('silent-1', { fromEmail: 'quiet@example.com', subject: 'Never pushed', text: 'The delivery for this was lost.' });
    const swept = await crm.services.mail.sweep(crm.system());
    expect(swept.found).toBe(1);
    expect((await crm.services.mail.sweep(crm.system())).found).toBe(0);
  });
});

describe('email going out', () => {
  it('is queued by the action and sent once, however often delivery is tried', async () => {
    const conversation = await conversationWith('A question');
    const reply = await crm.call<Message>(MAYA, 'inbox.reply', { conversationId: conversation?.id, body: 'Sent exactly once' });
    expect(reply.status).toBe('queued');
    await Promise.all([crm.services.mail.deliver(crm.system(), reply.id), crm.services.mail.deliver(crm.system(), reply.id), crm.services.mail.deliver(crm.system(), reply.id)]);
    expect((await atProvider('stranger@example.com')).filter((mail) => mail.text === 'Sent exactly once')).toHaveLength(1);
    const [stored] = await crm.rows<{ status: string }>(sql`select status from messages where id = ${reply.id}`);
    expect(stored?.status).toBe('sent');
  });

  it('retries when the service fails, then sends one copy', async () => {
    const flaky = await contact('Pat Flaky', 'pat@flaky.example');
    const { messageId } = await crm.services.mail.compose(crm.system(), { contact: flaky, sender, subject: 'Flaky', body: 'Retry me' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await makeDue();
      await crm.services.mail.deliver(crm.system(), messageId);
    }
    const [stored] = await crm.rows<{ status: string; attempts: number }>(sql`select status, attempts from messages where id = ${messageId}`);
    expect(stored).toEqual({ status: 'sent', attempts: 3 });
    expect(await atProvider('pat@flaky.example')).toHaveLength(1);
  });

  it('releases a send a worker abandoned, and still sends one copy', async () => {
    const steady = await contact('Sam Steady', 'sam@steady.example');
    const { messageId } = await crm.services.mail.compose(crm.system(), { contact: steady, sender, subject: 'Abandoned', body: 'Half sent' });
    await crm.db.execute(sql`update messages set status = 'sending', attempts = 1, updated_at = now() - interval '5 minutes' where id = ${messageId}`);
    const swept = await crm.services.mail.sweep(crm.system());
    expect(swept.released).toBe(1);
    expect(await atProvider('sam@steady.example')).toHaveLength(1);
  });

  it('marks a bounce failed, tells the sender, and blocks the address for everyone', async () => {
    const gone = await contact('Gone Gary', 'gary@bounce.example');
    const { messageId, conversationId } = await crm.services.mail.compose(crm.system(), { contact: gone, sender, subject: 'Bounce', body: 'Anyone there?' });
    await crm.services.mail.deliver(crm.system(), messageId);
    const thread = await crm.call<ConversationDetail>(MAYA, 'inbox.get', conversationId);
    expect(thread.messages[0]).toMatchObject({ status: 'failed', problem: 'gary@bounce.example does not exist.' });
    const notifications = await crm.call<{ notifications: Array<{ message: string }> }>(MAYA, 'notifications.list');
    expect(notifications.notifications[0]?.message).toMatch(/could not be sent/);
    expect(await crm.call<EmailPreference>(MAYA, 'email.preference', 'gary@bounce.example')).toMatchObject({ status: 'blocked', source: 'bounce' });
    expect(await refusal(crm.call(JONAS, 'inbox.reply', { conversationId, body: 'Trying again' }))).toMatch(/cannot be emailed/);
  });
});

describe('sending later', () => {
  it('holds a reply until its time, lets it be cancelled, and sends it once when due', async () => {
    await arrive('later-1', 'later@example.com', 'When suits');
    const conversation = await conversationWith('When suits');
    const reply = (body: string, sendAt?: string) => crm.call<Message>(MAYA, 'inbox.reply', { conversationId: conversation?.id, body, sendAt });
    expect(await refusal(reply('Too late', new Date(Date.now() - 60_000).toISOString()))).toMatch(/in the future/);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const held = await reply('Tomorrow works.', at);
    expect(held).toMatchObject({ status: 'queued', scheduledFor: at });
    const dropped = await reply('Never mind this one.', at);
    // Neither the event nor the sweep sends it before its time, and it is not counted as a backlog.
    await crm.services.mail.deliver(crm.system(), held.id);
    expect((await crm.services.mail.sweep(crm.system())).sent).toBe(0);
    expect(await atProvider('later@example.com')).toHaveLength(0);
    expect((await crm.call<{ queued: number }>(MAYA, 'inbox.health')).queued).toBe(0);
    await crm.call(MAYA, 'inbox.cancelScheduled', dropped.id);
    await crm.db.execute(sql`update messages set next_attempt_at = now() where id = ${held.id}`);
    expect((await crm.services.mail.sweep(crm.system())).sent).toBe(1);
    expect((await atProvider('later@example.com')).map((mail) => mail.text)).toEqual(['Tomorrow works.']);
    const thread = await crm.call<ConversationDetail>(MAYA, 'inbox.get', conversation?.id);
    expect(thread.messages.filter((message) => message.direction === 'out')).toEqual([expect.objectContaining({ status: 'sent', body: 'Tomorrow works.' })]);
    expect(thread.messages.some((message) => message.scheduledFor)).toBe(false);
    expect(await refusal(crm.call(MAYA, 'inbox.cancelScheduled', held.id))).toMatch(/already been sent/);
  });
});

describe('consent and opting out', () => {
  let otto: CrmRecord;
  let token: string;

  it('puts an unsubscribe link and the one-click address on automated email only', async () => {
    otto = await contact('Opt Otto', 'otto@optout.example');
    const automated = await crm.services.mail.compose(crm.system(), { contact: otto, sender, subject: 'News', body: 'An automated hello', purpose: 'automated' });
    await crm.services.mail.deliver(crm.system(), automated.messageId);
    const personal = await crm.services.mail.compose(crm.system(), { contact: otto, sender, subject: 'Personal', body: 'A personal hello' });
    await crm.services.mail.deliver(crm.system(), personal.messageId);
    const [first, second] = await atProvider('otto@optout.example');
    expect(first?.text).toMatch(/To stop getting these emails: http:\/\/crm\.test\/u\//);
    expect(first?.unsubscribe).toMatch(/\/api\/inbound\/unsubscribe\//);
    expect(second?.text).toBe('A personal hello');
    expect(second?.unsubscribe).toBeNull();
    token = /\/u\/(\S+)/.exec(first?.text ?? '')?.[1] ?? '';
  });

  it('changes nothing when the link is opened, only when the person confirms', async () => {
    expect(await crm.visit('email.unsubscribePage', token)).toMatchObject({ email: 'o•••@optout.example', status: 'subscribed' });
    expect(await refusal(crm.visit('email.unsubscribePage', `${token.slice(0, -3)}abc`))).toMatch(/not valid/);
    expect(await crm.visit('email.unsubscribe', { token })).toMatchObject({ status: 'unsubscribed' });
  });

  it('then sends them nothing automated, while a person can still reply', async () => {
    expect(await refusal(crm.services.mail.compose(crm.system(), { contact: otto, sender, subject: 'More news', body: 'x', purpose: 'automated' }))).toMatch(/has unsubscribed/);
    await crm.services.mail.compose(crm.system(), { contact: otto, sender, subject: 'Sorry', body: 'A person writing' });
  });

  it('needs a reason, and an admin, to email them again', async () => {
    const resume = (as: string, reason?: string) => crm.call<EmailPreference>(as, 'email.setPreference', { email: 'otto@optout.example', status: 'subscribed', reason });
    expect(await refusal(resume(MAYA))).toMatch(/Say why/);
    expect(await refusal(resume(JONAS, 'he asked'))).toMatch(/can't resume email to someone who unsubscribed themselves/);
    expect((await resume(MAYA, 'Asked on a call')).status).toBe('subscribed');
  });

  it('checks again just before sending, in case they opted out in between', async () => {
    const queued = await crm.services.mail.compose(crm.system(), { contact: otto, sender, subject: 'Queued', body: 'Queued before they left', purpose: 'automated' });
    await crm.visit('email.unsubscribe', { token });
    await crm.services.mail.deliver(crm.system(), queued.messageId);
    const [stored] = await crm.rows<{ status: string; last_error: string }>(sql`select status, last_error from messages where id = ${queued.messageId}`);
    expect(stored?.status).toBe('failed');
    expect((await atProvider('otto@optout.example')).some((mail) => mail.text.startsWith('Queued before they left'))).toBe(false);
  });

  it('holds automated email to the weekly limit', async () => {
    const lena = await contact('Limit Lena', 'lena@limit.example');
    for (let count = 0; count < 3; count += 1) await crm.services.mail.compose(crm.system(), { contact: lena, sender, subject: `News ${count}`, body: 'x', purpose: 'automated' });
    expect(await refusal(crm.services.mail.compose(crm.system(), { contact: lena, sender, subject: 'Too many', body: 'x', purpose: 'automated' }))).toMatch(/already had 3 automated emails this week/);
    // A person writing to them is not counted or limited.
    await crm.services.mail.compose(crm.system(), { contact: lena, sender, subject: 'Personal', body: 'x' });
    expect(await crm.call<EmailPreference>(MAYA, 'email.preference', 'lena@limit.example')).toMatchObject({ sentThisWeek: 3, weeklyLimit: 3 });
  });

  it('records consent given on a form, in the words agreed to', async () => {
    const form = await crm.call<{ id: string }>(MAYA, 'forms.save', { name: 'News', heading: 'News', fields: [{ property: 'email', required: true }], submitLabel: 'Go', thanks: 'Thanks', consentText: 'Yes, email me news.' });
    await crm.visit('forms.submit', { formId: form.id, values: { email: 'otto@optout.example', __consent: 'yes' } });
    await crm.visit('forms.submit', { formId: form.id, values: { email: 'nobox@example.com' } });
    const otto2 = await crm.call<EmailPreference>(MAYA, 'email.preference', 'otto@optout.example');
    // Agreeing again brings back someone who had unsubscribed.
    expect(otto2).toMatchObject({ status: 'subscribed', consent: { text: 'Yes, email me news.', source: 'the "News" form' } });
    expect((await crm.call<EmailPreference>(MAYA, 'email.preference', 'nobox@example.com')).consent).toBeNull();
  });
});
