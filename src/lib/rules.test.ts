import { describe, expect, it } from 'vitest';
import type { ObjectDefinition } from '../contracts/metadata';
import { compute, isEditable, isShown, meets, problemWith, scoreParts } from './rules';

const deals: ObjectDefinition = {
  id: 'deals',
  singular: 'Deal',
  plural: 'Deals',
  icon: 'x',
  primaryProperty: 'name',
  properties: [
    { id: 'name', label: 'Name', type: 'text', group: 'About' },
    { id: 'amount', label: 'Amount', type: 'currency', group: 'About' },
    { id: 'contact', label: 'Primary contact', type: 'reference', group: 'About', referenceObjectId: 'contacts' },
    {
      id: 'stage',
      label: 'Stage',
      type: 'select',
      group: 'About',
      options: [
        { id: 'qualified', label: 'Qualified' },
        { id: 'discovery', label: 'Discovery' },
        { id: 'proposal', label: 'Proposal sent' },
        { id: 'won', label: 'Closed won', tone: 'success' },
        { id: 'lost', label: 'Closed lost', tone: 'danger' },
      ],
    },
    { id: 'lossReason', label: 'Loss reason', type: 'text', group: 'About', showWhen: { property: 'stage', operator: 'eq', value: 'lost' }, requiredWhen: { property: 'stage', operator: 'eq', value: 'lost' } },
    { id: 'double', label: 'Double', type: 'number', group: 'About', formula: 'amount * 2' },
    { id: 'quadruple', label: 'Quadruple', type: 'number', group: 'About', formula: 'double * 2' },
  ],
  views: [],
  board: { groupBy: 'stage', required: { proposal: ['contact'] }, noSkipping: true },
};
const lossReason = deals.properties[4];

describe('conditions', () => {
  it('reads the same conditions lists are filtered by', () => {
    expect(meets({ stage: 'lost' }, { property: 'stage', operator: 'eq', value: 'lost' })).toBe(true);
    expect(meets({ amount: 5 }, { property: 'amount', operator: 'gt', value: 3 })).toBe(true);
    expect(meets({}, { property: 'amount', operator: 'empty' })).toBe(true);
    expect(meets({ tags: ['vip'] }, { property: 'tags', operator: 'eq', value: 'vip' })).toBe(true);
    expect(meets({ stage: 'won' }, { property: 'stage', operator: 'in', value: ['won', 'lost'] })).toBe(true);
    expect(meets({ name: 'Acme Ltd' }, { property: 'name', operator: 'contains', value: 'acme' })).toBe(true);
  });

  it('shows a conditional field only when it applies', () => {
    expect(lossReason && isShown(lossReason, { stage: 'lost' })).toBe(true);
    expect(lossReason && isShown(lossReason, { stage: 'won' })).toBe(false);
  });
});

describe('computed fields', () => {
  it('works each one out, including ones built on another', () => {
    expect(compute(deals, { amount: 10 })).toEqual({ double: 20, quadruple: 40 });
    expect(compute(deals, {})).toEqual({ double: null, quadruple: null });
  });
});

describe('what is wrong with a record', () => {
  it('requires a conditional field only when its condition is met', () => {
    expect(problemWith(deals, { stage: 'qualified' }, { stage: 'lost' })).toMatch(/Loss reason is required/);
    expect(problemWith(deals, { stage: 'qualified' }, { stage: 'lost', lossReason: 'Price' })).toBeUndefined();
    expect(problemWith(deals, undefined, { stage: 'qualified' })).toBeUndefined();
  });

  it('holds a record to what its stage needs', () => {
    expect(problemWith(deals, { stage: 'discovery' }, { stage: 'proposal' })).toMatch(/Primary contact has to be filled in before/);
    expect(problemWith(deals, { stage: 'discovery' }, { stage: 'proposal', contact: 'con_1' })).toBeUndefined();
    expect(problemWith(deals, { stage: 'proposal', contact: 'con_1' }, { stage: 'proposal', contact: null })).toMatch(/while this deal is in Proposal sent/);
  });

  it('moves forward one stage at a time, but back or out freely', () => {
    expect(problemWith(deals, { stage: 'qualified' }, { stage: 'proposal', contact: 'con_1' })).toMatch(/cannot skip from Qualified straight to Proposal sent/);
    expect(problemWith(deals, { stage: 'qualified' }, { stage: 'discovery' })).toBeUndefined();
    expect(problemWith(deals, { stage: 'proposal', contact: 'c' }, { stage: 'qualified', contact: 'c' })).toBeUndefined();
    expect(problemWith(deals, { stage: 'qualified' }, { stage: 'won' })).toBeUndefined();
  });
});

describe('scores', () => {
  const leads: ObjectDefinition = {
    id: 'leads',
    singular: 'Lead',
    plural: 'Leads',
    icon: 'star',
    primaryProperty: 'name',
    properties: [
      { id: 'name', label: 'Name', type: 'text', group: 'About' },
      { id: 'source', label: 'Source', type: 'select', group: 'About', options: [{ id: 'referral', label: 'Referral' }, { id: 'import', label: 'Import' }] },
      { id: 'value', label: 'Value', type: 'currency', group: 'About' },
      { id: 'weighted', label: 'Weighted', type: 'number', group: 'About', formula: 'value / 2' },
      {
        id: 'score',
        label: 'Score',
        type: 'number',
        group: 'About',
        scoring: [
          { points: 30, when: { property: 'source', operator: 'eq', value: 'referral' } },
          { points: 20, when: { property: 'weighted', operator: 'gt', value: 5_000 } },
          { points: -15, when: { property: 'source', operator: 'eq', value: 'import' } },
        ],
      },
    ],
    views: [],
  };
  const score = leads.properties[4];

  it('add up the points of the rules a record meets, counting on computed fields above', () => {
    expect(compute(leads, { source: 'referral', value: 20_000 })).toMatchObject({ weighted: 10_000, score: 50 });
    expect(compute(leads, { source: 'import', value: 1_000 }).score).toBe(-15);
    expect(compute(leads, {}).score).toBe(0);
  });

  it('are not typed into, and say which rules counted', () => {
    if (!score) throw new Error('no score');
    expect(isEditable(score)).toBe(false);
    expect(scoreParts(score, { source: 'referral', weighted: 100 }).map((part) => part.met)).toEqual([true, false, false]);
  });
});
