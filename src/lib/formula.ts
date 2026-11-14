/**
 * Computed fields. A formula is a short expression over a record's other fields, such as
 * `amount * probability / 100` or `if(amount > 50000, "Large", "Standard")`. The app and the server
 * share this file, so a formula is checked the same way where it is typed and where it is saved.
 *
 * It is a closed little language, not code: it can read fields and call the functions below, and
 * nothing else.
 *
 *   numbers 12.5 · text "in quotes" · fields by their id · + - * / · = != > >= < <= · and, or, not
 *   if(test, then, else) · round(n, places) · min(a, b…) · max(a, b…) · abs(n)
 *   days(from, to) whole days between two dates · today() · concat(a, b…) · empty(x) · coalesce(a, b…)
 */

export type FormulaValue = number | string | boolean | null;

type Node =
  | { kind: 'value'; value: FormulaValue }
  | { kind: 'field'; id: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'binary'; operator: string; left: Node; right: Node }
  | { kind: 'not'; operand: Node };

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  if: { min: 3, max: 3 },
  round: { min: 1, max: 2 },
  min: { min: 1, max: 20 },
  max: { min: 1, max: 20 },
  abs: { min: 1, max: 1 },
  days: { min: 2, max: 2 },
  today: { min: 0, max: 0 },
  concat: { min: 1, max: 20 },
  empty: { min: 1, max: 1 },
  coalesce: { min: 1, max: 20 },
};

export class FormulaError extends Error {}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*("(?:[^"\\]|\\.)*"|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|>=|<=|!=|[-+*/()=<>,])/y;
  let position = 0;
  while (position < source.length) {
    if (/^\s*$/.test(source.slice(position))) break;
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match?.[1]) throw new FormulaError(`The formula has something unexpected at "${source.slice(position, position + 12).trim()}".`);
    tokens.push(match[1]);
    position = pattern.lastIndex;
  }
  return tokens;
}

/** Turns a formula into a tree, checking it reads only fields that exist. Throws a `FormulaError` in plain words. */
export function parseFormula(source: string, fields: string[]): Node {
  const tokens = tokenize(source);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const expect = (token: string) => {
    if (take() !== token) throw new FormulaError(`The formula is missing a "${token}".`);
  };

  // Lowest to highest: or, and, comparison, + -, * /, unary.
  const binary = (next: () => Node, operators: string[]) => (): Node => {
    let left = next();
    while (peek() !== undefined && operators.includes(String(peek()).toLowerCase())) {
      const operator = String(take()).toLowerCase();
      left = { kind: 'binary', operator, left, right: next() };
    }
    return left;
  };
  const primary = (): Node => {
    const token = take();
    if (token === undefined) throw new FormulaError('The formula stops before it is finished.');
    if (token === '(') {
      const inner = expression();
      expect(')');
      return inner;
    }
    if (token === '-') return { kind: 'binary', operator: '-', left: { kind: 'value', value: 0 }, right: primary() };
    if (token.toLowerCase() === 'not') return { kind: 'not', operand: primary() };
    if (token.startsWith('"')) return { kind: 'value', value: JSON.parse(token) as string };
    if (/^\d/.test(token)) return { kind: 'value', value: Number(token) };
    if (token.toLowerCase() === 'true' || token.toLowerCase() === 'false') return { kind: 'value', value: token.toLowerCase() === 'true' };
    if (!/^[A-Za-z_]/.test(token)) throw new FormulaError(`"${token}" is not expected there.`);
    if (peek() === '(') {
      const name = token.toLowerCase();
      const known = FUNCTIONS[name];
      if (!known) throw new FormulaError(`There is no function called ${token}. The functions are ${Object.keys(FUNCTIONS).join(', ')}.`);
      take();
      const args: Node[] = [];
      if (peek() !== ')') {
        args.push(expression());
        while (peek() === ',') {
          take();
          args.push(expression());
        }
      }
      expect(')');
      if (args.length < known.min || args.length > known.max) throw new FormulaError(`${name}() takes ${known.min === known.max ? known.min : `${known.min} to ${known.max}`} value${known.max === 1 ? '' : 's'}.`);
      return { kind: 'call', name, args };
    }
    if (!fields.includes(token)) throw new FormulaError(`There is no field with the id "${token}". Use a field's id, such as ${fields.slice(0, 3).join(', ')}.`);
    return { kind: 'field', id: token };
  };
  const product = binary(primary, ['*', '/']);
  const sum = binary(product, ['+', '-']);
  const comparison = binary(sum, ['=', '!=', '>', '>=', '<', '<=']);
  const conjunction = binary(comparison, ['and']);
  const expression: () => Node = binary(conjunction, ['or']);

  const tree = expression();
  if (index < tokens.length) throw new FormulaError(`"${tokens[index]}" is not expected there.`);
  return tree;
}

