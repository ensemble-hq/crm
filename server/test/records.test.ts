import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Activity, CrmRecord, DeletedList, Duplicates, ImportResult, ListResult, RecordDetail, RelatedGroup, RestoreResult } from '../../src/contracts/records';
import { type Crm, FEMI, JONAS, MAYA, PRIYA, refusal, startCrm } from './harness';

let crm: Crm;
const list = (query: Record<string, unknown>, as = MAYA) => crm.call<ListResult>(as, 'records.list', { page: 1, pageSize: 50, ...query });

beforeAll(async () => {
  crm = await startCrm();
});

describe('creating and changing records', () => {
  it('requires the name, checks email addresses, and keeps unique values unique', async () => {
    expect(await refusal(crm.call(MAYA, 'records.create', { objectId: 'contacts', properties: { email: 'a@example.com' } }))).toBe('Name is required.');
    expect(await refusal(crm.call(MAYA, 'records.create', { objectId: 'contacts', properties: { name: 'A', email: 'nope' } }))).toMatch(/not an email address/);
    await crm.call(MAYA, 'records.create', { objectId: 'contacts', properties: { name: 'Ada', email: 'ada@example.com' } });
    expect(await refusal(crm.call(MAYA, 'records.create', { objectId: 'contacts', properties: { name: 'Ada Two', email: 'ada@example.com' } }))).toMatch(/Another contact already has email/);
    expect(await refusal(crm.call(MAYA, 'records.create', { objectId: 'contacts', properties: { name: 'B', nosuch: 1 } }))).toMatch(/no property "nosuch"/);
  });

  it('changes only what it is given and clears with null', async () => {
    const made = await crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'contacts', properties: { name: 'Bea', email: 'bea@example.com', jobTitle: 'Buyer' } });
    const changed = await crm.call<CrmRecord>(MAYA, 'records.update', { id: made.id, properties: { jobTitle: null, phone: '555' } });
    expect(changed.properties).toMatchObject({ name: 'Bea', email: 'bea@example.com', jobTitle: null, phone: '555' });
  });

  it('deletes all of a request or none of it', async () => {
    const mine = await crm.seed('deals', { name: 'Mine', owner: PRIYA, stage: 'qualified' });
    const theirs = await crm.seed('deals', { name: 'Theirs', owner: 'usr_dario', stage: 'qualified' });
    expect(await refusal(crm.call(PRIYA, 'records.delete', [mine, theirs]))).toMatch(/only delete your team's deals/);
    expect((await crm.call<RecordDetail>(MAYA, 'records.get', mine)).record.id).toBe(mine);
    expect(await crm.call(MAYA, 'records.delete', [mine, theirs])).toEqual({ deleted: 2 });
    expect(await refusal(crm.call(MAYA, 'records.get', mine))).toMatch(/not found/);
  });
});

