import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ObjectDefinition } from '../../src/contracts/metadata';
import type { MigrationRun, MigrationStep } from '../../src/contracts/migration';
import type { AIAdapter, AIMessage } from '@mariachi/ai';
import { registerModelProvider } from '../src/assistant/providers';
import { FakeHubSpot } from './fake-hubspot';
import { type Crm, JONAS, MAYA, PRIYA, refusal, startCrm } from './harness';

/**
 * Moving in from HubSpot. The account is a fake held in memory that answers as HubSpot's API does;
 * everything on the CRM's side is real.
 */

let crm: Crm;
let hubspot: FakeHubSpot;

const KEY = 'test-private-app-key';

/** Carries every running run as far as it will go, the way the worker does. */
async function work(): Promise<void> {
  for (let round = 0; round < 200; round += 1) if (!(await crm.services.migrations.advance(crm.system()))) return;
  throw new Error('The run never came to rest.');
}

const plan = () => crm.call<MigrationRun>(MAYA, 'migrations.create', { source: 'hubspot', key: KEY, addPeople: true });
const read = (runId: string) => crm.call<MigrationRun>(MAYA, 'migrations.get', runId);

async function run(mode: 'check' | 'import' = 'import', runId?: string): Promise<MigrationRun> {
  const id = runId ?? (await plan()).id;
  await crm.call(MAYA, 'migrations.start', { runId: id, mode });
  await work();
  return read(id);
}

const step = (found: MigrationRun, title: string): MigrationStep => {
  const match = found.steps.find((item) => item.title === title);
  if (!match) throw new Error(`No step called "${title}" among: ${found.steps.map((item) => item.title).join(', ')}`);
  return match;
};

type Row = { id: string; properties: Record<string, unknown>; created: string };
const records = (objectId: string) => crm.rows<Row>(sql`select id, properties, to_char(created_at, 'YYYY-MM-DD') as created from records where object_id = ${objectId} and deleted_at is null order by properties->>'name'`);
const definition = async (objectId: string) => (await crm.call<{ objects: ObjectDefinition[] }>(MAYA, 'workspace.get')).objects.find((item) => item.id === objectId) as ObjectDefinition;

/** A small account: two owners, a company, two contacts, a deal. */
function fill(): void {
  hubspot.owners.push({ id: '501', email: 'priya@northwind.example', firstName: 'Priya', lastName: 'Raman' }, { id: '502', email: 'sam@old-crm.example', firstName: 'Sam', lastName: 'Okoro' });
  hubspot.properties.contacts?.push({ name: 'favourite_colour', label: 'Favourite colour', type: 'enumeration', fieldType: 'select', options: [{ label: 'Teal', value: 'teal' }, { label: 'Plum', value: 'plum' }] }, { name: 'renewal_date', label: 'Renewal date', type: 'date', fieldType: 'date' }, { name: 'hs_analytics_num_visits', label: 'Number of visits', type: 'number', fieldType: 'number', hubspotDefined: true });
  hubspot.add('companies', { name: 'Acme Rockets', domain: 'acme.example', hubspot_owner_id: '501' }, { id: 'c1' });
  hubspot.add('contacts', { firstname: 'Wile', lastname: 'Coyote', email: 'wile@acme.example', jobtitle: 'Buyer', lifecyclestage: 'marketingqualifiedlead', hubspot_owner_id: '502', favourite_colour: 'plum', renewal_date: '2027-01-31' }, { id: 'p1', associations: { companies: ['c1'] }, createdAt: '2023-06-01T08:30:00.000Z' });
  hubspot.add('contacts', { firstname: 'Road', lastname: 'Runner', email: 'road@acme.example', lifecyclestage: 'evangelist', hs_email_optout: 'true' }, { id: 'p2', associations: { companies: ['c1'] } });
  hubspot.add('deals', { dealname: 'Anvils, bulk', amount: '12500', dealstage: 'qualifiedtobuy', closedate: '2026-12-20T00:00:00.000Z', hubspot_owner_id: '501' }, { id: 'd1', associations: { companies: ['c1'], contacts: ['p1'] } });
}

beforeEach(async () => {
  hubspot = new FakeHubSpot();
  crm = await startCrm({ migrationSource: () => hubspot });
});