/** The fields a formula reads, so it cannot be made to read itself. */
export function formulaFields(node: Node): string[] {
  switch (node.kind) {
    case 'field':
      return [node.id];
    case 'call':
      return node.args.flatMap(formulaFields);
    case 'binary':
      return [...formulaFields(node.left), ...formulaFields(node.right)];
    case 'not':
      return formulaFields(node.operand);
    default:
      return [];
  }
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
const number = (value: FormulaValue) => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : null);
const DAY = 86_400_000;

/** Works a formula out for one record. A missing number makes the answer empty, never zero or an error. */
export function evaluateFormula(node: Node, values: Record<string, unknown>, today = new Date().toISOString().slice(0, 10)): FormulaValue {
  const run = (item: Node): FormulaValue => {
    switch (item.kind) {
      case 'value':
        return item.value;
      case 'field': {
        const value = values[item.id];
        return isEmpty(value) ? null : Array.isArray(value) ? value.join(', ') : (value as FormulaValue);
      }
      case 'not':
        return !run(item.operand);
      case 'binary': {
        const left = run(item.left);
        if (item.operator === 'and') return Boolean(left) && Boolean(run(item.right));
        if (item.operator === 'or') return Boolean(left) || Boolean(run(item.right));
        const right = run(item.right);
        if (item.operator === '=') return left === right || (left !== null && right !== null && String(left) === String(right));
        if (item.operator === '!=') return !(left === right || (left !== null && right !== null && String(left) === String(right)));
        if (['>', '>=', '<', '<='].includes(item.operator)) {
          if (left === null || right === null) return false;
          const [a, b] = number(left) !== null && number(right) !== null ? [number(left) as number, number(right) as number] : [String(left), String(right)];
          return item.operator === '>' ? a > b : item.operator === '>=' ? a >= b : item.operator === '<' ? a < b : a <= b;
        }
        const [a, b] = [number(left), number(right)];
        if (a === null || b === null) return null;
        if (item.operator === '+') return a + b;
        if (item.operator === '-') return a - b;
        if (item.operator === '*') return a * b;
        return b === 0 ? null : a / b;
      }
      case 'call': {
        const args = item.args;
        switch (item.name) {
          case 'if':
            return run(args[0] as Node) ? run(args[1] as Node) : run(args[2] as Node);
          case 'today':
            return today;
          case 'empty':
            return isEmpty(run(args[0] as Node));
          case 'coalesce':
            return args.map(run).find((value) => !isEmpty(value)) ?? null;
          case 'concat':
            return args.map((arg) => run(arg) ?? '').join('');
          case 'days': {
            const [from, to] = [run(args[0] as Node), run(args[1] as Node)];
            const [start, end] = [Date.parse(String(from ?? '').slice(0, 10)), Date.parse(String(to ?? '').slice(0, 10))];
            return Number.isNaN(start) || Number.isNaN(end) ? null : Math.round((end - start) / DAY);
          }
          default: {
            const numbers = args.map((arg) => number(run(arg)));
            if (numbers.some((value) => value === null)) return null;
            const given = numbers as number[];
            if (item.name === 'round') return Math.round((given[0] as number) * 10 ** (given[1] ?? 0)) / 10 ** (given[1] ?? 0);
            if (item.name === 'abs') return Math.abs(given[0] as number);
            return item.name === 'min' ? Math.min(...given) : Math.max(...given);
          }
        }
      }
    }
  };
  const result = run(node);
  return typeof result === 'number' && !Number.isFinite(result) ? null : result;
}

/** Whether a formula's answer changes by itself as days pass, so it has to be worked out again each day. */
export const dependsOnToday = (source: string) => /\btoday\s*\(/i.test(source);