describe('finding records', () => {
  beforeAll(async () => {
    const acme = await crm.seed('companies', { name: 'Acme', domain: 'acme.example' });
    const zed = await crm.seed('companies', { name: 'Zed', domain: 'zed.example' });
    await crm.seed('deals', { name: 'Alpha', amount: 500, stage: 'proposal', owner: JONAS, company: zed, closeDate: '2026-12-01', priority: 'high' });
    await crm.seed('deals', { name: 'Bravo', amount: 100, stage: 'qualified', owner: PRIYA, company: acme, closeDate: '2026-11-01', priority: 'low' });
    await crm.seed('deals', { name: 'Charlie', amount: 300, stage: 'won', owner: JONAS, company: acme, closeDate: '2027-01-15' });
    await crm.seed('deals', { name: 'Delta', stage: 'qualified' });
  });
  const found = async (query: Record<string, unknown>) => (await list({ objectId: 'deals', ...query })).records.map((record) => record.properties.name);

  it('filters by every kind of condition', async () => {
    expect(await found({ filters: [{ property: 'amount', operator: 'gt', value: 200 }], sort: { property: 'name', direction: 'asc' } })).toEqual(['Alpha', 'Charlie']);
    expect(await found({ filters: [{ property: 'stage', operator: 'in', value: ['qualified'] }], sort: { property: 'name', direction: 'asc' } })).toEqual(['Bravo', 'Delta']);
    expect(await found({ filters: [{ property: 'owner', operator: 'empty' }] })).toEqual(['Delta']);
    expect(await found({ filters: [{ property: 'owner', operator: 'eq', value: '$me' }], sort: { property: 'name', direction: 'asc' } })).toEqual([]);
    expect(await found({ filters: [{ property: 'closeDate', operator: 'between', value: ['2026-11-15', '2026-12-31'] }] })).toEqual(['Alpha']);
    expect(await found({ filters: [{ property: 'name', operator: 'contains', value: 'RAV' }] })).toEqual(['Bravo']);
    expect(await found({ filters: [{ property: 'priority', operator: 'neq', value: 'high' }], sort: { property: 'name', direction: 'asc' } })).toEqual(['Bravo', 'Charlie', 'Delta']);
  });

  it('resolves "me" to whoever is asking', async () => {
    const mine = await list({ objectId: 'deals', filters: [{ property: 'owner', operator: 'eq', value: '$me' }] }, JONAS);
    expect(mine.records.map((record) => record.properties.name).sort()).toEqual(['Alpha', 'Charlie']);
  });

  it('sorts by what a person sees, with empty values last either way', async () => {
    expect(await found({ sort: { property: 'amount', direction: 'desc' } })).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta']);
    expect(await found({ sort: { property: 'amount', direction: 'asc' } })).toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']);
    // Stages sort in pipeline order, not alphabetically; a linked company sorts by its name.
    expect((await found({ sort: { property: 'stage', direction: 'asc' } })).slice(-2)).toEqual(['Alpha', 'Charlie']);
    expect((await found({ sort: { property: 'company', direction: 'desc' } }))[0]).toBe('Alpha');
  });

  it('searches names and pages through results with a total', async () => {
    expect(await found({ search: 'char' })).toEqual(['Charlie']);
    const page = await crm.call<ListResult>(MAYA, 'records.list', { objectId: 'deals', sort: { property: 'name', direction: 'asc' }, page: 2, pageSize: 3 });
    expect(page.total).toBe(4);
    expect(page.records.map((record) => record.properties.name)).toEqual(['Delta']);
  });

  it('names the records a list links to, and lists what is related', async () => {
    const result = await list({ objectId: 'deals', search: 'Alpha' });
    const company = String(result.records[0]?.properties.company);
    expect(result.references[company]).toEqual({ objectId: 'companies', label: 'Zed' });
    const related = await crm.call<RelatedGroup[]>(MAYA, 'records.related', company);
    expect(related.find((group) => group.objectId === 'deals')?.total).toBe(1);
  });
});