describe('planning a move', () => {
  it('lays out the steps and keeps the key to itself', async () => {
    const planned = await plan();
    expect(planned.status).toBe('draft');
    expect(planned.hasKey).toBe(true);
    expect(JSON.stringify(planned)).not.toContain(KEY);
    expect(planned.steps.map((item) => item.title)).toEqual(['People', 'Deal stages', 'Company fields', 'Contact fields', 'Deal fields', 'Companies', 'Contacts', 'Deals', 'Tasks', 'Custom objects', 'Notes', 'Calls', 'Emails', 'Meetings']);
    expect(planned.steps.every((item) => item.status === 'waiting')).toBe(true);
    const stored = await crm.rows<{ key: string }>(sql`select key_encrypted as key from migration_runs`);
    expect(stored[0]?.key).toBeTruthy();
    expect(stored[0]?.key).not.toContain(KEY);
    // Nothing has been asked of HubSpot yet.
    expect(hubspot.asked).toEqual([]);
  });

  it('is only for someone who manages settings', async () => {
    expect(await refusal(crm.call(JONAS, 'migrations.create', { source: 'hubspot', key: KEY, addPeople: true }))).toMatch(/can't/i);
  });
});

describe('importing', () => {
  beforeEach(fill);

  it('brings people, fields, companies, contacts and deals, linked as they were', async () => {
    const done = await run();
    expect(done.status).toBe('done');
    expect(done.steps.filter((item) => item.status !== 'done').map((item) => item.title)).toEqual([]);

    // People: one matched by email, one added as invited.
    const people = await crm.rows<{ id: string; email: string; status: string }>(sql`select id, email, status from people where email in ('priya@northwind.example', 'sam@old-crm.example') order by email`);
    expect(people.map((person) => person.status)).toEqual(['active', 'invited']);
    expect(step(done, 'People').counts).toMatchObject({ read: 2, created: 1, updated: 0 });

    const [company] = await records('companies');
    expect(company?.properties).toMatchObject({ name: 'Acme Rockets', domain: 'acme.example', owner: PRIYA });

    const [road, wile] = await records('contacts');
    expect(wile?.properties).toMatchObject({ name: 'Wile Coyote', email: 'wile@acme.example', jobTitle: 'Buyer', lifecycleStage: 'mql', company: company?.id, owner: people[1]?.id, createdAt: '2023-06-01' });
    expect(wile?.created).toBe('2023-06-01');
    expect(road?.properties.company).toBe(company?.id);

    // Custom fields became properties, with their choices, and hold the values.
    const contacts = await definition('contacts');
    const colour = contacts.properties.find((item) => item.label === 'Favourite colour');
    expect(colour).toMatchObject({ type: 'select', custom: true });
    expect(colour?.options?.map((option) => option.label)).toEqual(['Teal', 'Plum']);
    expect(wile?.properties[colour?.id ?? '']).toBe('plum');
    const renewal = contacts.properties.find((item) => item.label === 'Renewal date');
    expect(wile?.properties[renewal?.id ?? '']).toBe('2027-01-31');
    // HubSpot's own analytics fields are not turned into properties.
    expect(contacts.properties.some((item) => item.label === 'Number of visits')).toBe(false);
    // A lifecycle stage the CRM did not have was added as a choice.
    expect(contacts.properties.find((item) => item.id === 'lifecycleStage')?.options?.some((option) => option.label === 'Evangelist')).toBe(true);
    expect(road?.properties.lifecycleStage).toBe('evangelist');

    const [deal] = await records('deals');
    const stages = (await definition('deals')).properties.find((item) => item.id === 'stage')?.options ?? [];
    expect(stages.find((option) => option.id === deal?.properties.stage)?.label).toBe('Qualified To Buy');
    expect(deal?.properties).toMatchObject({ name: 'Anvils, bulk', amount: 12500, closeDate: '2026-12-20', company: company?.id, contact: wile?.id, owner: PRIYA });

    expect(step(done, 'Contacts').counts).toMatchObject({ read: 2, created: 2, failed: 0 });
    expect(step(done, 'Contacts').finishedAt).toBeTruthy();
  });

  it('forgets the key once the import is done', async () => {
    const done = await run();
    expect(done.hasKey).toBe(false);
    expect(await crm.rows(sql`select 1 from migration_runs where key_encrypted is not null`)).toEqual([]);
  });

  it('maps won and lost to the stages the CRM already means by them', async () => {
    hubspot.add('deals', { dealname: 'Won one', dealstage: 'closedwon' });
    hubspot.add('deals', { dealname: 'Lost one', dealstage: 'closedlost' });
    await run();
    const deals = await records('deals');
    expect(deals.find((deal) => deal.properties.name === 'Won one')?.properties.stage).toBe('won');
    expect(deals.find((deal) => deal.properties.name === 'Lost one')?.properties.stage).toBe('lost');
  });

  it('makes nothing twice when it is run again', async () => {
    await run();
    hubspot.objects.contacts?.[0] && (hubspot.objects.contacts[0].properties.jobtitle = 'Head of buying');
    const again = await run();
    expect(again.status).toBe('done');
    expect((await records('contacts')).length).toBe(2);
    expect((await records('companies')).length).toBe(1);
    expect((await records('deals')).length).toBe(1);
    expect(step(again, 'Contacts').counts).toMatchObject({ read: 2, created: 0, updated: 2 });
    expect((await records('contacts')).find((contact) => contact.properties.email === 'wile@acme.example')?.properties.jobTitle).toBe('Head of buying');
    expect((await definition('contacts')).properties.filter((item) => item.label === 'Favourite colour').length).toBe(1);
    expect(await crm.rows(sql`select 1 from people where email = 'sam@old-crm.example'`)).toHaveLength(1);
  });

  it('fills in a contact that is already here instead of adding a second', async () => {
    const existing = await crm.seed('contacts', { name: 'W. Coyote', email: 'Wile@Acme.example', phone: '555-0100' });
    const done = await run();
    const contacts = await records('contacts');
    expect(contacts.length).toBe(2);
    const wile = contacts.find((contact) => contact.id === existing);
    // What was here stays; what was empty is filled.
    expect(wile?.properties).toMatchObject({ name: 'W. Coyote', phone: '555-0100', jobTitle: 'Buyer' });
    expect(step(done, 'Contacts').counts).toMatchObject({ created: 1, updated: 1 });
  });

  it('carries over who must not be emailed, with the contact', async () => {
    hubspot.add('contacts', { firstname: 'Bad', lastname: 'Address', email: 'gone@acme.example', hs_email_hard_bounce_reason_enum: 'UNKNOWN_USER' });
    await run();
    expect(await crm.call(MAYA, 'email.preference', 'road@acme.example')).toMatchObject({ status: 'unsubscribed' });
    expect(await crm.call(MAYA, 'email.preference', 'gone@acme.example')).toMatchObject({ status: 'blocked' });
    expect(await crm.call(MAYA, 'email.preference', 'wile@acme.example')).toMatchObject({ status: 'subscribed' });
  });

  it('sets off no workflows and leaves archived records behind', async () => {
    hubspot.add('contacts', { firstname: 'Old', lastname: 'Timer', email: 'old@acme.example' }, { archived: true });
    await run();
    expect((await records('contacts')).length).toBe(2);
    expect(await crm.rows(sql`select 1 from mariachi_event_outbox where envelope::text like '%record.created%'`)).toEqual([]);
  });

  it('brings a record whose name is missing, and says so', async () => {
    hubspot.add('contacts', { email: 'nameless@acme.example' }, { id: 'p9' });
    hubspot.add('contacts', {}, { id: 'p10' });
    const done = await run();
    const contacts = await records('contacts');
    expect(contacts.some((contact) => contact.properties.name === 'nameless@acme.example')).toBe(true);
    expect(contacts.length).toBe(4);
    const issues = step(done, 'Contacts').issues;
    expect(issues.some((issue) => issue.sourceId === 'p10' && /no name/i.test(issue.message))).toBe(true);
    expect(step(done, 'Contacts').counts.warnings).toBe(1);
  });

  it('works through an account a page at a time', async () => {
    for (let index = 0; index < 250; index += 1) hubspot.add('contacts', { firstname: 'Person', lastname: String(index).padStart(3, '0'), email: `person${index}@bulk.example` });
    const done = await run();
    expect((await records('contacts')).length).toBe(252);
    expect(step(done, 'Contacts').counts).toMatchObject({ read: 252, created: 252 });
    expect(hubspot.asked.filter((path) => path === '/crm/v3/objects/contacts').length).toBe(3);
  });
});

describe('checking first', () => {
  beforeEach(fill);

  it('reports what would come across and writes nothing', async () => {
    const checked = await run('check');
    expect(checked.status).toBe('checked');
    expect(checked.hasKey).toBe(true);
    expect(step(checked, 'Contacts').counts).toMatchObject({ read: 2, created: 2 });
    expect(step(checked, 'Contact fields').counts.created).toBe(2);
    expect(step(checked, 'People').counts).toMatchObject({ read: 2, created: 1 });
    expect(await records('contacts')).toEqual([]);
    expect(await crm.rows(sql`select 1 from people where email = 'sam@old-crm.example'`)).toEqual([]);
    expect((await definition('contacts')).properties.some((item) => item.label === 'Favourite colour')).toBe(false);
    expect(await crm.rows(sql`select 1 from migration_links`)).toEqual([]);

    // The same run then does it for real.
    const done = await run('import', checked.id);
    expect(done.status).toBe('done');
    expect((await records('contacts')).length).toBe(2);
    expect(step(done, 'Contacts').counts).toMatchObject({ read: 2, created: 2 });
  });
});

describe('when something goes wrong', () => {
  beforeEach(fill);

  it('stops at the step that failed, keeps its place, and carries on from there', async () => {
    for (let index = 0; index < 150; index += 1) hubspot.add('contacts', { firstname: 'Person', lastname: String(index), email: `person${index}@bulk.example` });
    hubspot.failOnce = { path: '/crm/v3/objects/contacts', after: '100', status: 500 };
    const failed = await run();
    expect(failed.status).toBe('failed');
    const contacts = step(failed, 'Contacts');
    expect(contacts.status).toBe('failed');
    expect(contacts.error).toMatch(/500/);
    expect(contacts.counts.created).toBe(100);
    expect(step(failed, 'Deals').status).toBe('waiting');

    await crm.call(MAYA, 'migrations.changeStep', { runId: failed.id, stepId: contacts.id, action: 'retry' });
    await work();
    const done = await read(failed.id);
    expect(done.status).toBe('done');
    expect(step(done, 'Contacts').counts).toMatchObject({ read: 152, created: 152 });
    expect((await records('contacts')).length).toBe(152);
  });

  it('says so in words when HubSpot refuses the key', async () => {
    hubspot.failOnce = { path: '/crm/v3/owners', status: 401 };
    const failed = await run();
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/key/i);
  });

  it('can be paused and picked up again', async () => {
    const planned = await plan();
    await crm.call(MAYA, 'migrations.start', { runId: planned.id, mode: 'import' });
    await crm.services.migrations.advance(crm.system(), { pages: 2 });
    const paused = await crm.call<MigrationRun>(MAYA, 'migrations.pause', planned.id);
    expect(paused.status).toBe('paused');
    expect(await crm.services.migrations.advance(crm.system())).toBe(false);
    const done = await run('import', planned.id);
    expect(done.status).toBe('done');
    expect((await records('contacts')).length).toBe(2);
  });

  it('can be cancelled, which forgets the key', async () => {
    const planned = await plan();
    const cancelled = await crm.call<MigrationRun>(MAYA, 'migrations.cancel', planned.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', hasKey: false });
    expect(await refusal(crm.call(MAYA, 'migrations.start', { runId: planned.id, mode: 'import' }))).toMatch(/cancelled/i);
  });
});

describe('what is particular to one account', () => {
  beforeEach(fill);

  it('brings custom objects by adding steps for each one it finds', async () => {
    hubspot.schemas.push({
      objectTypeId: '2-777',
      name: 'rockets',
      labels: { singular: 'Rocket', plural: 'Rockets' },
      primaryDisplayProperty: 'model',
      properties: [
        { name: 'model', label: 'Model', type: 'string', fieldType: 'text' },
        { name: 'thrust', label: 'Thrust', type: 'number', fieldType: 'number' },
      ],
      associations: [{ toObjectTypeId: '0-2' }],
    });
    hubspot.add('2-777', { model: 'Mark IV', thrust: '9000' }, { id: 'r1', associations: { companies: ['c1'] } });
    const done = await run();
    expect(done.status).toBe('done');
    expect(done.steps.map((item) => item.title)).toEqual(expect.arrayContaining(['Rocket fields', 'Rockets']));
    expect(step(done, 'Rockets').addedBy).toBe('step');
    const rockets = await definition('rockets');
    expect(rockets).toMatchObject({ singular: 'Rocket', plural: 'Rockets', custom: true });
    const [rocket] = await records('rockets');
    const [company] = await records('companies');
    const thrust = rockets.properties.find((item) => item.label === 'Thrust');
    const link = rockets.properties.find((item) => item.type === 'reference' && item.referenceObjectId === 'companies');
    expect(rocket?.properties).toMatchObject({ name: 'Mark IV', [thrust?.id ?? '']: 9000, [link?.id ?? '']: company?.id });
  });

  it('takes a step someone adds, with its own mapping', async () => {
    await crm.call(MAYA, 'objects.create', { singular: 'Ticket', plural: 'Tickets', icon: 'ticket' });
    hubspot.add('tickets', { subject: 'Anvil arrived dented', hs_ticket_priority: 'HIGH' }, { id: 't1', associations: { contacts: ['p1'] } });
    const planned = await plan();
    const added = await crm.call<MigrationRun>(MAYA, 'migrations.addStep', {
      runId: planned.id,
      title: 'Support tickets',
      spec: { kind: 'records', from: 'tickets', to: 'tickets', fields: [{ from: 'subject', to: 'name' }], links: [{ from: 'contacts', to: 'contact' }] },
    });
    expect(added.steps.at(-1)).toMatchObject({ title: 'Support tickets', addedBy: MAYA, status: 'waiting' });
    const done = await run('import', planned.id);
    expect(done.status).toBe('done');
    const [ticket] = await records('tickets');
    const wile = (await records('contacts')).find((contact) => contact.properties.email === 'wile@acme.example');
    expect(ticket?.properties).toMatchObject({ name: 'Anvil arrived dented', contact: wile?.id });
    expect((await definition('tickets')).properties.find((item) => item.id === 'contact')).toMatchObject({ type: 'reference', referenceObjectId: 'contacts' });
  });

  it('places an added step after the one named, and refuses one that makes no sense', async () => {
    const planned = await plan();
    const companies = step(planned, 'Companies');
    const added = await crm.call<MigrationRun>(MAYA, 'migrations.addStep', { runId: planned.id, title: 'Partner fields', afterStepId: companies.id, spec: { kind: 'fields', from: 'companies', to: 'companies' } });
    const titles = added.steps.map((item) => item.title);
    expect(titles.indexOf('Partner fields')).toBe(titles.indexOf('Companies') + 1);
    expect(added.steps.map((item) => item.position)).toEqual(added.steps.map((_, index) => index));
    expect(await refusal(crm.call(MAYA, 'migrations.addStep', { runId: planned.id, title: 'Nowhere', spec: { kind: 'records', from: 'tickets', to: 'no-such-object' } }))).toMatch(/no-such-object/);
  });

  it('skips a step, puts it back, removes one, and never skips a step that must succeed', async () => {
    const planned = await plan();
    const change = (title: string, action: string) => crm.call<MigrationRun>(MAYA, 'migrations.changeStep', { runId: planned.id, stepId: step(planned, title).id, action });
    expect(step(await change('Deals', 'skip'), 'Deals').status).toBe('skipped');
    expect(step(await change('Deals', 'restore'), 'Deals').status).toBe('waiting');
    await change('Deals', 'skip');
    expect((await change('Meetings', 'remove')).steps.some((item) => item.title === 'Meetings')).toBe(false);
    expect(await refusal(change('Contacts', 'skip'))).toMatch(/must/i);
    const done = await run('import', planned.id);
    expect(done.status).toBe('done');
    expect(await records('deals')).toEqual([]);
    expect((await records('contacts')).length).toBe(2);
  });

  it('lets an admin look at the account, and nobody else', async () => {
    const planned = await plan();
    const seen = await crm.call<{ results: unknown[] }>(MAYA, 'migrations.peek', { runId: planned.id, path: '/crm/v3/owners' });
    expect(seen.results).toHaveLength(2);
    expect(await refusal(crm.call(JONAS, 'migrations.peek', { runId: planned.id, path: '/crm/v3/owners' }))).toMatch(/can't/i);
  });
});

describe('activity history', () => {
  beforeEach(fill);

  it('logs notes, calls, emails and meetings on every record they were about, at the time they happened', async () => {
    hubspot.add('notes', { hs_note_body: '<p>Wants <b>bulk</b> pricing.</p>', hs_timestamp: '2025-02-03T14:00:00.000Z', hubspot_owner_id: '501' }, { id: 'n1', associations: { contacts: ['p1'], deals: ['d1'] } });
    hubspot.add('calls', { hs_call_title: 'Intro call', hs_call_body: 'Talked through delivery.', hs_timestamp: '2025-02-04T09:00:00.000Z' }, { id: 'k1', associations: { contacts: ['p1'] } });
    hubspot.add('emails', { hs_email_subject: 'Quote attached', hs_email_text: 'Here is the quote.', hs_timestamp: '2025-02-05T09:00:00.000Z' }, { id: 'e1', associations: { contacts: ['p1'] } });
    hubspot.add('meetings', { hs_meeting_title: 'Site visit', hs_meeting_body: 'Walked the warehouse.', hs_meeting_start_time: '2025-02-06T09:00:00.000Z', hs_timestamp: '2025-02-06T09:00:00.000Z' }, { id: 'm1', associations: { companies: ['c1'] } });
    hubspot.add('notes', { hs_note_body: 'About nothing', hs_timestamp: '2025-02-03T14:00:00.000Z' }, { id: 'n2' });
    const done = await run();
    expect(done.status).toBe('done');
    const wile = (await records('contacts')).find((contact) => contact.properties.email === 'wile@acme.example');
    const [deal] = await records('deals');
    const [company] = await records('companies');
    const logged = await crm.rows<{ record: string; kind: string; title: string; body: string; actor: string; at: string }>(sql`select record_id as record, kind, title, body, actor_id as actor, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD') as at from activities order by occurred_at, record_id`);
    expect(logged.filter((item) => item.kind === 'note').map((item) => item.record).sort()).toEqual([wile?.id, deal?.id].sort());
    expect(logged.find((item) => item.kind === 'note')).toMatchObject({ body: 'Wants bulk pricing.', actor: PRIYA, at: '2025-02-03' });
    expect(logged.find((item) => item.kind === 'call')).toMatchObject({ record: wile?.id, title: 'Intro call', body: 'Talked through delivery.' });
    expect(logged.find((item) => item.kind === 'email')).toMatchObject({ record: wile?.id, title: 'Quote attached' });
    expect(logged.find((item) => item.kind === 'meeting')).toMatchObject({ record: company?.id, title: 'Site visit', at: '2025-02-06' });
    // A note about nothing that came across has nowhere to go.
    expect(step(done, 'Notes').counts).toMatchObject({ read: 2, created: 2, skipped: 1 });

    // Run again: the history is not logged twice.
    await run();
    expect(await crm.rows(sql`select 1 from activities`)).toHaveLength(logged.length);
  });
});

describe('tasks', () => {
  beforeEach(fill);

  it('come across as tasks, done or not, on what they were about', async () => {
    hubspot.add('tasks', { hs_task_subject: 'Send the anvil quote', hs_task_status: 'COMPLETED', hs_task_priority: 'HIGH', hs_task_type: 'CALL', hs_timestamp: '2026-11-20T09:00:00.000Z', hubspot_owner_id: '501' }, { id: 'tk1', associations: { contacts: ['p1'], deals: ['d1'] } });
    hubspot.add('tasks', { hs_task_subject: 'Chase the signature', hs_task_status: 'NOT_STARTED' }, { id: 'tk2' });
    const done = await run();
    expect(done.status).toBe('done');
    const [chase, send] = await records('tasks');
    const wile = (await records('contacts')).find((contact) => contact.properties.email === 'wile@acme.example');
    const [deal] = await records('deals');
    expect(send?.properties).toMatchObject({ name: 'Send the anvil quote', status: 'done', priority: 'high', type: 'call', dueDate: '2026-11-20', owner: PRIYA, contact: wile?.id, deal: deal?.id });
    expect(chase?.properties).toMatchObject({ name: 'Chase the signature', status: 'open' });
    // No choices were invented for what HubSpot calls its statuses.
    expect((await definition('tasks')).properties.find((item) => item.id === 'status')?.options?.map((option) => option.id)).toEqual(['open', 'done']);
  });
});

describe('a model looking at the account', () => {
  // A stand-in model: it answers with whatever the test lined up, and keeps what it was shown.
  let answers: unknown[] = [];
  const heard: AIMessage[][] = [];
  const scripted = {
    async generate(messages: AIMessage[]) {
      heard.push(messages);
      const base = { usage: { inputTokens: 300, outputTokens: 80, totalTokens: 380 }, model: 'scripted', latencyMs: 1, content: '' };
      return answers.length > 0 ? { ...base, toolCalls: [{ id: `c${heard.length}`, name: 'assess', arguments: answers.shift() }] } : { ...base, content: 'I have nothing.' };
    },
  } as unknown as AIAdapter;
  registerModelProvider({ id: 'scripted-mover', label: 'Scripted', hint: '', needsKey: false, needsBaseUrl: false, defaultModel: 'scripted', create: () => scripted });

  const tickets = { kind: 'step', title: 'Support tickets', why: 'The account has tickets with a custom severity field.', object: { singular: 'Ticket', plural: 'Tickets' }, spec: { kind: 'records', from: 'tickets', to: 'tickets', fields: [{ from: 'subject', to: 'name' }], links: [{ from: 'contacts', to: 'contact' }] } };
  const workflow = { kind: 'setup', title: 'Welcome new customers', why: 'A workflow called "Welcome new customers" is in use.', prompt: 'Create a workflow that sends the welcome email when a deal is won.' };
  const quotes = { kind: 'build', title: 'Quotes', why: 'The account has 3 quotes.', brief: 'A quote that belongs to a deal, with line items and a status, shown on the deal page.' };

  beforeEach(() => {
    fill();
    heard.length = 0;
    hubspot.properties.tickets = [{ name: 'subject', label: 'Subject', type: 'string', fieldType: 'text', hubspotDefined: true }, { name: 'severity', label: 'Severity', type: 'enumeration', fieldType: 'select', options: [{ label: 'Minor', value: 'minor' }, { label: 'Major', value: 'major' }] }];
    hubspot.add('tickets', { subject: 'Anvil arrived dented', severity: 'major' }, { id: 't1', associations: { contacts: ['p1'] } });
    hubspot.add('quotes', { hs_title: 'Anvils, bulk: quote 1' });
    hubspot.setup['/automation/v4/flows'] = [{ name: 'Welcome new customers' }];
  });
  const connect = () => crm.call(MAYA, 'assistant.saveSettings', { provider: 'scripted-mover', model: 'scripted' });

  it('is not needed for the plan, and says what is missing when asked without one', async () => {
    const planned = await plan();
    expect(planned.assessment).toBeNull();
    expect(await refusal(crm.call(MAYA, 'migrations.assess', planned.id))).toMatch(/model/i);
    expect((await run('import', planned.id)).status).toBe('done');
  });

  it('is shown what else the account has, and puts forward additions without changing the plan', async () => {
    await connect();
    const planned = await plan();
    answers = [{ summary: 'Beyond the usual, this account runs support tickets, quotes and one workflow.', proposals: [tickets, workflow, quotes] }];
    const assessed = await crm.call<MigrationRun>(MAYA, 'migrations.assess', planned.id);
    expect(assessed.assessment?.found.map((item) => item.area)).toEqual(['tickets', 'quotes', 'workflows']);
    expect(assessed.assessment?.found[0]).toMatchObject({ count: 1, examples: ['Anvil arrived dented'] });
    expect(assessed.assessment?.found[0]?.fields).toContain('severity');
    const shown = heard[0]?.map((message) => String(message.content)).join('\n') ?? '';
    expect(shown).toContain('tickets');
    expect(shown).toContain('Welcome new customers');
    expect(shown).toContain('lifecycleStage');
    // It is never shown the key, or the contacts themselves.
    expect(shown).not.toContain(KEY);
    expect(shown).not.toContain('wile@acme.example');
    expect(assessed.assessment?.proposals.map((item) => [item.proposal.kind, item.status])).toEqual([['step', 'proposed'], ['setup', 'proposed'], ['build', 'proposed']]);
    expect(assessed.steps.map((item) => item.title)).toEqual(planned.steps.map((item) => item.title));
    expect(await crm.rows(sql`select 1 from assistant_turns where question like 'Assess%'`)).toHaveLength(1);
  });

  it('adds the steps, and the object they need, only when a proposal is accepted', async () => {
    await connect();
    const planned = await plan();
    answers = [{ summary: 'Tickets, quotes and a workflow.', proposals: [tickets, workflow, quotes] }];
    const assessed = await crm.call<MigrationRun>(MAYA, 'migrations.assess', planned.id);
    const [step, setup, build] = assessed.assessment?.proposals ?? [];
    expect(await definition('tickets')).toBeUndefined();

    const accepted = await crm.call<MigrationRun>(MAYA, 'migrations.decide', { runId: planned.id, proposalId: step?.id, accept: true });
    expect(accepted.steps.slice(-2).map((item) => item.title)).toEqual(['Ticket fields', 'Support tickets']);
    expect(accepted.steps.at(-1)?.addedBy).toBe(MAYA);
    expect(await definition('tickets')).toMatchObject({ plural: 'Tickets', custom: true });
    await crm.call(MAYA, 'migrations.decide', { runId: planned.id, proposalId: setup?.id, accept: true });
    const decided = await crm.call<MigrationRun>(MAYA, 'migrations.decide', { runId: planned.id, proposalId: build?.id, accept: false });
    expect(decided.assessment?.proposals.map((item) => item.status)).toEqual(['accepted', 'accepted', 'dismissed']);
    expect(await refusal(crm.call(MAYA, 'migrations.decide', { runId: planned.id, proposalId: step?.id, accept: true }))).toMatch(/already/i);
    expect(await refusal(crm.call(JONAS, 'migrations.decide', { runId: planned.id, proposalId: build?.id, accept: true }))).toMatch(/can't/i);

    const done = await run('import', planned.id);
    expect(done.status).toBe('done');
    // What to build can still be decided once the move is over.
    expect((await crm.call<MigrationRun>(MAYA, 'migrations.decide', { runId: planned.id, proposalId: build?.id, accept: true })).assessment?.proposals[2]?.status).toBe('accepted');
    const [ticket] = await records('tickets');
    const wile = (await records('contacts')).find((contact) => contact.properties.email === 'wile@acme.example');
    const severity = (await definition('tickets')).properties.find((item) => item.label === 'Severity');
    expect(ticket?.properties).toMatchObject({ name: 'Anvil arrived dented', contact: wile?.id, [severity?.id ?? '']: 'major' });
  });

  it('is told when what it proposes cannot work, and is asked again', async () => {
    await connect();
    const planned = await plan();
    answers = [
      { summary: 'Contacts again.', proposals: [{ ...tickets, spec: { kind: 'records', from: 'contacts', to: 'contacts' } }] },
      { summary: 'Tickets.', proposals: [{ ...tickets, spec: { ...tickets.spec, fields: [{ from: 'subject', to: 'headline' }] } }] },
      { summary: 'Tickets.', proposals: [tickets] },
    ];
    const assessed = await crm.call<MigrationRun>(MAYA, 'migrations.assess', planned.id);
    expect(assessed.assessment?.proposals).toHaveLength(1);
    expect(heard).toHaveLength(3);
    const told = heard[2]?.map((message) => String(message.content)).join('\n') ?? '';
    expect(told).toMatch(/already planned/);
    expect(told).toMatch(/headline/);
  });

  it('keeps what was decided when asked to look again', async () => {
    await connect();
    const planned = await plan();
    answers = [{ summary: 'First look.', proposals: [tickets, quotes] }, { summary: 'Second look.', proposals: [tickets, workflow] }];
    const first = await crm.call<MigrationRun>(MAYA, 'migrations.assess', planned.id);
    await crm.call(MAYA, 'migrations.decide', { runId: planned.id, proposalId: first.assessment?.proposals[1]?.id, accept: false });
    const second = await crm.call<MigrationRun>(MAYA, 'migrations.assess', planned.id);
    expect(second.assessment?.summary).toBe('Second look.');
    expect(second.assessment?.proposals.map((item) => [item.proposal.title, item.status])).toEqual([['Quotes', 'dismissed'], ['Support tickets', 'proposed'], ['Welcome new customers', 'proposed']]);
  });
});
