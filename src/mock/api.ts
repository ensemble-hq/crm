import type { Filter, ObjectDefinition, PropertyDefinition, PropertyValue, Sort, ViewDefinition } from '../contracts/metadata';
import type {
  Activity,
  ActivityKind,
  CrmApi,
  CrmRecord,
  ImportRequest,
  ImportResult,
  MergeRecords,
  Notification,
  ListQuery,
  Reference,
  RelatedGroup,
  SummaryQuery,
  SummaryRow,
} from '../contracts/records';
import { MOCK_NOW, MOCK_TODAY, objects, users } from './definitions';
import { dataset } from './generate';
import { createCaptureApi } from './capture';
import { createInboxApi } from './inbox';
import { createReportsApi } from './reports';
import { createSalesApi } from './sales';
import { createBriefApi } from './brief';
import { createSequencesApi, enrollFromWorkflow } from './sequences';
import { activeUsers, assertAllowed, assertCan, createTeamApi, currentAccess, session, visible } from './team';
import { type WorkflowDeps, createWorkflowsApi, fire } from './workflows';

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

function daysFromToday(days: number): string {
  return new Date(Date.parse(MOCK_TODAY) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The first or last day of the month `offset` months from this one. */
function monthEdge(offset: number, edge: 'start' | 'end'): string {
  const [year = 0, month = 1] = MOCK_TODAY.split('-').map(Number);
  // Day 0 of the following month is the last day of this one.
  const date = edge === 'start' ? new Date(Date.UTC(year, month - 1 + offset, 1)) : new Date(Date.UTC(year, month + offset, 0));
  return date.toISOString().slice(0, 10);
}

function resolveToken(value: string): string {
  switch (value) {
    case '$me':
      return session.userId;
    case '$today':
      return MOCK_TODAY;
    case '$tomorrow':
      return daysFromToday(1);
    case '$in14days':
      return daysFromToday(14);
    case '$14daysAgo':
      return daysFromToday(-14);
    case '$monthStart':
      return monthEdge(0, 'start');
    case '$monthEnd':
      return monthEdge(0, 'end');
    case '$lastMonthStart':
      return monthEdge(-1, 'start');
    case '$lastMonthEnd':
      return monthEdge(-1, 'end');
    case '$12monthsAgo':
      return monthEdge(-11, 'start');
    case '$yearStart':
      return `${MOCK_TODAY.slice(0, 4)}-01-01`;
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
    // What the person may see comes first; filters and search only narrow it.
    if (!visible(item)) return false;
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
  if (!visible(item)) throw new Error('You don\'t have access to this record.');
  return item;
}

function related(id: string): RelatedGroup[] {
  const item = get(id);
  const groups: RelatedGroup[] = [];
  // Records this one points at.
  for (const definitionOf of definition(item.objectId).properties) {
    if (definitionOf.type !== 'reference' || !definitionOf.referenceObjectId) continue;
    const target = item.properties[definitionOf.id];
    const linked = typeof target === 'string' ? dataset().byId.get(target) : undefined;
    // A linked record the person may not see is left out, as if there were none.
    const found = linked && visible(linked) ? linked : undefined;
    groups.push({ objectId: definitionOf.referenceObjectId, total: found ? 1 : 0, records: found ? [found] : [] });
  }
  // Records of other objects that point at this one.
  for (const object of objects) {
    const pointing = object.properties.filter((candidate) => candidate.type === 'reference' && candidate.referenceObjectId === item.objectId);
    if (pointing.length === 0 || groups.some((group) => group.objectId === object.id)) continue;
    const found = (dataset().byObject.get(object.id) ?? []).filter((candidate) => visible(candidate) && pointing.some((ref) => candidate.properties[ref.id] === id));
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
      actorId: (users[(seed + index) % users.length] ?? users[0])?.id ?? session.userId,
      occurredAt: new Date(start + Math.floor((span * (index + 1)) / (count + 1))).toISOString(),
    });
  }
  generated.push({ id: `act_${recordId}_created`, recordId, kind: 'change', title: 'Record created', actorId: session.userId, occurredAt: item.createdAt });
  return [...(createdActivity.get(recordId) ?? []), ...generated].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** Checks new values against the object's rules: required, unique, and the shape of emails. */
function validate(object: ObjectDefinition, values: Record<string, PropertyValue>, recordId: string | undefined, creating: boolean): void {
  for (const definitionOf of object.properties) {
    if (definitionOf.system) continue;
    const touched = definitionOf.id in values;
    if (!touched && !creating) continue;
    const value = values[definitionOf.id] ?? null;
    const mustHave = definitionOf.required || definitionOf.id === object.primaryProperty;
    if (isEmpty(value)) {
      if (mustHave) throw new Error(`${definitionOf.label} is required.`);
      continue;
    }
    if (definitionOf.type === 'email' && typeof value === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error(`"${value}" is not an email address.`);
    if (definitionOf.unique) {
      const clash = (dataset().byObject.get(object.id) ?? []).find((item) => item.id !== recordId && item.properties[definitionOf.id] === value);
      if (clash) throw new Error(`Another ${object.singular.toLowerCase()} already has ${definitionOf.label.toLowerCase()} "${String(value)}".`);
    }
  }
}

let sequence = 0;

/** URL segments the app uses itself, so no object may take them. */
const RESERVED = new Set(['assistant', 'inbox', 'tasks', 'import', 'sequences', 'workflows', 'reports', 'forecast', 'forms', 'meetings', 'settings', 'f', 'book']);

/** "Renewal date" becomes `renewalDate` (joiner '') or `renewal-date` (joiner '-'). */
function slug(text: string, joiner: '' | '-'): string {
  const words = text.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (joiner === '-') return words.join('-');
  return words.map((word, index) => (index === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)).join('');
}

/** Turns the text from a file's cell into the value a property holds. `undefined` means "could not understand it". */
function coerce(text: string, definitionOf: PropertyDefinition): PropertyValue | undefined {
  const value = text.trim();
  if (value === '') return null;
  const lower = value.toLowerCase();
  switch (definitionOf.type) {
    case 'number':
    case 'currency': {
      const parsed = Number(value.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) && /\d/.test(value) ? parsed : undefined;
    }
    case 'boolean':
      if (['yes', 'true', '1', 'y'].includes(lower)) return true;
      if (['no', 'false', '0', 'n'].includes(lower)) return false;
      return undefined;
    case 'date':
    case 'datetime': {
      const time = Date.parse(value);
      return Number.isNaN(time) ? undefined : new Date(time).toISOString().slice(0, 10);
    }
    case 'select':
      return definitionOf.options?.find((option) => option.label.toLowerCase() === lower || option.id === lower)?.id;
    case 'multiselect': {
      const ids = value.split(/[;|]/).map((part) => definitionOf.options?.find((option) => option.label.toLowerCase() === part.trim().toLowerCase())?.id);
      return ids.every((id): id is string => id !== undefined) ? ids : undefined;
    }
    case 'user':
      return users.find((user) => user.name.toLowerCase() === lower || user.email.toLowerCase() === lower)?.id;
    case 'reference': {
      const target = definitionOf.referenceObjectId ? definition(definitionOf.referenceObjectId) : undefined;
      if (!target) return undefined;
      return (dataset().byObject.get(target.id) ?? []).find((item) => String(item.properties[target.primaryProperty] ?? '').toLowerCase() === lower)?.id;
    }
    default:
      return value;
  }
}

function importRecords(input: ImportRequest): ImportResult {
  const object = definition(input.objectId);
  const data = dataset();
  const result: ImportResult = { created: [], updated: 0, skipped: [], warnings: [] };
  const matchOn = input.matchOn ? property(object, input.matchOn) : undefined;
  // Existing records by the matching value, built once so a large file doesn't rescan for every row.
  const existing = new Map<string, CrmRecord>();
  if (matchOn) {
    for (const item of data.byObject.get(object.id) ?? []) {
      const key = item.properties[matchOn.id];
      if (typeof key === 'string' && key !== '') existing.set(key.toLowerCase(), item);
    }
  }
  const seen = new Set<string>();

  input.rows.forEach((row, index) => {
    const position = index + 1;
    const values: Record<string, PropertyValue> = {};
    for (const [propertyId, text] of Object.entries(row)) {
      const definitionOf = property(object, propertyId);
      if (!definitionOf || definitionOf.system) continue;
      const value = coerce(text, definitionOf);
      if (value === undefined) {
        result.warnings.push({ row: position, message: `${definitionOf.label}: "${text}" was not understood and was left empty.` });
        continue;
      }
      values[propertyId] = value;
    }
    const key = matchOn && typeof values[matchOn.id] === 'string' ? (values[matchOn.id] as string).toLowerCase() : undefined;
    if (key && seen.has(key)) {
      result.skipped.push({ row: position, reason: `Repeats ${matchOn?.label.toLowerCase()} "${String(values[matchOn?.id ?? ''])}" from an earlier row.` });
      return;
    }
    if (key) seen.add(key);
    const match = key ? existing.get(key) : undefined;
    try {
      if (match) {
        if (input.onMatch === 'skip') {
          result.skipped.push({ row: position, reason: `Already in the CRM (matched on ${matchOn?.label.toLowerCase()}).` });
          return;
        }
        // Only fill in what the file has; an empty cell never wipes an existing value.
        const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => !isEmpty(value)));
        validate(object, changes, match.id, false);
        if (!input.dryRun) {
          Object.assign(match.properties, changes);
          match.updatedAt = new Date().toISOString();
        }
        result.updated += 1;
        return;
      }
      const properties = { ...(input.defaults ?? {}), ...values };
      validate(object, properties, undefined, true);
      if (input.dryRun) {
        result.created.push(`row_${position}`);
        return;
      }
      const now = new Date().toISOString();
      sequence += 1;
      const item: CrmRecord = { id: `${object.id.slice(0, 3)}_new_${sequence}`, objectId: object.id, properties: { ...properties, createdAt: MOCK_TODAY }, createdAt: now, updatedAt: now };
      data.byObject.get(object.id)?.unshift(item);
      data.byId.set(item.id, item);
      createdRecords.add(item.id);
      if (key) existing.set(key, item);
      result.created.push(item.id);
    } catch (error) {
      result.skipped.push({ row: position, reason: error instanceof Error ? error.message : 'Not valid.' });
    }
  });
  return result;
}

/** Puts an email sent from the inbox on a record's timeline. */
function logEmail(recordId: string, subject: string, body: string): void {
  if (!dataset().byId.has(recordId)) return;
  sequence += 1;
  const logged: Activity = { id: `act_new_${sequence}`, recordId, kind: 'email', title: `Email sent: ${subject}`, body, actorId: session.userId, occurredAt: new Date().toISOString() };
  createdActivity.set(recordId, [logged, ...(createdActivity.get(recordId) ?? [])]);
}

/** Adds a record straight to the store: no validation and no workflows. For records the mock itself makes. */
function insert(objectId: string, properties: Record<string, PropertyValue>): CrmRecord {
  const data = dataset();
  const now = new Date().toISOString();
  sequence += 1;
  const item: CrmRecord = { id: `${objectId.slice(0, 3)}_new_${sequence}`, objectId, properties: { ...properties, createdAt: MOCK_TODAY }, createdAt: now, updatedAt: now };
  data.byObject.get(objectId)?.unshift(item);
  data.byId.set(item.id, item);
  createdRecords.add(item.id);
  return item;
}

let notifications: Notification[] | undefined;

/** A few notifications to start with, about the signed-in user's own deals. */
function allNotifications(): Notification[] {
  if (notifications) return notifications;
  const mine = (dataset().byObject.get('deals') ?? []).filter((deal) => deal.properties.owner === session.userId).slice(0, 4);
  const now = Date.parse(MOCK_NOW);
  const messages = ['Jonas mentioned you in a note: “Can you join the pricing call?”', 'A task on this deal is overdue.', 'Priya assigned this deal to you.', 'The contact replied to your email.'];
  notifications = mine.map((deal, index) => ({ id: `ntf_${index + 1}`, message: messages[index] ?? 'Something changed.', recordId: deal.id, createdAt: new Date(now - (index * 5 + 1) * 3_600_000).toISOString(), read: index > 1 }));
  return notifications;
}

function pushNotification(message: string, recordId: string | null): void {
  sequence += 1;
  allNotifications().unshift({ id: `ntf_new_${sequence}`, message, recordId, createdAt: new Date().toISOString(), read: false });
}

/** Folds `mergeId` into `keepId`: values, links from other records, and activity all move across. */
function mergeRecords(input: MergeRecords): CrmRecord {
  const keep = get(input.keepId);
  const merged = get(input.mergeId);
  if (keep.objectId !== merged.objectId) throw new Error('Only two records of the same kind can be merged.');
  assertCan('edit', keep, definition(keep.objectId).singular.toLowerCase());
  assertCan('delete', merged, definition(merged.objectId).singular.toLowerCase());
  if (keep.id === merged.id) throw new Error('Choose two different records.');
  const object = definition(keep.objectId);
  const data = dataset();
  // Read the other record's activity while it still exists.
  const moved = activityFor(merged.id)
    .filter((item) => !item.id.endsWith('_created'))
    .map((item) => ({ ...item, recordId: keep.id }));
  // Take the other record out first, so a unique value moving across doesn't clash with itself.
  data.byId.delete(merged.id);
  data.byObject.set(object.id, (data.byObject.get(object.id) ?? []).filter((item) => item.id !== merged.id));
  try {
    validate(object, input.properties, keep.id, false);
  } catch (error) {
    data.byId.set(merged.id, merged);
    data.byObject.get(object.id)?.unshift(merged);
    throw error;
  }
  Object.assign(keep.properties, input.properties);
  keep.updatedAt = new Date().toISOString();
  // Everything that pointed at the merged record now points at the kept one.
  for (const other of objects) {
    const pointing = other.properties.filter((item) => item.type === 'reference' && item.referenceObjectId === object.id);
    if (pointing.length === 0) continue;
    for (const item of data.byObject.get(other.id) ?? []) {
      for (const reference of pointing) if (item.properties[reference.id] === merged.id) item.properties[reference.id] = keep.id;
    }
  }
  sequence += 1;
  const note: Activity = { id: `act_new_${sequence}`, recordId: keep.id, kind: 'change', title: `Merged with ${String(merged.properties[object.primaryProperty] ?? 'another record')}`, actorId: session.userId, occurredAt: new Date().toISOString() };
  createdActivity.set(keep.id, [note, ...(createdActivity.get(keep.id) ?? []), ...moved]);
  createdActivity.delete(merged.id);
  return keep;
}

/** Hands every record one person owns to another. Returns how many moved. */
function reassignRecords(fromId: string, toId: string): number {
  let moved = 0;
  for (const object of objects) {
    if (!object.properties.some((item) => item.id === 'owner')) continue;
    for (const item of dataset().byObject.get(object.id) ?? []) {
      if (item.properties.owner !== fromId) continue;
      item.properties.owner = toId;
      moved += 1;
    }
  }
  return moved;
}

const workflowDeps: WorkflowDeps = {
  respond,
  definition,
  matches,
  records: (objectId) => dataset().byObject.get(objectId) ?? [],
  find: (recordId) => dataset().byId.get(recordId),
  labelOf: label,
  createTask: (properties) => {
    insert('tasks', properties);
  },
  logEmail,
  enroll: enrollFromWorkflow,
  notify: (userId, message, recordId) => {
    // Only the signed-in user has a bell in the mock; other people's notifications have nowhere to show.
    if (userId === session.userId) pushNotification(message, recordId);
  },
};

/** A contact from a public page (a form, a booking): the one with that email is updated, otherwise one is created. */
function upsertContact(properties: Record<string, PropertyValue>): { record: CrmRecord; isNew: boolean } {
  const object = definition('contacts');
  const email = typeof properties.email === 'string' ? properties.email.toLowerCase() : '';
  const existing = email ? (dataset().byObject.get('contacts') ?? []).find((item) => String(item.properties.email ?? '').toLowerCase() === email) : undefined;
  if (existing) {
    // A visitor's form never downgrades what the team already knows: only the details they typed are taken.
    const { source: _source, lifecycleStage: _stage, leadStatus: _status, ...typed } = properties;
    validate(object, typed, existing.id, false);
    Object.assign(existing.properties, typed);
    existing.updatedAt = new Date().toISOString();
    return { record: existing, isNew: false };
  }
  validate(object, properties, undefined, true);
  const record = insert('contacts', properties);
  fire({ kind: 'created', record }, workflowDeps);
  return { record, isNew: true };
}

function logActivity(recordId: string, kind: 'note' | 'meeting', title: string, body: string): void {
  sequence += 1;
  const logged: Activity = { id: `act_new_${sequence}`, recordId, kind, title, body, actorId: session.userId, occurredAt: new Date().toISOString() };
  createdActivity.set(recordId, [logged, ...(createdActivity.get(recordId) ?? [])]);
}

export const mockApi: CrmApi = {
  ...createInboxApi(respond, logEmail),
  ...createReportsApi({ respond, select, definition, labelOf: label }),
  ...createSequencesApi(respond),
  ...createWorkflowsApi(workflowDeps),
  ...createCaptureApi({ respond, upsertContact, logActivity }),
  ...createTeamApi(respond, reassignRecords),
  ...createBriefApi({ respond, get, definition, related, activity: activityFor }),
  ...createSalesApi({
    respond,
    get,
    assertCanEdit: (record) => assertCan('edit', record, definition(record.objectId).singular.toLowerCase()),
    select: (query) => select(query),
    setProperties: (record, properties) => {
      Object.assign(record.properties, properties);
      record.updatedAt = new Date().toISOString();
    },
    upsertContact,
    companyNamed: (name, ownerId) => {
      const existing = (dataset().byObject.get('companies') ?? []).find((item) => String(item.properties.name ?? '').toLowerCase() === name.toLowerCase());
      return existing ?? insert('companies', { name, owner: ownerId, type: 'prospect' });
    },
    createDeal: (properties) => {
      const deal = insert('deals', properties);
      fire({ kind: 'created', record: deal }, workflowDeps);
      return deal;
    },
    logActivity,
  }),
  getWorkspace: () => respond(() => ({ name: 'Northwind', objects, users: activeUsers(), currentUserId: session.userId, access: currentAccess() })),

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

  // The mock has no model. The scripted assistant in `assistant/mock-engine.ts` stands in for one.
  getAssistantSettings: () => respond(() => ({ configured: false, provider: null, model: null, baseUrl: null, hasKey: false, providers: [] })),
  saveAssistantSettings: () => Promise.reject(new Error('Connecting a model needs the server. This is the demo, which runs in your browser.')),
  assistantTurn: () => Promise.reject(new Error('No model is connected.')),
  // The demo keeps no audit log: nothing in it outlives the page.
  listAudit: () => respond(() => ({ entries: [], total: 0 })),
  checkAudit: () => respond(() => ({ intact: true, entries: 0, problem: null })),
  getAssistantUsage: () => respond(() => ({ from: MOCK_TODAY, turns: 0, inputTokens: 0, outputTokens: 0, failed: 0, byPerson: [], recent: [] })),

  listRelated: (id: string) => respond(() => related(id)),

  listActivity: (recordId: string) => respond(() => activityFor(recordId)),

  createRecord: (input) =>
    respond(() => {
      validate(definition(input.objectId), input.properties, undefined, true);
      const item = insert(input.objectId, input.properties);
      fire({ kind: 'created', record: item }, workflowDeps);
      return item;
    }),

  updateRecord: (input) =>
    respond(() => {
      const item = get(input.id);
      assertCan('edit', item, definition(item.objectId).singular.toLowerCase());
      validate(definition(item.objectId), input.properties, item.id, false);
      const changed = Object.fromEntries(Object.entries(input.properties).filter(([key, value]) => JSON.stringify(item.properties[key] ?? null) !== JSON.stringify(value)));
      Object.assign(item.properties, input.properties);
      item.updatedAt = new Date().toISOString();
      if (Object.keys(changed).length > 0) fire({ kind: 'changed', record: item, changed }, workflowDeps);
      return item;
    }),

  createObject: (input) =>
    respond(() => {
      assertAllowed('manageSettings', 'add objects');
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
      assertAllowed('manageSettings', 'add properties');
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
        required: input.required,
        unique: input.unique,
        custom: true,
      });
      if (input.addToViews) for (const view of object.views) view.columns.push(id);
      return object;
    }),

  updateProperty: (input) =>
    respond(() => {
      assertAllowed('manageSettings', 'change properties');
      const object = definition(input.objectId);
      const found = property(object, input.propertyId);
      if (!found) throw new Error('That property no longer exists.');
      if (input.label !== undefined) found.label = input.label.trim();
      if (input.group !== undefined) found.group = input.group.trim();
      if (input.options !== undefined) found.options = input.options;
      if (input.onCreate !== undefined) found.onCreate = input.onCreate;
      if (input.required !== undefined) found.required = input.required;
      if (input.unique !== undefined) found.unique = input.unique;
      return object;
    }),

  deleteProperty: (input) =>
    respond(() => {
      assertAllowed('manageSettings', 'delete properties');
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

  deleteRecords: (ids) =>
    respond(() => {
      const data = dataset();
      const doomed = new Set(ids);
      let deleted = 0;
      // Check every record before removing any, so a refusal leaves nothing half done.
      for (const id of ids) {
        const item = data.byId.get(id);
        if (item) assertCan('delete', item, definition(item.objectId).singular.toLowerCase());
      }
      for (const id of ids) {
        const item = data.byId.get(id);
        if (!item) continue;
        data.byId.delete(id);
        deleted += 1;
        const list = data.byObject.get(item.objectId);
        if (list) data.byObject.set(item.objectId, list.filter((candidate) => !doomed.has(candidate.id)));
      }
      return { deleted };
    }),

  saveView: (input) =>
    respond(() => {
      const object = definition(input.objectId);
      const settings = { name: input.name.trim(), columns: input.columns, filters: input.filters, sort: input.sort };
      if (input.viewId) {
        const existing = object.views.find((view) => view.id === input.viewId);
        if (!existing) throw new Error('That view no longer exists.');
        Object.assign(existing, settings);
        return existing;
      }
      if (object.views.some((view) => view.name.toLowerCase() === settings.name.toLowerCase())) throw new Error(`There is already a view called "${settings.name}".`);
      const base = slug(settings.name, '-') || 'view';
      let id = base;
      for (let suffix = 2; object.views.some((view) => view.id === id); suffix += 1) id = `${base}-${suffix}`;
      const created: ViewDefinition = { id, ...settings };
      object.views.push(created);
      return created;
    }),

  deleteView: (input) =>
    respond(() => {
      const object = definition(input.objectId);
      if (object.views.length <= 1) throw new Error('An object needs at least one view.');
      object.views = object.views.filter((view) => view.id !== input.viewId);
      return object;
    }),

  // Stage rules and duplicate finding are the server's; the demo keeps neither.
  saveStageRules: (input) => respond(() => definition(input.objectId)),
  findDuplicates: (input) => respond(() => ({ property: definition(input.objectId).primaryProperty, groups: [], total: 0 })),

  importRecords: (input) => respond(() => importRecords(input)),

  mergeRecords: (input) => respond(() => mergeRecords(input)),

  listNotifications: () =>
    respond(() => {
      const list = allNotifications();
      const result: Record<string, Reference> = {};
      for (const item of list) {
        const record = item.recordId ? dataset().byId.get(item.recordId) : undefined;
        if (record && item.recordId) result[item.recordId] = { objectId: record.objectId, label: label(item.recordId) };
      }
      return { notifications: list, references: result };
    }),

  markNotificationsRead: (id) =>
    respond(() => {
      for (const item of allNotifications()) if (!id || item.id === id) item.read = true;
    }),

  createActivity: (input) =>
    respond(() => {
      sequence += 1;
      const created: Activity = { id: `act_new_${sequence}`, actorId: session.userId, occurredAt: new Date().toISOString(), ...input };
      createdActivity.set(input.recordId, [created, ...(createdActivity.get(input.recordId) ?? [])]);
      return created;
    }),
};