describe('importing', () => {
  it('turns text into values, matches what is already there, and explains every row it leaves out', async () => {
    await crm.seed('companies', { name: 'Importco', domain: 'importco.example' });
    const existing = await crm.seed('contacts', { name: 'Old Name', email: 'known@example.com', owner: MAYA });
    const rows = [
      { name: 'New One', email: 'new.one@example.com', company: 'Importco', owner: 'Priya Raman', lifecycleStage: 'Customer', marketingConsent: 'yes' },
      { name: 'Odd', email: 'odd@example.com', lifecycleStage: 'Nonsense' },
      { name: 'Odd again', email: 'ODD@example.com' },
      { name: 'Bad', email: 'not-an-email' },
      { name: '', email: 'noname@example.com' },
      { name: 'Old Name', email: 'known@example.com', jobTitle: 'Updated title' },
    ];
    const request = { objectId: 'contacts', rows, matchOn: 'email', onMatch: 'update' };
    const dry = await crm.call<ImportResult>(MAYA, 'records.import', { ...request, dryRun: true });
    expect(dry).toMatchObject({ created: ['row_1', 'row_2'], updated: 1 });
    expect(dry.skipped.map((row) => row.row)).toEqual([3, 4, 5]);
    expect(dry.warnings[0]?.message).toMatch(/"Nonsense" was not understood/);
    expect((await list({ objectId: 'contacts', search: 'new.one' })).total).toBe(0);

    const done = await crm.call<ImportResult>(MAYA, 'records.import', request);
    expect(done.created).toHaveLength(2);
    const made = (await list({ objectId: 'contacts', search: 'new.one' })).records[0];
    expect(made?.properties).toMatchObject({ owner: PRIYA, lifecycleStage: 'customer', marketingConsent: true });
    expect((await crm.call<RecordDetail>(MAYA, 'records.get', existing)).record.properties.jobTitle).toBe('Updated title');
    // Importing the same file again makes nothing new.
    expect((await crm.call<ImportResult>(MAYA, 'records.import', { ...request, onMatch: 'skip' })).created).toHaveLength(0);
  });

  it('does not let an import change what the person could not change by hand', async () => {
    const result = await crm.call<ImportResult>(FEMI, 'records.import', { objectId: 'contacts', rows: [{ name: 'Old Name', email: 'known@example.com', jobTitle: 'Sneaky' }], matchOn: 'email', onMatch: 'update' });
    expect(result.updated).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(/can't edit contacts/);
  });
});

describe('duplicates and merging', () => {
  it('finds records sharing an email, ignoring capitals and spaces', async () => {
    await crm.seed('contacts', { name: 'Dana', email: 'dana@dup.example' });
    await crm.seed('contacts', { name: 'D. Dup', email: ' DANA@dup.example' });
    const found = await crm.call<Duplicates>(MAYA, 'records.duplicates', { objectId: 'contacts' });
    expect(found.property).toBe('email');
    expect(found.groups.find((group) => group.value === 'dana@dup.example')?.count).toBe(2);
  });

  it('moves everything onto the kept record and removes the other', async () => {
    const keep = await crm.seed('contacts', { name: 'Keep', email: 'keep@example.com', owner: MAYA });
    const other = await crm.seed('contacts', { name: 'Other', email: 'other@example.com', phone: '555-1', owner: MAYA });
    const task = await crm.seed('tasks', { name: 'Call them', contact: other, status: 'open', owner: MAYA });
    await crm.call(MAYA, 'activity.create', { recordId: other, kind: 'note', title: 'Note', body: 'On the other' });
    const merged = await crm.call<CrmRecord>(MAYA, 'records.merge', { keepId: keep, mergeId: other, properties: { email: 'other@example.com', phone: '555-1' } });
    expect(merged.properties).toMatchObject({ name: 'Keep', email: 'other@example.com', phone: '555-1' });
    expect(await refusal(crm.call(MAYA, 'records.get', other))).toMatch(/not found/);
    expect((await crm.call<RecordDetail>(MAYA, 'records.get', task)).record.properties.contact).toBe(keep);
    const activity = await crm.call<Array<{ title: string; body?: string }>>(MAYA, 'activity.list', keep);
    expect(activity.map((item) => item.body ?? item.title)).toEqual(expect.arrayContaining(['On the other', 'Merged with Other']));
  });
});

describe('people on a deal', () => {
  it('keeps who is involved and their part, and shows the deal on each of them', async () => {
    const make = async (objectId: string, properties: Record<string, unknown>) => (await crm.call<CrmRecord>(MAYA, 'records.create', { objectId, properties })).id;
    const deal = await make('deals', { name: 'Many voices', stage: 'qualified', owner: MAYA });
    const boss = await make('contacts', { name: 'Dana Decider', email: 'dana@voices.example', owner: MAYA });
    const fan = await make('contacts', { name: 'Chen Champion', email: 'chen@voices.example', owner: MAYA });
    const save = (people: Array<{ contactId: string; role: string }>) => crm.call<{ people: Array<{ contactId: string; role: string }>; references: Record<string, { label: string }> }>(MAYA, 'dealPeople.save', { dealId: deal, people });
    expect(await refusal(save([{ contactId: boss, role: 'champion' }, { contactId: boss, role: 'blocker' }]))).toMatch(/once/);
    expect(await refusal(save([{ contactId: deal, role: 'champion' }]))).toMatch(/Only contacts/);
    const saved = await save([{ contactId: boss, role: 'decision-maker' }, { contactId: fan, role: 'champion' }]);
    expect(saved.people.map((person) => person.role)).toEqual(['decision-maker', 'champion']);
    expect(saved.references[fan]?.label).toBe('Chen Champion');
    const dealsOf = async (contactId: string) => (await crm.call<Array<{ objectId: string; records: CrmRecord[] }>>(MAYA, 'records.related', contactId)).find((group) => group.objectId === 'deals')?.records.map((record) => record.id);
    expect(await dealsOf(fan)).toEqual([deal]);
    // Someone deleted drops off the list; the others stay.
    await crm.call(MAYA, 'records.delete', [fan]);
    expect((await crm.call<{ people: unknown[] }>(MAYA, 'dealPeople.list', deal)).people).toEqual([{ contactId: boss, role: 'decision-maker' }]);
  });
});

describe('segments built by hand', () => {
  it('adds many records to a segment and takes them out, leaving their other choices alone', async () => {
    const make = async (name: string, more: Record<string, unknown> = {}) => (await crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'contacts', properties: { name, email: `${name.toLowerCase().replace(/ /g, '.')}@segment.example`, owner: MAYA, ...more } })).id;
    const [one, two, three] = [await make('Seg One', { segments: ['beta'] }), await make('Seg Two'), await make('Seg Three', { owner: FEMI })];
    const label = (as: string, more: Record<string, unknown>) => crm.call<{ changed: number; unchanged: number; skipped: number }>(as, 'records.label', { objectId: 'contacts', property: 'segments', ...more });
    expect(await refusal(label(MAYA, { ids: [one], add: ['no-such-segment'] }))).toMatch(/no choice "no-such-segment"/);
    expect(await refusal(label(MAYA, { ids: [one], property: 'name', add: ['x'] }))).toMatch(/several choices/);
    expect(await label(MAYA, { ids: [one, two], add: ['newsletter'] })).toEqual({ changed: 2, unchanged: 0, skipped: 0 });
    expect(await label(MAYA, { ids: [one, two], add: ['newsletter'] })).toEqual({ changed: 0, unchanged: 2, skipped: 0 });
    const segments = async (id: string) => (await crm.call<RecordDetail>(MAYA, 'records.get', id)).record.properties.segments;
    expect(await segments(one)).toEqual(['beta', 'newsletter']);
    // Everything a list shows, by its filters: the segment can then be found by filtering on it.
    expect(await label(MAYA, { filters: [{ property: 'email', operator: 'contains', value: '@segment.example' }], add: ['spring-event'] })).toMatchObject({ changed: 3 });
    expect((await list({ objectId: 'contacts', filters: [{ property: 'segments', operator: 'eq', value: 'spring-event' }] })).total).toBe(3);
    expect(await label(MAYA, { ids: [one], remove: ['beta', 'spring-event'] })).toMatchObject({ changed: 1 });
    expect(await segments(one)).toEqual(['newsletter']);
    // Someone who cannot edit a record leaves it as it is, and is told how many were passed over.
    const asRep = await label(JONAS, { ids: [three, two], add: ['beta'] });
    expect(asRep.skipped + asRep.changed).toBeLessThanOrEqual(2);
    expect(asRep.skipped).toBeGreaterThanOrEqual(1);
    expect(await segments(three)).toEqual(['spring-event']);
  });
});

