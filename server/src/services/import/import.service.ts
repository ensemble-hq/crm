import type { Context } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { PropertyDefinition, PropertyValue, User } from '../../../../src/contracts/metadata';
import type { CrmRecord, ImportRequest, ImportResult } from '../../../../src/contracts/records';
import { compute } from '../../../../src/lib/rules';
import { actorOf, assertCan } from '../people/access';
import type { PeopleService } from '../people/people.service';
import type { RecordEvents } from '../records/records.events';
import type { RecordsRepository } from '../records/records.repository';
import type { WorkspaceService } from '../workspace/workspace.service';

/**
 * Brings a file's rows into the CRM. Values arrive as text and are turned into each property's
 * type; rows can be matched to existing records so an import never makes duplicates. Everything
 * the file needs to look up (existing records, linked records by name, values that must be unique)
 * is read once, so a file of thousands of rows is a handful of queries, and each new or changed
 * record is announced like any other, so workflows run for imported records too.
 */

const CHUNK = 500;

function empty(value: PropertyValue | undefined): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

type Lookups = { users: User[]; references: Map<string, Map<string, string>> };

/** Turns the text from a file's cell into the value a property holds. `undefined` means "could not understand it". */
function coerce(text: string, definition: PropertyDefinition, lookups: Lookups): PropertyValue | undefined {
  const value = text.trim();
  if (value === '') return null;
  const lower = value.toLowerCase();
  switch (definition.type) {
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
      return definition.options?.find((option) => option.label.toLowerCase() === lower || option.id === lower)?.id;
    case 'multiselect': {
      const ids = value.split(/[;|]/).map((part) => definition.options?.find((option) => option.label.toLowerCase() === part.trim().toLowerCase())?.id);
      return ids.every((id): id is string => id !== undefined) ? ids : undefined;
    }
    case 'user':
      return lookups.users.find((user) => user.name.toLowerCase() === lower || user.email.toLowerCase() === lower)?.id;
    case 'reference':
      return lookups.references.get(definition.id)?.get(lower);
    default:
      return value;
  }
}

export class ImportService {
  constructor(
    private readonly records: RecordsRepository,
    private readonly events: RecordEvents,
    private readonly workspace: WorkspaceService,
    private readonly people: PeopleService,
  ) {}

