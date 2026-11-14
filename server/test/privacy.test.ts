import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '../../src/contracts/inbox';
import type { Erasure, PersonalData } from '../../src/contracts/privacy';
import type { CrmRecord, RecordDetail } from '../../src/contracts/records';
import { type Crm, JONAS, MAYA, refusal, startCrm } from './harness';

let crm: Crm;
let person: string;
let deal: string;
const EMAIL = 'forget.me@example.com';

beforeAll(async () => {
  crm = await startCrm();
  // Someone who wrote in, was replied to, had a note logged, gave consent and has a deal.
  await crm.services.mail.receive(crm.system(), 'dev', 'privacy-1', { fromEmail: EMAIL, fromName: 'Forget Me', subject: 'A question', text: 'Please call me on 555 0100.', messageId: '<privacy-1@sender>' });
  const [inbound] = await crm.rows<{ id: string }>(sql`select id from inbound_emails where provider_message_id = 'privacy-1'`);
  await crm.services.mail.file(crm.system(), inbound?.id ?? '');
  const [contact] = await crm.rows<{ id: string }>(sql`select id from records where properties->>'email' = ${EMAIL}`);
  person = contact?.id ?? '';
  const [conversation] = await crm.rows<{ id: string }>(sql`select id from conversations where contact_id = ${person}`);
  await crm.call<Message>(MAYA, 'inbox.reply', { conversationId: conversation?.id, body: 'Calling you now.' });
  await crm.call(MAYA, 'activity.create', { recordId: person, kind: 'note', title: 'Note', body: 'Prefers the phone.' });
  await crm.services.rules.recordConsent(crm.system(), EMAIL, 'Yes, email me news.', 'Newsletter form');
  deal = (await crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'deals', properties: { name: 'Their deal', stage: 'qualified', contact: person, owner: MAYA } })).id;
});

describe('privacy requests', () => {
  it('exports everything held about a person, under the names people see', async () => {
    const data = await crm.call<PersonalData>(MAYA, 'privacy.export', person);
    expect(data.record.fields).toMatchObject({ Email: EMAIL });
    expect(data.consents).toEqual([expect.objectContaining({ text: 'Yes, email me news.', source: 'Newsletter form' })]);
    expect(data.activity.map((entry) => entry.body)).toContain('Prefers the phone.');
    expect(data.conversations).toHaveLength(1);
    expect((data.conversations[0]?.messages as Array<{ body: string }>).map((message) => message.body)).toEqual(['Please call me on 555 0100.', 'Calling you now.']);
    expect(data.linkedRecords).toEqual([{ kind: 'Deal', name: 'Their deal' }]);
  });

  it('is only for people, and only for those allowed', async () => {
    expect(await refusal(crm.call(MAYA, 'privacy.export', deal))).toMatch(/about people/);
    expect(await refusal(crm.call(JONAS, 'privacy.erase', { recordId: person, confirm: EMAIL }))).toMatch(/can't erase a person/);
    expect(await refusal(crm.call(MAYA, 'privacy.erase', { recordId: person, confirm: 'someone.else@example.com' }))).toMatch(/confirm with their email address/);
  });

  it('erases the person and everything about them, for good', async () => {
    const result = await crm.call<Erasure>(MAYA, 'privacy.erase', { recordId: person, confirm: EMAIL.toUpperCase() });
    expect(result.removed).toMatchObject({ record: 1, conversations: 1, messages: 2, consents: 1 });
    expect(result.removed.activity).toBeGreaterThan(0);
    expect(result).toMatchObject({ unlinked: 1, blocked: true });
    expect(await refusal(crm.call(MAYA, 'records.get', person))).toMatch(/not found/);
    // Gone from the database, not marked as deleted; and nothing left that names them.
    const [left] = await crm.rows<{ count: number }>(sql`
      select (select count(*) from records where id = ${person})
        + (select count(*) from activities where record_id = ${person})
        + (select count(*) from messages where from_email = ${EMAIL} or to_email = ${EMAIL})
        + (select count(*) from inbound_emails where payload->>'fromEmail' = ${EMAIL})
        + (select count(*) from consents where email = ${EMAIL})
        + (select count(*) from mariachi_event_outbox where envelope::text like ${`%${EMAIL}%`}) as count`);
    expect(Number(left?.count)).toBe(0);
  });

  it('keeps their deal without them, and never emails the address again', async () => {
    expect((await crm.call<RecordDetail>(MAYA, 'records.get', deal)).record.properties.contact).toBeNull();
    const [preference] = await crm.rows<{ status: string; reason: string }>(sql`select status, reason from email_preferences where email = ${EMAIL}`);
    expect(preference).toEqual({ status: 'blocked', reason: 'Erased at their request' });
  });

  it('does not keep what was typed to confirm in the audit log', async () => {
    const [entry] = await crm.rows<{ text: string }>(sql`select row_to_json(audit_logs)::text as text from audit_logs where row_to_json(audit_logs)::text like '%privacy.erase%' order by 1 desc limit 1`);
    expect(entry?.text).toBeDefined();
    const all = await crm.rows<{ hits: number }>(sql`select count(*)::int as hits from audit_logs where lower(row_to_json(audit_logs)::text) like ${`%${EMAIL}%`}`);
    expect(all[0]?.hits).toBe(0);
  });
});