describe('repeating tasks', () => {
  it('puts a finished task back on the list for next time, once', async () => {
    const task = await crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'tasks', properties: { name: 'Check in with the account', status: 'open', owner: MAYA, repeat: 'weekly', dueDate: '2099-01-05', priority: 'high' } });
    const mine = async () => (await list({ objectId: 'tasks', filters: [{ property: 'name', operator: 'eq', value: 'Check in with the account' }], sort: { property: 'dueDate', direction: 'asc' } })).records;
    await crm.call(MAYA, 'records.update', { id: task.id, properties: { priority: 'low' } });
    expect(await mine()).toHaveLength(1);
    await crm.call(MAYA, 'records.update', { id: task.id, properties: { status: 'done' } });
    const after = await mine();
    expect(after.map((item) => [item.properties.status, item.properties.dueDate])).toEqual([['done', '2099-01-05'], ['open', '2099-01-12']]);
    expect(after[1]?.properties).toMatchObject({ owner: MAYA, repeat: 'weekly', priority: 'low' });
    // Saving it again as done does not make another.
    await crm.call(MAYA, 'records.update', { id: task.id, properties: { status: 'done' } });
    expect(await mine()).toHaveLength(2);
  });
});

describe('deleted records', () => {
  it('can be listed and restored by an admin, as they were, without setting anything off', async () => {
    const id = await crm.seed('contacts', { name: 'Gone Girl', email: 'gone@example.com', owner: JONAS });
    await crm.call(JONAS, 'activity.create', { recordId: id, kind: 'note', title: 'Note', body: 'Remember me.' });
    await crm.call(PRIYA, 'records.delete', [id]);
    expect(await refusal(crm.call(MAYA, 'records.get', id))).toBeTruthy();
    expect(await refusal(crm.call(JONAS, 'records.deleted', { objectId: 'contacts', page: 1, pageSize: 10 }))).toMatch(/see deleted records/);
    const listed = await crm.call<DeletedList>(MAYA, 'records.deleted', { objectId: 'contacts', page: 1, pageSize: 10 });
    expect(listed.records.find((record) => record.id === id)).toMatchObject({ name: 'Gone Girl', deletedBy: PRIYA });

    const outboxBefore = await crm.rows<{ total: number }>(sql`select count(*)::int as total from mariachi_event_outbox where envelope::text like ${`%${id}%`} and envelope::text like '%"origin": "person"%'`);
    expect(await refusal(crm.call(JONAS, 'records.restore', [id]))).toMatch(/restore deleted records/);
    expect(await crm.call<RestoreResult>(MAYA, 'records.restore', [id, 'nope'])).toEqual({ restored: 1, skipped: [{ id: 'nope', reason: 'It is not among the deleted records.' }] });
    const back = await crm.call<RecordDetail>(MAYA, 'records.get', id);
    expect(back.record.properties).toMatchObject({ name: 'Gone Girl', email: 'gone@example.com' });
    expect((await crm.call<Activity[]>(MAYA, 'activity.list', id)).some((activity) => activity.body === 'Remember me.')).toBe(true);
    expect((await crm.call<DeletedList>(MAYA, 'records.deleted', { objectId: 'contacts', page: 1, pageSize: 10 })).records.some((record) => record.id === id)).toBe(false);
    // Coming back is announced as a restore, which workflows ignore.
    expect(await crm.rows<{ total: number }>(sql`select count(*)::int as total from mariachi_event_outbox where envelope::text like ${`%${id}%`} and envelope::text like '%"origin": "person"%'`)).toEqual(outboxBefore);
  });

  it('are left deleted when bringing them back would clash, and a merged record is not offered', async () => {
    const first = await crm.seed('contacts', { name: 'Twin One', email: 'twin@example.com', owner: MAYA });
    await crm.call(MAYA, 'records.delete', [first]);
    const second = await crm.seed('contacts', { name: 'Twin Two', email: 'twin@example.com', owner: MAYA });
    const result = await crm.call<RestoreResult>(MAYA, 'records.restore', [first]);
    expect(result.restored).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(/now has email "twin@example.com"/);

    const spare = await crm.seed('contacts', { name: 'Twin Spare', email: 'spare@example.com', owner: MAYA });
    await crm.call(MAYA, 'records.merge', { keepId: second, mergeId: spare, properties: {} });
    const listed = await crm.call<DeletedList>(MAYA, 'records.deleted', { objectId: 'contacts', page: 1, pageSize: 50 });
    expect(listed.records.some((record) => record.id === spare)).toBe(false);
    expect((await crm.call<RestoreResult>(MAYA, 'records.restore', [spare])).restored).toBe(0);
  });
});
