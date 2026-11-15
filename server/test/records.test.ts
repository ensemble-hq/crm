import { beforeAll, describe, expect, it } from 'vitest';
import type { CrmRecord, Duplicates, ImportResult, ListResult, RecordDetail, RelatedGroup } from '../../src/contracts/records';
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
