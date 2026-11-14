import { beforeAll, describe, expect, it } from 'vitest';
import type { ListResult, Workspace } from '../../src/contracts/records';
import { AIKO, type Crm, FEMI, JONAS, MAYA, PRIYA, refusal, startCrm } from './harness';

let crm: Crm;
let jonasDeal: string;
let aikoDeal: string;
let unowned: string;

beforeAll(async () => {
  crm = await startCrm();
  jonasDeal = await crm.seed('deals', { name: 'Jonas deal', owner: JONAS, stage: 'qualified', amount: 100 });
  await crm.seed('deals', { name: 'Priya deal', owner: PRIYA, stage: 'qualified', amount: 200 });
  aikoDeal = await crm.seed('deals', { name: 'Aiko deal', owner: AIKO, stage: 'qualified', amount: 300 });
  unowned = await crm.seed('deals', { name: 'Nobody deal', stage: 'qualified', amount: 400 });
});

const names = async (as: string) => (await crm.call<ListResult>(as, 'records.list', { objectId: 'deals', page: 1, pageSize: 50 })).records.map((record) => record.properties.name).sort();

describe('who sees what', () => {
  it('shows an admin, a manager and a read-only member everything', async () => {
    for (const person of [MAYA, PRIYA, FEMI]) expect(await names(person)).toHaveLength(4);
  });

  it("shows a sales rep their team's records and the ones nobody owns", async () => {
    expect(await names(JONAS)).toEqual(['Jonas deal', 'Nobody deal', 'Priya deal']);
    expect(await names(AIKO)).toEqual(['Aiko deal', 'Nobody deal']);
  });

  it('reports a record someone may not see the same way as one that does not exist', async () => {
    expect(await refusal(crm.call(JONAS, 'records.get', aikoDeal))).toMatch(/not found/);
    expect(await refusal(crm.call(JONAS, 'records.get', 'no_such_record'))).toMatch(/not found/);
  });

  it('applies the same reach to counts, reports and duplicates', async () => {
    const summary = await crm.call<Array<{ count: number }>>(AIKO, 'records.summarize', { objectId: 'deals', groupBy: 'stage', sumProperty: 'amount' });
    expect(summary[0]?.count).toBe(2);
    const report = await crm.call<{ records: number; total: number }>(AIKO, 'reports.run', { name: 'x', objectId: 'deals', measure: { kind: 'sum', property: 'amount' }, filters: [], chart: 'number' });
    expect(report).toMatchObject({ records: 2, total: 700 });
  });

  it('refuses someone who is not a member', async () => {
    expect(await refusal(crm.call('usr_stranger', 'workspace.get'))).toMatch(/do not have access/);
  });
});

describe('who may change what', () => {
  it("lets a sales rep edit their own records and no one else's", async () => {
    await crm.call(JONAS, 'records.update', { id: jonasDeal, properties: { priority: 'high' } });
    const priyaDeal = (await crm.call<ListResult>(JONAS, 'records.list', { objectId: 'deals', search: 'Priya', page: 1, pageSize: 1 })).records[0]?.id;
    expect(await refusal(crm.call(JONAS, 'records.update', { id: priyaDeal, properties: { priority: 'low' } }))).toBe('As Sales rep, you can only edit deals you own.');
    // A record nobody owns is open to anyone who can edit at all.
    await crm.call(JONAS, 'records.update', { id: unowned, properties: { priority: 'low' } });
  });

  it('refuses a read-only member any change, and a rep any delete', async () => {
    expect(await refusal(crm.call(FEMI, 'records.update', { id: jonasDeal, properties: { priority: 'low' } }))).toBe("As Read only, you can't edit deals.");
    expect(await refusal(crm.call(JONAS, 'records.delete', [jonasDeal]))).toBe("As Sales rep, you can't delete deals.");
  });

  it('keeps people management to those allowed it, and always keeps one admin', async () => {
    expect(await refusal(crm.call(JONAS, 'people.invite', { name: 'X', email: 'x@example.com', roleId: 'role_rep', teamId: null }))).toMatch(/can't invite people/);
    expect(await refusal(crm.call(MAYA, 'people.update', { id: MAYA, roleId: 'role_rep' }))).toBe('The workspace needs at least one admin.');
    expect(await refusal(crm.call(MAYA, 'people.deactivate', { id: MAYA, reassignTo: PRIYA }))).toMatch(/deactivate yourself/);
  });
});

describe('viewing as someone else', () => {
  it('gives an admin exactly what that person has, and gives it back', async () => {
    await crm.call(MAYA, 'people.viewAs', AIKO);
    const viewed = await crm.call<Workspace>(MAYA, 'workspace.get');
    expect(viewed.currentUserId).toBe(AIKO);
    expect(viewed.access.viewedBy).toBe(MAYA);
    expect(await names(MAYA)).toEqual(['Aiko deal', 'Nobody deal']);
    await crm.call(MAYA, 'people.viewAs', null);
    expect(await names(MAYA)).toHaveLength(4);
  });

  it('is refused to anyone who cannot manage people', async () => {
    expect(await refusal(crm.call(JONAS, 'people.viewAs', MAYA))).toMatch(/Only an admin/);
  });
});

describe('deactivating a person', () => {
  it('hands their records to someone else and ends their access', async () => {
    const result = await crm.call<{ reassigned: number }>(MAYA, 'people.deactivate', { id: AIKO, reassignTo: PRIYA });
    expect(result.reassigned).toBe(1);
    expect(await refusal(crm.call(AIKO, 'workspace.get'))).toMatch(/do not have access/);
    const workspace = await crm.call<Workspace>(MAYA, 'workspace.get');
    expect(workspace.users.some((user) => user.id === AIKO)).toBe(false);
    expect(workspace.former?.some((user) => user.id === AIKO)).toBe(true);
  });
});
