import type { Filter, FilterOperator, ObjectDefinition, PropertyDefinition, PropertyType, PropertyValue, User } from '../contracts/metadata';
import { formatDate } from './PropertyValue';
import { currency } from './styles';

/** The comparisons that make sense for each kind of property, in the order they are offered. */
export const OPERATORS: Record<PropertyType, FilterOperator[]> = {
  text: ['contains', 'eq', 'empty', 'notEmpty'],
  email: ['contains', 'eq', 'empty', 'notEmpty'],
  phone: ['contains', 'empty', 'notEmpty'],
  url: ['contains', 'empty', 'notEmpty'],
  number: ['gt', 'lt', 'eq', 'empty', 'notEmpty'],
  currency: ['gt', 'lt', 'eq', 'empty', 'notEmpty'],
  date: ['gt', 'lt', 'between', 'empty', 'notEmpty'],
  datetime: ['gt', 'lt', 'between', 'empty', 'notEmpty'],
  select: ['in', 'empty', 'notEmpty'],
  multiselect: ['eq', 'empty', 'notEmpty'],
  boolean: ['eq'],
  user: ['in', 'empty', 'notEmpty'],
  reference: ['empty', 'notEmpty'],
};

const DATE_TYPES = new Set<PropertyType>(['date', 'datetime']);
const NUMBER_TYPES = new Set<PropertyType>(['number', 'currency']);

/** How an operator reads for a property of the given type: "is after" for a date, "is more than" for a number. */
export function operatorLabel(operator: FilterOperator, type: PropertyType): string {
  switch (operator) {
    case 'contains':
      return 'contains';
    case 'eq':
      return type === 'multiselect' ? 'includes' : 'is';
    case 'neq':
      return 'is not';
    case 'in':
      return 'is any of';
    case 'gt':
      return DATE_TYPES.has(type) ? 'is after' : 'is more than';
    case 'lt':
      return DATE_TYPES.has(type) ? 'is before' : 'is less than';
    case 'between':
      return 'is between';
    case 'empty':
      return 'is empty';
    case 'notEmpty':
      return 'has a value';
  }
}

/** Values the server works out per request, and how to say them. */
export const TOKENS: Record<string, string> = {
  $me: 'me',
  $today: 'today',
  $tomorrow: 'tomorrow',
  $in14days: '14 days from now',
  $14daysAgo: '14 days ago',
  $lastMonthStart: 'the start of last month',
  $lastMonthEnd: 'the end of last month',
  $12monthsAgo: '12 months ago',
  $yearStart: 'the start of this year',
  $monthStart: 'the start of this month',
  $monthEnd: 'the end of this month',
};

function valueLabel(value: string, property: PropertyDefinition, users: User[]): string {
  if (TOKENS[value]) return TOKENS[value] as string;
  if (property.type === 'user') return users.find((user) => user.id === value)?.name ?? value;
  if (property.type === 'select' || property.type === 'multiselect') return property.options?.find((option) => option.id === value)?.label ?? value;
  if (DATE_TYPES.has(property.type)) return formatDate(value);
  return value;
}

/** A filter in words, for the chip: "Stage is any of Qualified, Discovery". */
export function describeFilter(filter: Filter, object: ObjectDefinition, users: User[]): string {
  const property = object.properties.find((item) => item.id === filter.property);
  if (!property) return 'A filter on a property that no longer exists';
  const operator = operatorLabel(filter.operator, property.type);
  if (filter.operator === 'empty' || filter.operator === 'notEmpty') return `${property.label} ${operator}`;
  const value: PropertyValue = filter.value ?? null;
  let words: string;
  if (Array.isArray(value)) {
    const labels = value.map((item) => valueLabel(item, property, users));
    words = filter.operator === 'between' ? labels.join(' and ') : labels.length > 3 ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3}` : labels.join(', ');
  } else if (typeof value === 'boolean') words = value ? 'yes' : 'no';
  else if (typeof value === 'number') words = property.type === 'currency' ? currency(value) : value.toLocaleString('en-US');
  else words = value === null ? '' : valueLabel(value, property, users);
  // "Owner is any of me" reads badly; one choice is just "is".
  const verb = filter.operator === 'in' && Array.isArray(value) && value.length === 1 ? 'is' : operator;
  return `${property.label} ${verb} ${words}`.trim();
}

/** Whether a filter has everything it needs to run. */
export function isComplete(filter: Filter, property: PropertyDefinition | undefined): boolean {
  if (!property) return false;
  if (filter.operator === 'empty' || filter.operator === 'notEmpty') return true;
  const value = filter.value;
  if (value === undefined || value === null || value === '') return false;
  if (filter.operator === 'between') return Array.isArray(value) && value.length === 2 && value.every((item) => item !== '');
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** The starting value when an operator is picked for a property. */
export function emptyValue(operator: FilterOperator, type: PropertyType): PropertyValue | undefined {
  if (operator === 'empty' || operator === 'notEmpty') return undefined;
  if (operator === 'in') return [];
  if (operator === 'between') return ['', ''];
  if (type === 'boolean') return true;
  return NUMBER_TYPES.has(type) ? null : '';
}

export function isNumberType(type: PropertyType): boolean {
  return NUMBER_TYPES.has(type);
}

export function isDateType(type: PropertyType): boolean {
  return DATE_TYPES.has(type);
}
