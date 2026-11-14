import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDefinition } from '../../src/contracts/metadata';
import type { CrmRecord, ImportResult, ListResult, RecordDetail } from '../../src/contracts/records';
import { type Crm, JONAS, MAYA, refusal, startCrm } from './harness';

let crm: Crm;
let deal: string;
const properties = async (id: string) => (await crm.call<RecordDetail>(MAYA, 'records.get', id)).record.properties;
const move = (stage: string, more: Record<string, unknown> = {}) => crm.call<CrmRecord>(MAYA, 'records.update', { id: deal, properties: { stage, ...more } });

beforeAll(async () => {
  crm = await startCrm();
  deal = await crm.seed('deals', { name: 'Ruled', amount: 40_000, probability: 25, stage: 'qualified', owner: MAYA, closeDate: '2026-12-01' });
});

describe('computed fields', () => {
  it('fills in existing records when a formula is added, and keeps them right afterwards', async () => {
    const object = await crm.call<ObjectDefinition>(MAYA, 'properties.create', { objectId: 'deals', label: 'Weighted amount', type: 'currency', group: 'About', formula: 'round(amount * probability / 100)' });
    expect(object.properties.find((property) => property.id === 'weightedAmount')?.formula).toBeDefined();
    expect((await properties(deal)).weightedAmount).toBe(10_000);
    await crm.call(MAYA, 'records.update', { id: deal, properties: { probability: 50 } });
    expect((await properties(deal)).weightedAmount).toBe(20_000);
    const made = await crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'deals', properties: { name: 'Fresh', amount: 1_000, probability: 10, stage: 'qualified' } });
    expect(made.properties.weightedAmount).toBe(100);
  });

  it('cannot be typed over, and can be filtered and sorted on', async () => {
    const typed = await crm.call<CrmRecord>(MAYA, 'records.update', { id: deal, properties: { weightedAmount: 1 } });
    expect(typed.properties.weightedAmount).toBe(20_000);
    const found = await crm.call<ListResult>(MAYA, 'records.list', { objectId: 'deals', filters: [{ property: 'weightedAmount', operator: 'gt', value: 5_000 }], page: 1, pageSize: 10 });
    expect(found.records.map((record) => record.properties.name)).toEqual(['Ruled']);
  });

  it('refuses a formula that does not make sense', async () => {
    const create = (formula: string) => crm.call(MAYA, 'properties.create', { objectId: 'deals', label: `Bad ${formula.length}`, type: 'number', group: 'About', formula });
    expect(await refusal(create('amount * nosuchfield'))).toMatch(/no field with the id "nosuchfield"/);
    expect(await refusal(create('amount * (2'))).toMatch(/missing a "\)"/);
  });

  it('is worked out for imported records too', async () => {
    const result = await crm.call<ImportResult>(MAYA, 'records.import', { objectId: 'deals', rows: [{ name: 'Imported', amount: '40000', probability: '50', stage: 'Proposal sent' }], onMatch: 'skip' });
    expect((await properties(result.created[0] as string)).weightedAmount).toBe(20_000);
  });
});

