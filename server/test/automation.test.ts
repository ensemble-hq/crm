import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CrmRecord, RecordDetail, RelatedGroup } from '../../src/contracts/records';
import type { EnrollResult, Sequence, SequenceDetail } from '../../src/contracts/sequences';
import type { Workflow, WorkflowDetail } from '../../src/contracts/workflows';
import { afterWorkingDays } from '../src/services/sequences/sequences.service';
import { latestSlot } from '../src/services/workflows/timing';
import { AIKO, type Crm, JONAS, MAYA, PRIYA, refusal, startCrm } from './harness';

let crm: Crm;
const contact = (name: string, email: string, more: Record<string, unknown> = {}) => crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'contacts', properties: { name, email, owner: MAYA, ...more } });
const sentTo = async (email: string) => (await crm.rows<{ total: number }>(sql`select count(*)::int as total from messages where direction = 'out' and to_email = ${email}`))[0]?.total ?? 0;
const tasksAbout = async (id: string) => (await crm.call<RelatedGroup[]>(MAYA, 'records.related', id)).find((group) => group.objectId === 'tasks')?.records ?? [];

beforeAll(async () => {
  crm = await startCrm();
});

describe('working days', () => {
  it('skips weekends', () => {
    // Friday 13 November 2026.
    const friday = new Date('2026-11-13T10:00:00Z');
    expect(afterWorkingDays(friday, 1).toISOString().slice(0, 10)).toBe('2026-11-16');
    expect(afterWorkingDays(friday, 5).toISOString().slice(0, 10)).toBe('2026-11-20');
    expect(afterWorkingDays(friday, 0).toISOString()).toBe(friday.toISOString());
  });
});

describe('sequences', () => {
  let sequence: Sequence;
  const steps = [
    { id: 's1', kind: 'email', waitDays: 0, templateId: 'tpl_intro' },
    { id: 's2', kind: 'call', waitDays: 0, title: 'Call to introduce yourself' },
    { id: 's3', kind: 'email', waitDays: 0, templateId: 'tpl_nudge' },
  ];
  const state = async (contactId: string) => (await crm.call<SequenceDetail>(MAYA, 'sequences.get', sequence.id)).enrollments.find((item) => item.contactId === contactId);
  const run = async (times: number) => {
    for (let count = 0; count < times; count += 1) await crm.services.sequences.runDue(crm.system());
  };

  it('needs a template for every email step and words for every task', async () => {
    expect(await refusal(crm.call(MAYA, 'sequences.save', { name: 'Bad', status: 'active', steps: [{ id: 's1', kind: 'email', waitDays: 0 }] }))).toMatch(/Choose a template/);
    expect(await refusal(crm.call(MAYA, 'sequences.save', { name: 'Bad', status: 'active', steps: [{ id: 's1', kind: 'task', waitDays: 0 }] }))).toMatch(/Say what each call or task is/);
    sequence = await crm.call<Sequence>(MAYA, 'sequences.save', { name: 'Three steps', status: 'active', steps });
  });

  it('takes a contact through every step once, with the emails on one thread', async () => {
    const ada = await contact('Ada', 'ada@seq.example');
    const result = await crm.call<EnrollResult>(MAYA, 'sequences.enroll', { sequenceId: sequence.id, contactIds: [ada.id, ada.id, 'nope'] });
    expect(result.enrolled).toBe(1);
    expect(result.skipped.map((item) => item.reason)).toEqual(['Ada is already in this sequence.', 'This contact has no email address.']);
    await run(1);
    expect(await state(ada.id)).toMatchObject({ status: 'active', stepsDone: 1 });
    await run(5);
    expect(await state(ada.id)).toMatchObject({ status: 'finished', stepsDone: 3, nextRunAt: null });
    expect(await sentTo('ada@seq.example')).toBe(2);
    const [threads] = await crm.rows<{ total: number }>(sql`select count(distinct conversation_id)::int as total from messages where to_email = 'ada@seq.example'`);
    expect(threads?.total).toBe(1);
    expect((await tasksAbout(ada.id)).map((task) => task.properties)).toEqual([expect.objectContaining({ name: 'Call to introduce yourself', type: 'call', owner: MAYA })]);
  });

  it('stops for a contact who replies', async () => {
    const bea = await contact('Bea', 'bea@seq.example');
    await crm.call(MAYA, 'sequences.enroll', { sequenceId: sequence.id, contactIds: [bea.id] });
    await run(1);
    await crm.services.mail.receive(crm.system(), 'dev', 'bea-reply', { fromEmail: 'bea@seq.example', subject: 'Re: A quick introduction', text: 'Yes please.' });
    const [arrival] = await crm.rows<{ id: string }>(sql`select id from inbound_emails where provider_message_id = 'bea-reply'`);
    await crm.services.mail.file(crm.system(), arrival?.id ?? '');
    await run(3);
    expect(await state(bea.id)).toMatchObject({ status: 'replied', stepsDone: 1 });
    expect(await sentTo('bea@seq.example')).toBe(1);
  });

  it('does nothing while paused, and carries on when set running again', async () => {
    await crm.call(MAYA, 'sequences.save', { id: sequence.id, name: 'Three steps', status: 'paused', steps });
    const cy = await contact('Cy', 'cy@seq.example');
    await crm.call(MAYA, 'sequences.enroll', { sequenceId: sequence.id, contactIds: [cy.id] });
    await run(2);
    expect(await state(cy.id)).toMatchObject({ status: 'active', stepsDone: 0, nextRunAt: null });
    await crm.call(MAYA, 'sequences.save', { id: sequence.id, name: 'Three steps', status: 'active', steps });
    await run(1);
    expect((await state(cy.id))?.stepsDone).toBe(1);
  });

  it('will not enrol someone who has unsubscribed, and waits when the weekly limit is reached', async () => {
    const dee = await contact('Dee', 'dee@seq.example');
    await crm.call(MAYA, 'email.setPreference', { email: 'dee@seq.example', status: 'unsubscribed' });
    const refused = await crm.call<EnrollResult>(MAYA, 'sequences.enroll', { sequenceId: sequence.id, contactIds: [dee.id] });
    expect(refused.skipped[0]?.reason).toBe('Dee has unsubscribed.');

    const four = await crm.call<Sequence>(MAYA, 'sequences.save', { name: 'Four emails', status: 'active', steps: ['tpl_intro', 'tpl_meeting', 'tpl_nudge', 'tpl_thanks'].map((templateId, index) => ({ id: `s${index}`, kind: 'email', waitDays: 0, templateId })) });
    const eve = await contact('Eve', 'eve@seq.example');
    await crm.call(MAYA, 'sequences.enroll', { sequenceId: four.id, contactIds: [eve.id] });
    await run(6);
    const waiting = (await crm.call<SequenceDetail>(MAYA, 'sequences.get', four.id)).enrollments[0];
    expect(waiting).toMatchObject({ status: 'active', stepsDone: 3 });
    expect(Date.parse(waiting?.nextRunAt ?? '') - Date.now()).toBeGreaterThan(6 * 86_400_000);
    expect(await sentTo('eve@seq.example')).toBe(3);
  });

  it('will not delete a template a sequence still uses', async () => {
    expect(await refusal(crm.call(MAYA, 'templates.delete', 'tpl_intro'))).toMatch(/uses this template/);
  });
});

