import { describe, expect, it } from 'vitest';
import { FormulaError, dependsOnToday, evaluateFormula, parseFormula } from './formula';

const fields = ['amount', 'probability', 'closeDate', 'name', 'tags'];
const run = (formula: string, values: Record<string, unknown> = {}) => evaluateFormula(parseFormula(formula, fields), values, '2026-11-14');

describe('formulas', () => {
  it('does arithmetic in the usual order', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('amount * probability / 100', { amount: 40_000, probability: 25 })).toBe(10_000);
    expect(run('-amount + 5', { amount: 3 })).toBe(2);
  });

  it('leaves the answer empty when a number is missing, never zero', () => {
    expect(run('amount * probability', { amount: 100 })).toBeNull();
    expect(run('amount / probability', { amount: 100, probability: 0 })).toBeNull();
  });

  it('compares and chooses', () => {
    expect(run('if(amount >= 100000, "Large", "Small")', { amount: 250_000 })).toBe('Large');
    expect(run('if(amount >= 100000, "Large", "Small")', { amount: 5 })).toBe('Small');
    expect(run('if(empty(name) or amount < 10, "check", "ok")', { amount: 50 })).toBe('check');
    expect(run('not empty(name) and amount = 50', { amount: 50, name: 'A' })).toBe(true);
  });

  it('works with dates and text', () => {
    expect(run('days(today(), closeDate)', { closeDate: '2026-11-20' })).toBe(6);
    expect(run('days(today(), closeDate)', { closeDate: '2026-11-06' })).toBe(-8);
    expect(run('days(today(), closeDate)')).toBeNull();
    expect(run('concat(name, " (", amount, ")")', { name: 'Acme', amount: 5 })).toBe('Acme (5)');
    expect(run('coalesce(name, "Unnamed")')).toBe('Unnamed');
    expect(run('round(amount / 3, 2)', { amount: 10 })).toBe(3.33);
    expect(run('max(amount, 10, 3)', { amount: 7 })).toBe(10);
  });

  it('refuses what it does not understand, in plain words', () => {
    expect(() => parseFormula('amount * nosuch', fields)).toThrow(/no field with the id "nosuch"/);
    expect(() => parseFormula('amount * (2', fields)).toThrow(/missing a "\)"/);
    expect(() => parseFormula('eval(1)', fields)).toThrow(/no function called eval/);
    expect(() => parseFormula('amount ; drop', fields)).toThrow(FormulaError);
    expect(() => parseFormula('if(amount)', fields)).toThrow(/takes 3 values/);
    expect(() => parseFormula('amount amount', fields)).toThrow(/not expected/);
  });

  it('knows which formulas change as days pass', () => {
    expect(dependsOnToday('days(today(), closeDate)')).toBe(true);
    expect(dependsOnToday('amount * 2')).toBe(false);
  });
});
