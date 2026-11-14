import { ValidationError } from '@mariachi/core';
import { type SQL, sql } from 'drizzle-orm';
import type { Filter, ObjectDefinition, PropertyDefinition, PropertyValue, Sort } from '../../../../src/contracts/metadata';

/**
 * Turns the CRM's filters, search and sorting into SQL over the `properties` JSONB column. Property
 * ids are checked against the object's definition before they reach a query.
 */

const DAY = 86_400_000;

/** Values a filter may hold in place of a date or a person, worked out per request. */
export function tokens(userId: string | null, now = new Date()): (value: string) => string {
  const today = now.toISOString().slice(0, 10);
  const days = (count: number) => new Date(Date.parse(today) + count * DAY).toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthEdge = (offset: number, edge: 'start' | 'end') => (edge === 'start' ? new Date(Date.UTC(year, month + offset, 1)) : new Date(Date.UTC(year, month + 1 + offset, 0))).toISOString().slice(0, 10);
  const table: Record<string, string> = {
    $me: userId ?? '',
    $today: today,
    $tomorrow: days(1),
    $in14days: days(14),
    $14daysAgo: days(-14),
    $monthStart: monthEdge(0, 'start'),
    $monthEnd: monthEdge(0, 'end'),
    $lastMonthStart: monthEdge(-1, 'start'),
    $lastMonthEnd: monthEdge(-1, 'end'),
    $12monthsAgo: monthEdge(-11, 'start'),
    $yearStart: `${year}-01-01`,
  };
  return (value) => table[value] ?? value;
}

export function property(object: ObjectDefinition, id: string): PropertyDefinition {
  const found = object.properties.find((item) => item.id === id);
  if (!found) throw new ValidationError(`${object.plural} have no property "${id}".`);
  return found;
}

/** The property as JSON, and as text. */
const json = (id: string) => sql`records.properties->${id}::text`;
const text = (id: string) => sql`records.properties->>${id}::text`;
const isEmpty = (id: string) => sql`(${json(id)} is null or ${json(id)} in ('null'::jsonb, '""'::jsonb, '[]'::jsonb))`;
const list = (values: string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
const like = (needle: string) => `%${needle.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

export function condition(object: ObjectDefinition, filter: Filter, resolve: (value: string) => string): SQL {
  property(object, filter.property);
  const id = filter.property;
  const raw = filter.value ?? null;
  const expected: PropertyValue = typeof raw === 'string' ? resolve(raw) : Array.isArray(raw) ? raw.map(resolve) : raw;
  const equals =
    expected === null
      ? sql`(${json(id)} is null or ${json(id)} = 'null'::jsonb)`
      : Array.isArray(expected)
        ? sql`false`
        : sql`coalesce(case when jsonb_typeof(${json(id)}) = 'array' then ${json(id)} ? ${String(expected)} else ${json(id)} = ${JSON.stringify(expected)}::jsonb end, false)`;
  switch (filter.operator) {
    case 'empty':
      return isEmpty(id);
    case 'notEmpty':
      return sql`not ${isEmpty(id)}`;
    case 'eq':
      return equals;
    case 'neq':
      return sql`not ${equals}`;
    case 'in':
      return Array.isArray(expected) && expected.length > 0 ? sql`(jsonb_typeof(${json(id)}) = 'string' and ${text(id)} in (${list(expected)}))` : sql`false`;
    case 'contains':
      return typeof expected === 'string' ? sql`(jsonb_typeof(${json(id)}) = 'string' and ${text(id)} ilike ${like(expected)})` : sql`false`;
    case 'gt':
    case 'lt': {
      const operator = filter.operator === 'gt' ? sql`>` : sql`<`;
      if (typeof expected === 'number') return sql`coalesce(case when jsonb_typeof(${json(id)}) = 'number' then (${text(id)})::numeric ${operator} ${expected} end, false)`;
      if (typeof expected === 'string') return sql`(jsonb_typeof(${json(id)}) = 'string' and ${text(id)} ${operator} ${expected})`;
      return sql`false`;
    }
    case 'between': {
      const [from, to] = Array.isArray(expected) ? expected : [];
      return from !== undefined && to !== undefined ? sql`(jsonb_typeof(${json(id)}) = 'string' and ${text(id)} >= ${from} and ${text(id)} <= ${to})` : sql`false`;
    }
  }
}

const SEARCHED = ['email', 'domain', 'phone'];

/** Matches the record's name, or its email, domain or phone where the object has them. */
export function search(object: ObjectDefinition, needle: string): SQL {
  const ids = [object.primaryProperty, ...SEARCHED.filter((id) => id !== object.primaryProperty && object.properties.some((item) => item.id === id))];
  return sql`(${sql.join(ids.map((id) => sql`${text(id)} ilike ${like(needle)}`), sql` or `)})`;
}

/** Sorts by what a person sees: option order for choices, names for people and linked records. Empty values go last. */
export function order(object: ObjectDefinition, sort: Sort | undefined, primaryOf: (objectId: string) => string | undefined): SQL {
  if (!sort) return sql`records.created_at desc, records.id`;
  const definition = property(object, sort.property);
  const id = sort.property;
  let key: SQL;
  switch (definition.type) {
    case 'number':
    case 'currency':
      key = sql`case when jsonb_typeof(${json(id)}) = 'number' then (${text(id)})::numeric end`;
      break;
    case 'boolean':
      key = sql`case when jsonb_typeof(${json(id)}) = 'boolean' then (${text(id)})::boolean::int end`;
      break;
    case 'multiselect':
      key = sql`case when jsonb_typeof(${json(id)}) = 'array' then jsonb_array_length(${json(id)}) end`;
      break;
    case 'select': {
      const options = (definition.options ?? []).map((option) => option.id);
      key = options.length > 0 ? sql`array_position(array[${list(options)}]::text[], ${text(id)})` : sql`${text(id)}`;
      break;
    }
    case 'user':
      key = sql`(select lower(person.name) from people person where person.id = ${text(id)} and person.tenant_id = records.tenant_id)`;
      break;
    case 'reference': {
      const primary = definition.referenceObjectId ? primaryOf(definition.referenceObjectId) : undefined;
      key = primary ? sql`(select lower(linked.properties->>${primary}::text) from records linked where linked.id = ${text(id)} and linked.tenant_id = records.tenant_id)` : sql`${text(id)}`;
      break;
    }
    default:
      key = sql`lower(nullif(${text(id)}, ''))`;
  }
  return sql`${key} ${sort.direction === 'asc' ? sql`asc` : sql`desc`} nulls last, records.id`;
}

export { json as propertyJson, text as propertyText };
