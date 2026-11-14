import type { Filter, ObjectDefinition, PropertyDefinition, PropertyValue, Sort } from '../contracts/metadata';
import type {
  Activity,
  ActivityKind,
  CrmApi,
  CrmRecord,
  ListQuery,
  Reference,
  RelatedGroup,
  SummaryQuery,
  SummaryRow,
} from '../contracts/records';
import { CURRENT_USER_ID, MOCK_NOW, MOCK_TODAY, objects, users } from './definitions';
import { dataset } from './generate';

/** In-memory implementation of `CrmApi`. Everything the pages know about data comes through here. */

const LATENCY_MS = 120;
const RELATED_LIMIT = 5;

function respond<T>(compute: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(structuredClone(compute()));
      } catch (error) {
        reject(error);
      }
    }, LATENCY_MS);
  });
}

function definition(objectId: string): ObjectDefinition {
  const found = objects.find((object) => object.id === objectId);
  if (!found) throw new Error(`Unknown object "${objectId}"`);
  return found;
}

function property(object: ObjectDefinition, propertyId: string): PropertyDefinition | undefined {
  return object.properties.find((item) => item.id === propertyId);
}

function resolveToken(value: string): string {
  switch (value) {
    case '$me':
      return CURRENT_USER_ID;
    case '$today':
      return MOCK_TODAY;
    case '$monthStart':
      return `${MOCK_TODAY.slice(0, 7)}-01`;
    case '$monthEnd':
      return `${MOCK_TODAY.slice(0, 7)}-31`;
    default:
      return value;
  }
}

function resolveValue(value: PropertyValue | undefined): PropertyValue {
  if (typeof value === 'string') return resolveToken(value);
  if (Array.isArray(value)) return value.map(resolveToken);
  return value ?? null;
}

function isEmpty(value: PropertyValue | undefined): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function matches(item: CrmRecord, filter: Filter): boolean {
  const actual = item.properties[filter.property] ?? null;
  const expected = resolveValue(filter.value);
  switch (filter.operator) {
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
    case 'between': {
      if (!Array.isArray(expected) || typeof actual !== 'string') return false;
      const [from, to] = expected;
      return from !== undefined && to !== undefined && actual >= from && actual <= to;
    }
  }
}

const SEARCHED = ['email', 'domain', 'phone'];

function select(query: { objectId: string; viewId?: string; filters?: Filter[]; search?: string }): CrmRecord[] {
  const object = definition(query.objectId);
  const view = query.viewId ? object.views.find((item) => item.id === query.viewId) : undefined;
  const filters = [...(view?.filters ?? []), ...(query.filters ?? [])];
  const needle = query.search?.trim().toLowerCase();
  const all = dataset().byObject.get(query.objectId) ?? [];
  return all.filter((item) => {
    if (!filters.every((filter) => matches(item, filter))) return false;
    if (!needle) return true;
    const name = item.properties[object.primaryProperty];
    if (typeof name === 'string' && name.toLowerCase().includes(needle)) return true;
    return SEARCHED.some((id) => {
      const value = item.properties[id];
      return typeof value === 'string' && value.toLowerCase().includes(needle);
    });
  });
}

function label(recordId: string): string {
  const item = dataset().byId.get(recordId);
  if (!item) return recordId;
  const value = item.properties[definition(item.objectId).primaryProperty];
  return typeof value === 'string' ? value : recordId;
}

/** Sorts by what the user sees: option order for selects, names for users and references. */
function sortKey(item: CrmRecord, definitionOf: PropertyDefinition | undefined, propertyId: string): string | number | null {
  const value = item.properties[propertyId] ?? null;
  if (value === null || Array.isArray(value)) return Array.isArray(value) ? value.length : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  switch (definitionOf?.type) {
    case 'select':
      return definitionOf.options?.findIndex((option) => option.id === value) ?? 0;
    case 'user':
      return users.find((user) => user.id === value)?.name.toLowerCase() ?? '';
    case 'reference':
      return label(value).toLowerCase();
    default:
      return value.toLowerCase();
  }
}

function sorted(items: CrmRecord[], object: ObjectDefinition, sort: Sort | undefined): CrmRecord[] {
  if (!sort) return items;
  const definitionOf = property(object, sort.property);
  const factor = sort.direction === 'asc' ? 1 : -1;
  const keyed = items.map((item) => ({ item, key: sortKey(item, definitionOf, sort.property) }));
  keyed.sort((a, b) => {
    // Empty values go last in either direction.
    if (a.key === null) return b.key === null ? 0 : 1;
    if (b.key === null) return -1;
    if (a.key < b.key) return -factor;
    if (a.key > b.key) return factor;
    return 0;
  });
  return keyed.map((entry) => entry.item);
}

function references(items: CrmRecord[]): Record<string, Reference> {
  const result: Record<string, Reference> = {};
  for (const item of items) {
    for (const definitionOf of definition(item.objectId).properties) {
      if (definitionOf.type !== 'reference') continue;
      const target = item.properties[definitionOf.id];
      if (typeof target !== 'string' || result[target]) continue;
      result[target] = { objectId: definitionOf.referenceObjectId ?? '', label: label(target) };
    }
  }
  return result;
}