describe('scores', () => {
  const rules = [
    { points: 40, when: { property: 'amount', operator: 'gt', value: 30_000 } },
    { points: 10, when: { property: 'priority', operator: 'eq', value: 'high' } },
  ];

  it('score existing records when the rules are set, and again when a record or the rules change', async () => {
    await crm.call(MAYA, 'properties.create', { objectId: 'deals', label: 'Deal score', type: 'number', group: 'About', scoring: rules });
    expect((await properties(deal)).dealScore).toBe(40);
    await crm.call(MAYA, 'records.update', { id: deal, properties: { priority: 'high' } });
    expect((await properties(deal)).dealScore).toBe(50);
    await crm.call(MAYA, 'properties.update', { objectId: 'deals', propertyId: 'dealScore', scoring: [{ ...rules[0], points: 5 }] });
    expect((await properties(deal)).dealScore).toBe(5);
    const top = await crm.call<ListResult>(MAYA, 'records.list', { objectId: 'deals', filters: [{ property: 'dealScore', operator: 'gt', value: 0 }], sort: { property: 'dealScore', direction: 'desc' }, page: 1, pageSize: 5 });
    expect(top.records.some((record) => record.id === deal)).toBe(true);
  });

  it('cannot be typed over, and refuse rules that make no sense', async () => {
    expect((await crm.call<CrmRecord>(MAYA, 'records.update', { id: deal, properties: { dealScore: 999 } })).properties.dealScore).toBe(5);
    const create = (more: Record<string, unknown>) => crm.call(MAYA, 'properties.create', { objectId: 'deals', label: `Score ${JSON.stringify(more).length}`, group: 'About', type: 'number', ...more });
    expect(await refusal(create({ type: 'text', scoring: rules }))).toMatch(/Only a number/);
    expect(await refusal(create({ scoring: rules, formula: 'amount * 2' }))).toMatch(/not both/);
    expect(await refusal(create({ scoring: [{ points: 5, when: { property: 'nosuch', operator: 'notEmpty' } }] }))).toMatch(/no property "nosuch"/);
    expect(await refusal(crm.call(MAYA, 'properties.update', { objectId: 'deals', propertyId: 'dealScore', scoring: [{ points: 5, when: { property: 'dealScore', operator: 'gt', value: 1 } }] }))).toMatch(/depend on itself/);
  });

  it('stop being scores when the rules are taken away', async () => {
    const object = await crm.call<ObjectDefinition>(MAYA, 'properties.update', { objectId: 'deals', propertyId: 'dealScore', scoring: null });
    expect(object.properties.find((property) => property.id === 'dealScore')?.scoring).toBeUndefined();
    expect((await crm.call<CrmRecord>(MAYA, 'records.update', { id: deal, properties: { dealScore: 7 } })).properties.dealScore).toBe(7);
  });
});

describe('fields that depend on another', () => {
  it('requires a field only when its condition is met', async () => {
    const lost = { property: 'stage', operator: 'eq', value: 'lost' };
    await crm.call(MAYA, 'properties.create', { objectId: 'deals', label: 'Loss reason', type: 'text', group: 'About', showWhen: lost, requiredWhen: lost });
    expect(await refusal(move('lost'))).toBe('Loss reason is required here.');
    expect((await move('lost', { lossReason: 'Went with a rival' })).properties.stage).toBe('lost');
    await move('qualified');
  });
});

describe('rules for moving through stages', () => {
  it('can only be set by someone who manages settings', async () => {
    expect(await refusal(crm.call(JONAS, 'pipeline.saveRules', { objectId: 'deals', required: {}, noSkipping: true }))).toMatch(/can't change how records move/);
    const object = await crm.call<ObjectDefinition>(MAYA, 'pipeline.saveRules', { objectId: 'deals', required: { proposal: ['contact'] }, noSkipping: true });
    expect(object.board).toMatchObject({ required: { proposal: ['contact'] }, noSkipping: true });
  });

  it('stops a record skipping a stage or arriving without what the stage needs', async () => {
    expect(await refusal(move('proposal'))).toMatch(/cannot skip from Qualified straight to Proposal sent/);
    await move('discovery');
    expect(await refusal(move('proposal'))).toMatch(/Primary contact has to be filled in before/);
    const contact = await crm.seed('contacts', { name: 'Buyer', email: 'buyer@example.com' });
    expect((await move('proposal', { contact })).properties.stage).toBe('proposal');
    expect(await refusal(crm.call(MAYA, 'records.update', { id: deal, properties: { contact: null } }))).toMatch(/while this deal is in Proposal sent/);
  });

  it('always allows going back, and closing from anywhere', async () => {
    expect((await move('qualified')).properties.stage).toBe('qualified');
    expect((await move('won')).properties.stage).toBe('won');
  });

  it('does not hold an import to them, so a migration is never blocked', async () => {
    const result = await crm.call<ImportResult>(MAYA, 'records.import', { objectId: 'deals', rows: [{ name: 'Mid-pipeline', stage: 'Proposal sent' }], onMatch: 'skip' });
    expect(result.created).toHaveLength(1);
  });
});