describe('reports by email', () => {
  const mailTo = (address: string) => crm.rows<{ body: string; from_email: string }>(sql`select payload->>'text' as body, payload->>'fromEmail' as from_email from dev_mail where direction = 'out' and payload->>'toEmail' = ${address} and payload->>'subject' = 'Deals by stage'`);

  it('emails each person the report as their own role sees it, once each time it is due', async () => {
    await crm.seed('deals', { name: 'Hers', amount: 10_000, stage: 'proposal', owner: AIKO });
    await crm.seed('deals', { name: 'His', amount: 5_000, stage: 'proposal', owner: JONAS });
    const settings = { name: 'Deals by stage', objectId: 'deals', measure: { kind: 'sum', property: 'amount' }, groupBy: 'stage', filters: [{ property: 'name', operator: 'in', value: ['Hers', 'His'] }], chart: 'bars' };
    const hour = new Date().getUTCHours();
    expect(await refusal(crm.call(MAYA, 'reports.save', { ...settings, delivery: { every: 'week', hour, to: [MAYA] } }))).toMatch(/day of the week/);
    expect(await refusal(crm.call(MAYA, 'reports.save', { ...settings, delivery: { every: 'day', hour, to: ['usr_nobody'] } }))).toMatch(/members of this CRM/);
    const saved = await crm.call<{ id: string; delivery?: { by?: string } }>(MAYA, 'reports.save', { ...settings, delivery: { every: 'day', hour, to: [MAYA, JONAS] } });
    expect(saved.delivery?.by).toBe(MAYA);
    const reports = crm.services.reports;
    expect(await reports.deliverDue(crm.system())).toBe(0);
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await reports.deliverDue(crm.system(), tomorrow)).toBe(2);
    expect(await reports.deliverDue(crm.system(), tomorrow)).toBe(0);
    const [admin, rep] = await Promise.all([mailTo('maya@northwind.example'), mailTo('jonas@northwind.example')]);
    expect(admin).toHaveLength(1);
    expect(admin[0]?.body).toContain('Total amount: $15,000, from 2 deals.');
    expect(admin[0]?.body).toContain(`/reports/${saved.id}`);
    // A rep does not see another team's deals in the app, so their email does not add them up either.
    expect(rep[0]?.body).toContain('Total amount: $5,000, from 1 deal.');
    expect(rep[0]?.from_email).toBe('maya@northwind.example');
  });
});