function get(id: string): CrmRecord {
  const item = dataset().byId.get(id);
  if (!item) throw new Error(`Record "${id}" not found`);
  return item;
}

function related(id: string): RelatedGroup[] {
  const item = get(id);
  const groups: RelatedGroup[] = [];
  // Records this one points at.
  for (const definitionOf of definition(item.objectId).properties) {
    if (definitionOf.type !== 'reference' || !definitionOf.referenceObjectId) continue;
    const target = item.properties[definitionOf.id];
    const found = typeof target === 'string' ? dataset().byId.get(target) : undefined;
    groups.push({ objectId: definitionOf.referenceObjectId, total: found ? 1 : 0, records: found ? [found] : [] });
  }
  // Records of other objects that point at this one.
  for (const object of objects) {
    const pointing = object.properties.filter((candidate) => candidate.type === 'reference' && candidate.referenceObjectId === item.objectId);
    if (pointing.length === 0 || groups.some((group) => group.objectId === object.id)) continue;
    const found = (dataset().byObject.get(object.id) ?? []).filter((candidate) => pointing.some((ref) => candidate.properties[ref.id] === id));
    groups.push({ objectId: object.id, total: found.length, records: found.slice(0, RELATED_LIMIT) });
  }
  return groups;
}

const createdActivity = new Map<string, Activity[]>();
/** Records made in this session. They have no history beyond what the user does to them. */
const createdRecords = new Set<string>();

const ACTIVITY_TEMPLATES: Array<{ kind: ActivityKind; title: string; body?: string }> = [
  { kind: 'email', title: 'Email sent: Following up on our conversation', body: 'Thanks for the time today. I have attached the summary and the pricing we discussed, and I am happy to walk your team through it.' },
  { kind: 'call', title: 'Call logged · 18 min', body: 'Talked through rollout timing. They want to start with one site and expand after the first quarter.' },
  { kind: 'meeting', title: 'Meeting: Product walkthrough', body: 'Covered reporting and permissions. Next step is a security review with their IT lead.' },
  { kind: 'note', title: 'Note', body: 'Budget is approved for this year. The decision sits with operations, finance only signs off.' },
  { kind: 'email', title: 'Email received: Re: Proposal', body: 'This looks good. Can you confirm the onboarding timeline before we take it to the board?' },
  { kind: 'task', title: 'Task completed: Send revised pricing' },
  { kind: 'change', title: 'Owner changed' },
  { kind: 'call', title: 'Call logged · 6 min', body: 'Left a voicemail and followed up by email.' },
  { kind: 'meeting', title: 'Meeting: Quarterly review', body: 'Usage is up across both teams. They asked about adding seats in the new year.' },
  { kind: 'change', title: 'Stage changed' },
];

function hash(text: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16_777_619);
  }
  return value >>> 0;
}