  async run(ctx: Context, input: ImportRequest): Promise<ImportResult> {
    const actor = actorOf(ctx);
    const objects = await this.workspace.definitions(ctx);
    const object = objects.find((item) => item.id === input.objectId);
    if (!object) return { created: [], updated: 0, skipped: input.rows.map((_, index) => ({ row: index + 1, reason: 'That kind of record no longer exists.' })), warnings: [] };
    const noun = object.singular.toLowerCase();
    const used = new Set(input.rows.flatMap((row) => Object.keys(row)));
    const matchOn = input.matchOn ? object.properties.find((item) => item.id === input.matchOn) : undefined;

    // Read once: who people are, what linked records are called, what is already here, and which unique values are taken.
    const lookups: Lookups = { users: await this.people.users(ctx), references: new Map() };
    for (const definition of object.properties) {
      const target = definition.type === 'reference' && used.has(definition.id) ? objects.find((item) => item.id === definition.referenceObjectId) : undefined;
      if (target) lookups.references.set(definition.id, await this.records.index(ctx, target.id, target.primaryProperty));
    }
    const existing = matchOn ? await this.records.index(ctx, object.id, matchOn.id) : new Map<string, string>();
    const taken = new Map<string, Map<string, string>>();
    for (const definition of object.properties) if (definition.unique && (used.has(definition.id) || definition.id in (input.defaults ?? {}))) taken.set(definition.id, definition.id === matchOn?.id ? existing : await this.records.index(ctx, object.id, definition.id));

    const result: ImportResult = { created: [], updated: 0, skipped: [], warnings: [] };
    const seen = new Set<string>();
    const creates: Array<{ id: string; objectId: string; properties: Record<string, PropertyValue> }> = [];
    const updates: Array<{ row: number; id: string; changes: Record<string, PropertyValue> }> = [];

    /** The same checks a record made by hand gets. Returns what is wrong, in words, or nothing. */
    const invalid = (values: Record<string, PropertyValue>, recordId: string | undefined): string | undefined => {
      for (const definition of object.properties) {
        if (definition.system) continue;
        if (!(definition.id in values) && recordId !== undefined) continue;
        const value = values[definition.id] ?? null;
        if (empty(value)) {
          if (definition.required || definition.id === object.primaryProperty) return `${definition.label} is required.`;
          continue;
        }
        if (definition.type === 'email' && typeof value === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return `"${value}" is not an email address.`;
        const holder = typeof value === 'string' ? taken.get(definition.id)?.get(value.toLowerCase()) : undefined;
        if (holder && holder !== recordId) return `Another ${noun} already has ${definition.label.toLowerCase()} "${value}".`;
      }
      return undefined;
    };
    const claim = (values: Record<string, PropertyValue>, recordId: string) => {
      for (const [propertyId, index] of taken) {
        const value = values[propertyId];
        if (typeof value === 'string' && value !== '') index.set(value.toLowerCase(), recordId);
      }
    };

    input.rows.forEach((row, index) => {
      const position = index + 1;
      const values: Record<string, PropertyValue> = {};
      for (const [propertyId, text] of Object.entries(row)) {
        const definition = object.properties.find((item) => item.id === propertyId);
        if (!definition || definition.system) continue;
        const value = coerce(text, definition, lookups);
        if (value === undefined) result.warnings.push({ row: position, message: `${definition.label}: "${text}" was not understood and was left empty.` });
        else values[propertyId] = value;
      }
      const key = matchOn && typeof values[matchOn.id] === 'string' ? (values[matchOn.id] as string).toLowerCase() : undefined;
      if (key && seen.has(key)) {
        result.skipped.push({ row: position, reason: `Repeats ${matchOn?.label.toLowerCase()} "${String(values[matchOn?.id ?? ''])}" from an earlier row.` });
        return;
      }
      if (key) seen.add(key);
      const matchId = key ? existing.get(key) : undefined;
      if (matchId) {
        if (input.onMatch === 'skip') {
          result.skipped.push({ row: position, reason: `Already in the CRM (matched on ${matchOn?.label.toLowerCase()}).` });
          return;
        }
        // Only fill in what the file has; an empty cell never wipes an existing value.
        const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => !empty(value)));
        const problem = invalid(changes, matchId);
        if (problem) result.skipped.push({ row: position, reason: problem });
        else {
          claim(changes, matchId);
          updates.push({ row: position, id: matchId, changes });
        }
        return;
      }
      const properties = { ...(input.defaults ?? {}), ...values };
      const problem = invalid(properties, undefined);
      if (problem) {
        result.skipped.push({ row: position, reason: problem });
        return;
      }
      const id = input.dryRun ? `row_${position}` : `${object.id.slice(0, 3)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      claim(properties, id);
      const whole = { ...properties, createdAt: new Date().toISOString().slice(0, 10) };
      creates.push({ id, objectId: object.id, properties: { ...whole, ...compute(object, whole) } });
      result.created.push(id);
    });

    // A matched record is only changed if the person could change it by hand.
    const allowed: Array<{ record: CrmRecord; changes: Record<string, PropertyValue> }> = [];
    for (let start = 0; start < updates.length; start += CHUNK) {
      const chunk = updates.slice(start, start + CHUNK);
      const found = new Map((await this.records.byIds(ctx, chunk.map((item) => item.id))).map((record) => [record.id, record]));
      for (const item of chunk) {
        const record = found.get(item.id);
        try {
          if (!record) throw new Error('It was deleted while the import ran.');
          assertCan(actor, 'edit', record, noun);
          allowed.push({ record, changes: { ...item.changes, ...compute(object, { ...record.properties, ...item.changes }) } });
          result.updated += 1;
        } catch (error) {
          result.skipped.push({ row: item.row, reason: `Already in the CRM, and not changed: ${error instanceof Error ? error.message : 'you may not edit it.'}` });
        }
      }
    }
    result.skipped.sort((a, b) => a.row - b.row);
    if (input.dryRun) return result;

    for (let start = 0; start < creates.length; start += CHUNK) {
      const chunk = creates.slice(start, start + CHUNK);
      await this.events.transaction(ctx, async () => {
        await this.records.insertMany(ctx, chunk);
        for (const record of chunk) await this.events.created(ctx, { ...record, createdAt: '', updatedAt: '' });
      });
    }
    for (let start = 0; start < allowed.length; start += CHUNK) {
      const chunk = allowed.slice(start, start + CHUNK);
      await this.events.transaction(ctx, async () => {
        await this.records.patchMany(ctx, chunk.map((item) => ({ id: item.record.id, changes: item.changes })));
        for (const { record, changes } of chunk) {
          const changed = Object.fromEntries(Object.entries(changes).filter(([key, value]) => JSON.stringify(record.properties[key] ?? null) !== JSON.stringify(value)));
          await this.events.changed(ctx, record, changed);
        }
      });
    }
    return result;
  }
}