describe('workflows', () => {
  let routing: Workflow;
  const handle = (event: Parameters<Crm['services']['runner']['handle']>[1], eventId: string) => crm.services.runner.handle({ ...crm.system(), userId: MAYA }, event, eventId);

  it('can only be set up by someone who manages settings', async () => {
    const settings = { name: 'Share out new contacts', on: true, objectId: 'contacts', trigger: { kind: 'created' }, conditions: [{ property: 'owner', operator: 'empty' }], actions: [{ id: 'a1', kind: 'assign', userIds: [PRIYA, JONAS] }, { id: 'a2', kind: 'create-task', title: 'Call the new lead', dueInDays: 1 }] };
    expect(await refusal(crm.call(JONAS, 'workflows.save', settings))).toMatch(/can't change workflows/);
    expect(await refusal(crm.call(MAYA, 'workflows.save', { ...settings, actions: [] }))).toMatch(/at least one action/);
    routing = await crm.call<Workflow>(MAYA, 'workflows.save', settings);
  });

  it('shares records out in turn, and makes the task for the new owner', async () => {
    const one = await crm.seed('contacts', { name: 'Lead One', email: 'one@lead.example' });
    const two = await crm.seed('contacts', { name: 'Lead Two', email: 'two@lead.example' });
    expect(await handle({ kind: 'created', recordId: one }, 'evt-1')).toBe(1);
    expect(await handle({ kind: 'created', recordId: two }, 'evt-2')).toBe(1);
    const owner = async (id: string) => (await crm.call<RecordDetail>(MAYA, 'records.get', id)).record.properties.owner;
    expect([await owner(one), await owner(two)]).toEqual([PRIYA, JONAS]);
    expect((await tasksAbout(one))[0]?.properties).toMatchObject({ name: 'Call the new lead', owner: PRIYA });
  });

  it('runs once for an event however many times the event is delivered', async () => {
    const three = await crm.seed('contacts', { name: 'Lead Three', email: 'three@lead.example' });
    expect(await handle({ kind: 'created', recordId: three }, 'evt-3')).toBe(1);
    expect(await handle({ kind: 'created', recordId: three }, 'evt-3')).toBe(0);
    expect(await tasksAbout(three)).toHaveLength(1);
    const history = await crm.call<WorkflowDetail>(MAYA, 'workflows.get', routing.id);
    expect(history.workflow.runs).toBe(3);
    expect(history.runs[0]?.steps[0]).toMatch(/^Assigned to /);
  });

  it('leaves alone records that do not meet its conditions, and does nothing when switched off', async () => {
    const owned = await crm.seed('contacts', { name: 'Has Owner', email: 'owned@lead.example', owner: MAYA });
    expect(await handle({ kind: 'created', recordId: owned }, 'evt-4')).toBe(0);
    await crm.call(MAYA, 'workflows.save', { id: routing.id, name: routing.name, on: false, objectId: routing.objectId, trigger: routing.trigger, conditions: routing.conditions, actions: routing.actions });
    const four = await crm.seed('contacts', { name: 'Lead Four', email: 'four@lead.example' });
    expect(await handle({ kind: 'created', recordId: four }, 'evt-5')).toBe(0);
  });

  it('fires on a change to one value, notifies the owner, and records a step that cannot be done', async () => {
    await crm.call(MAYA, 'workflows.save', { name: 'Won', on: true, objectId: 'deals', trigger: { kind: 'changed', property: 'stage', to: 'won' }, conditions: [], actions: [{ id: 'a1', kind: 'notify', message: 'A deal you own was won.' }, { id: 'a2', kind: 'send-email', templateId: 'tpl_thanks' }] });
    const deal = await crm.seed('deals', { name: 'Big one', stage: 'won', owner: JONAS });
    expect(await handle({ kind: 'changed', recordId: deal, changed: { priority: 'high' } }, 'evt-6')).toBe(0);
    expect(await handle({ kind: 'changed', recordId: deal, changed: { stage: 'won' } }, 'evt-7')).toBe(1);
    const notifications = await crm.call<{ notifications: Array<{ message: string }> }>(JONAS, 'notifications.list');
    expect(notifications.notifications[0]?.message).toBe('A deal you own was won.');
    const [run] = await crm.rows<{ status: string; steps: string[] }>(sql`select status, steps from workflow_runs where event_id = 'evt-7'`);
    expect(run?.status).toBe('failed');
    expect(run?.steps[1]).toBe('Stopped: There is no contact to email on this record.');
  });

  it('runs on a schedule for each record that passes then, once per time it is due', async () => {
    const stale = await crm.seed('deals', { name: 'Gone quiet', stage: 'proposal', priority: 'low', owner: PRIYA });
    const other = await crm.seed('deals', { name: 'Not this one', stage: 'proposal', priority: 'medium', owner: PRIYA });
    const hour = new Date().getUTCHours();
    const nudge = await crm.call<Workflow>(MAYA, 'workflows.save', { name: 'Nudge', on: true, objectId: 'deals', trigger: { kind: 'schedule', every: 'day', hour }, conditions: [{ property: 'priority', operator: 'in', value: ['low'] }, { property: 'name', operator: 'contains', value: 'quiet' }], actions: [{ id: 'a1', kind: 'create-task', title: 'Chase this deal', dueInDays: 2 }] });
    expect(await refusal(crm.call(MAYA, 'workflows.save', { name: 'Weekly', on: true, objectId: 'deals', trigger: { kind: 'schedule', every: 'week', hour }, conditions: [], actions: nudge.actions }))).toMatch(/day of the week/);
    const runner = crm.services.runner;
    // Saving it never sets it off for a time already past.
    expect(await runner.scheduled(crm.system())).toBe(0);
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await runner.scheduled(crm.system(), tomorrow)).toBe(1);
    expect(await runner.scheduled(crm.system(), tomorrow)).toBe(0);
    expect(await tasksAbout(stale)).toHaveLength(1);
    expect(await tasksAbout(other)).toHaveLength(0);
    // Missed for days, it runs once when the worker is back, not once per day missed.
    expect(await runner.scheduled(crm.system(), new Date(Date.now() + 5 * 86_400_000))).toBe(1);
    expect(await tasksAbout(stale)).toHaveLength(2);
  });

  it('works out when a schedule was last due', () => {
    // 14 November 2026 is a Saturday.
    const now = new Date('2026-11-14T08:30:00Z');
    expect(latestSlot({ every: 'day', hour: 9 }, now)).toBe('2026-11-13T09:00:00.000Z');
    expect(latestSlot({ every: 'day', hour: 8 }, now)).toBe('2026-11-14T08:00:00.000Z');
    expect(latestSlot({ every: 'week', hour: 9, weekday: 1 }, now)).toBe('2026-11-09T09:00:00.000Z');
    expect(latestSlot({ every: 'week', hour: 9, weekday: 6 }, now)).toBe('2026-11-07T09:00:00.000Z');
    expect(latestSlot({ every: 'week', hour: 8, weekday: 6 }, now)).toBe('2026-11-14T08:00:00.000Z');
  });

  it('runs when another system calls its address, and only for an address made here', async () => {
    const contact = await crm.seed('contacts', { name: 'Signed Up', email: 'signed@up.example', owner: JONAS });
    const hooked = await crm.call<Workflow>(MAYA, 'workflows.save', { name: 'Signed up elsewhere', on: true, objectId: 'contacts', trigger: { kind: 'called' }, conditions: [], actions: [{ id: 'a1', kind: 'notify', message: 'Your contact signed up.' }] });
    const token = hooked.hookUrl?.split('/api/hooks/')[1] ?? '';
    expect(token).toContain(hooked.id);
    // Someone who cannot change workflows is not shown the address.
    expect((await crm.call<Workflow[]>(JONAS, 'workflows.list')).find((item) => item.id === hooked.id)?.hookUrl).toBeUndefined();
    const call = (given: string, body: Record<string, string>) => crm.services.runner.called(crm.system(), given, body);
    await expect(call(`${hooked.id}.not-the-signature`, { recordId: contact })).rejects.toThrow();
    await expect(call('nonsense', { recordId: contact })).rejects.toThrow();
    expect(await call(token, {})).toMatchObject({ ran: false });
    expect(await call(token, { email: 'nobody@up.example' })).toMatchObject({ ran: false });
    expect(await call(token, { email: 'Signed@Up.example', id: 'their-1' })).toEqual({ ran: true });
    expect(await call(token, { email: 'signed@up.example', id: 'their-1' })).toMatchObject({ ran: false, reason: 'This call was already dealt with.' });
    expect(await call(token, { recordId: contact })).toEqual({ ran: true });
    const notifications = await crm.call<{ notifications: Array<{ message: string }> }>(JONAS, 'notifications.list');
    expect(notifications.notifications.filter((item) => item.message === 'Your contact signed up.')).toHaveLength(2);
    // The address of one workflow does not set off another, and a record of another object is not found.
    const deal = await crm.seed('deals', { name: 'Wrong kind', stage: 'proposal' });
    expect(await call(token, { recordId: deal })).toMatchObject({ ran: false });
  });
});