function activityFor(recordId: string): Activity[] {
  const item = get(recordId);
  const seed = hash(recordId);
  const count = createdRecords.has(recordId) ? 0 : 4 + (seed % 6);
  const start = Date.parse(item.createdAt);
  const span = Math.max(Date.parse(MOCK_NOW) - start, 86_400_000);
  const generated: Activity[] = [];
  for (let index = 0; index < count; index += 1) {
    const template = ACTIVITY_TEMPLATES[(seed + index * 7) % ACTIVITY_TEMPLATES.length];
    if (!template) continue;
    generated.push({
      id: `act_${recordId}_${index}`,
      recordId,
      kind: template.kind,
      title: template.title,
      body: template.body,
      actorId: (users[(seed + index) % users.length] ?? users[0])?.id ?? CURRENT_USER_ID,
      occurredAt: new Date(start + Math.floor((span * (index + 1)) / (count + 1))).toISOString(),
    });
  }
  generated.push({ id: `act_${recordId}_created`, recordId, kind: 'change', title: 'Record created', actorId: CURRENT_USER_ID, occurredAt: item.createdAt });
  return [...(createdActivity.get(recordId) ?? []), ...generated].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

let sequence = 0;

/** URL segments the app uses itself, so no object may take them. */
const RESERVED = new Set(['assistant', 'inbox', 'tasks', 'sequences', 'workflows', 'reports', 'settings']);

/** "Renewal date" becomes `renewalDate` (joiner '') or `renewal-date` (joiner '-'). */
function slug(text: string, joiner: '' | '-'): string {
  const words = text.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (joiner === '-') return words.join('-');
  return words.map((word, index) => (index === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)).join('');
}

export const mockApi: CrmApi = {
  getWorkspace: () => respond(() => ({ name: 'Northwind', objects, users, currentUserId: CURRENT_USER_ID })),

  listRecords: (query: ListQuery) =>
    respond(() => {
      const object = definition(query.objectId);
      const view = query.viewId ? object.views.find((item) => item.id === query.viewId) : undefined;
      const items = sorted(select(query), object, query.sort ?? view?.sort);
      const start = (query.page - 1) * query.pageSize;
      const records = items.slice(start, start + query.pageSize);
      return { records, total: items.length, references: references(records) };
    }),

  summarize: (query: SummaryQuery) =>
    respond(() => {
      const rows = new Map<string | null, SummaryRow>();
      for (const item of select(query)) {
        const raw = item.properties[query.groupBy];
        const value = typeof raw === 'string' ? raw : null;
        const row = rows.get(value) ?? { value, count: 0, sum: 0 };
        const amount = query.sumProperty ? item.properties[query.sumProperty] : 0;
        row.count += 1;
        row.sum += typeof amount === 'number' ? amount : 0;
        rows.set(value, row);
      }
      return [...rows.values()];
    }),

  getRecord: (id: string) =>
    respond(() => {
      const item = get(id);
      return { record: item, references: references([item]) };
    }),

  listRelated: (id: string) => respond(() => related(id)),

  listActivity: (recordId: string) => respond(() => activityFor(recordId)),

  createRecord: (input) =>
    respond(() => {
      const data = dataset();
      const now = new Date().toISOString();
      sequence += 1;
      const item: CrmRecord = {
        id: `${input.objectId.slice(0, 3)}_new_${sequence}`,
        objectId: input.objectId,
        properties: { ...input.properties, createdAt: MOCK_TODAY },
        createdAt: now,
        updatedAt: now,
      };
      data.byObject.get(input.objectId)?.unshift(item);
      data.byId.set(item.id, item);
      createdRecords.add(item.id);
      return item;
    }),

  updateRecord: (input) =>
    respond(() => {
      const item = get(input.id);
      Object.assign(item.properties, input.properties);
      item.updatedAt = new Date().toISOString();
      return item;
    }),

  createObject: (input) =>
    respond(() => {
      const id = slug(input.plural, '-');
      if (!id) throw new Error('Give the object a name.');
      if (objects.some((object) => object.id === id) || RESERVED.has(id)) throw new Error(`"${input.plural}" is already in use.`);
      const created: ObjectDefinition = {
        id,
        singular: input.singular,
        plural: input.plural,
        icon: input.icon,
        primaryProperty: 'name',
        properties: [
          { id: 'name', label: 'Name', type: 'text', group: 'About', onCreate: true },
          { id: 'owner', label: 'Owner', type: 'user', group: 'About', onCreate: true },
          { id: 'createdAt', label: 'Created', type: 'date', group: 'Record', system: true },
        ],
        views: [{ id: 'all', name: `All ${input.plural.toLowerCase()}`, columns: ['name', 'owner', 'createdAt'], filters: [], sort: { property: 'createdAt', direction: 'desc' } }],
        custom: true,
      };
      objects.push(created);
      dataset().byObject.set(id, []);
      return created;
    }),

  createProperty: (input) =>
    respond(() => {
      const object = definition(input.objectId);
      const base = slug(input.label, '');
      if (!base) throw new Error('Give the property a name.');
      if (object.properties.some((item) => item.label.toLowerCase() === input.label.trim().toLowerCase())) throw new Error(`${object.plural} already have a property called "${input.label.trim()}".`);
      let id = base;
      for (let suffix = 2; object.properties.some((item) => item.id === id); suffix += 1) id = `${base}${suffix}`;
      const choice = input.type === 'select' || input.type === 'multiselect';
      object.properties.push({
        id,
        label: input.label.trim(),
        type: input.type,
        group: input.group.trim(),
        options: choice ? (input.options ?? []) : undefined,
        referenceObjectId: input.type === 'reference' ? input.referenceObjectId : undefined,
        onCreate: input.onCreate,
        custom: true,
      });
      if (input.addToViews) for (const view of object.views) view.columns.push(id);
      return object;
    }),

  updateProperty: (input) =>
    respond(() => {
      const object = definition(input.objectId);
      const found = property(object, input.propertyId);
      if (!found) throw new Error('That property no longer exists.');
      if (input.label !== undefined) found.label = input.label.trim();
      if (input.group !== undefined) found.group = input.group.trim();
      if (input.options !== undefined) found.options = input.options;
      if (input.onCreate !== undefined) found.onCreate = input.onCreate;
      return object;
    }),

  deleteProperty: (input) =>
    respond(() => {
      const object = definition(input.objectId);
      const found = property(object, input.propertyId);
      if (!found) return object;
      if (!found.custom) throw new Error('Properties that come with the CRM can be renamed, but not deleted.');
      object.properties = object.properties.filter((item) => item.id !== input.propertyId);
      for (const view of object.views) {
        view.columns = view.columns.filter((column) => column !== input.propertyId);
        view.filters = view.filters.filter((filter) => filter.property !== input.propertyId);
        if (view.sort?.property === input.propertyId) view.sort = undefined;
      }
      for (const item of dataset().byObject.get(object.id) ?? []) delete item.properties[input.propertyId];
      return object;
    }),

  createActivity: (input) =>
    respond(() => {
      sequence += 1;
      const created: Activity = { id: `act_new_${sequence}`, actorId: CURRENT_USER_ID, occurredAt: new Date().toISOString(), ...input };
      createdActivity.set(input.recordId, [created, ...(createdActivity.get(input.recordId) ?? [])]);
      return created;
    }),
};
