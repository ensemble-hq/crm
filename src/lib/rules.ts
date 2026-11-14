import type { Filter, ObjectDefinition, PropertyDefinition, PropertyValue } from '../contracts/metadata';
import { FormulaError, evaluateFormula, parseFormula } from './formula';

/**
 * The rules a record has to follow, worked out the same way in the app (to show and hide fields
 * and say what is missing) and on the server (which is what actually enforces them).
 */

const isEmpty = (value: PropertyValue | undefined) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

/** Whether a record's values meet one condition. The same conditions lists are filtered by. */
export function meets(values: Record<string, PropertyValue>, condition: Filter): boolean {
  const actual = values[condition.property] ?? null;
  const expected = condition.value ?? null;
  switch (condition.operator) {
    case 'empty':
      return isEmpty(actual);
    case 'notEmpty':
      return !isEmpty(actual);
    case 'eq':
      return Array.isArray(actual) ? typeof expected === 'string' && actual.includes(expected) : actual === expected;
    case 'neq':
      return Array.isArray(actual) ? !(typeof expected === 'string' && actual.includes(expected)) : actual !== expected;
    case 'in':
      return Array.isArray(expected) && typeof actual === 'string' && expected.includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
    case 'gt':
      return actual !== null && expected !== null && !Array.isArray(actual) && !Array.isArray(expected) && actual > expected;
    case 'lt':
      return actual !== null && expected !== null && !Array.isArray(actual) && !Array.isArray(expected) && actual < expected;
    case 'between':
      return Array.isArray(expected) && typeof actual === 'string' && expected[0] !== undefined && expected[1] !== undefined && actual >= expected[0] && actual <= expected[1];
  }
}

/** Whether a field is shown for a record with these values. */
export function isShown(property: PropertyDefinition, values: Record<string, PropertyValue>): boolean {
  return !property.showWhen || meets(values, property.showWhen);
}

/** Whether a person may type into a field: not one the system sets, and not one worked out by a formula. */
export const isEditable = (property: PropertyDefinition) => !property.system && !property.formula;

/** Works out every computed field of a record from its other values. A formula that no longer makes sense leaves its field empty. */
export function compute(object: ObjectDefinition, values: Record<string, PropertyValue>): Record<string, PropertyValue> {
  const result: Record<string, PropertyValue> = {};
  const ids = object.properties.map((property) => property.id);
  for (const property of object.properties) {
    if (!property.formula) continue;
    try {
      result[property.id] = evaluateFormula(parseFormula(property.formula, ids), { ...values, ...result });
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      result[property.id] = null;
    }
  }
  return result;
}

/**
 * What is wrong with a record as it would be after a change, in words, or nothing. `before` is the
 * record as it stands (absent when it is being created); `after` is every value it would then have.
 */
export function problemWith(object: ObjectDefinition, before: Record<string, PropertyValue> | undefined, after: Record<string, PropertyValue>): string | undefined {
  for (const property of object.properties) {
    if (!isEditable(property) || !property.requiredWhen || !isShown(property, after)) continue;
    if (meets(after, property.requiredWhen) && isEmpty(after[property.id])) return `${property.label} is required here.`;
  }
  const board = object.board;
  const stages = board ? (object.properties.find((property) => property.id === board.groupBy)?.options ?? []) : [];
  const stage = board ? after[board.groupBy] : undefined;
  if (!board || typeof stage !== 'string') return undefined;
  const moved = before === undefined || before[board.groupBy] !== stage;
  const label = stages.find((option) => option.id === stage)?.label ?? stage;
  // Whether it may go there at all comes first; what it needs once there comes second.
  if (board.noSkipping && moved && before !== undefined) {
    // Stages that end the work (won, lost) can be reached from anywhere; going back is always allowed.
    const open = stages.filter((option) => option.tone !== 'success' && option.tone !== 'danger').map((option) => option.id);
    const [from, to] = [open.indexOf(String(before[board.groupBy])), open.indexOf(stage)];
    if (from >= 0 && to > from + 1) return `This ${object.singular.toLowerCase()} cannot skip from ${stages.find((option) => option.id === before[board.groupBy])?.label} straight to ${label}. Move it one stage at a time.`;
  }
  // What a stage needs is checked when a record arrives in it, and whenever one of those fields is cleared while it sits there.
  for (const id of board.required?.[stage] ?? []) {
    const property = object.properties.find((item) => item.id === id);
    if (property && isEmpty(after[id])) return `${property.label} has to be filled in ${moved ? 'before' : 'while'} this ${object.singular.toLowerCase()} is in ${label}.`;
  }
  return undefined;
}
