import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { type SQL, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ObjectDefinition, PropertyValue } from '../../../../src/contracts/metadata';
import type { CreateRecord, CrmRecord, ListQuery, ListResult, RecordDetail, Reference, RelatedGroup, SummaryQuery, SummaryRow, UpdateRecord } from '../../../../src/contracts/records';
import { actorOf, assertCan, visibility } from '../people/access';
import type { WorkspaceService } from '../workspace/workspace.service';
import { condition, order, property, propertyText, search, tokens } from './records.query';
import type { RecordsRepository } from './records.repository';

/** How many linked records a record page shows per object before "see all". */
const RELATED_LIMIT = 5;

function empty(value: PropertyValue | undefined): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

export class RecordsService {
  constructor(
    private readonly records: RecordsRepository,
    private readonly workspace: WorkspaceService,
  ) {}

  /** What the acting person may see comes first; filters and search only narrow it. */
  private visible(ctx: Context): SQL[] {
    const condition = visibility(actorOf(ctx));
    return condition ? [condition] : [];
  }

  /** The conditions a query amounts to: its object, its view's filters, its own filters and its search. */
  private where(ctx: Context, object: ObjectDefinition, query: { viewId?: string; filters?: ListQuery['filters']; search?: string }): SQL[] {
    const view = query.viewId ? object.views.find((item) => item.id === query.viewId) : undefined;
    const resolve = tokens(ctx.userId);
    const where: SQL[] = [sql`records.object_id = ${object.id}`, ...this.visible(ctx)];
    for (const filter of [...(view?.filters ?? []), ...(query.filters ?? [])]) where.push(condition(object, filter, resolve));
    const needle = query.search?.trim();
    if (needle) where.push(search(object, needle));
    return where;
  }

  /** Names for the records these ones link to, so a list never fetches per row. */
  private async references(ctx: Context, objects: ObjectDefinition[], records: CrmRecord[]): Promise<Record<string, Reference>> {
    const wanted = new Map<string, string>();
    for (const record of records) {
      for (const definition of objects.find((object) => object.id === record.objectId)?.properties ?? []) {
        const target = record.properties[definition.id];
        if (definition.type === 'reference' && typeof target === 'string') wanted.set(target, definition.referenceObjectId ?? '');
      }
    }
    const found = await this.records.byIds(ctx, [...wanted.keys()]);
    const result: Record<string, Reference> = {};
    for (const record of found) {
      const primary = objects.find((object) => object.id === record.objectId)?.primaryProperty;
      const label = primary ? record.properties[primary] : undefined;
      result[record.id] = { objectId: record.objectId, label: typeof label === 'string' ? label : record.id };
    }
    return result;
  }

  async list(ctx: Context, query: ListQuery): Promise<ListResult> {
    const objects = await this.workspace.definitions(ctx);
    const object = objects.find((item) => item.id === query.objectId);
    if (!object) throw new NotFoundError('object', query.objectId);
    const view = query.viewId ? object.views.find((item) => item.id === query.viewId) : undefined;
    const where = this.where(ctx, object, query);
    const orderBy = order(object, query.sort ?? view?.sort, (objectId) => objects.find((item) => item.id === objectId)?.primaryProperty);
    const [records, total] = await Promise.all([this.records.select(ctx, where, orderBy, query.pageSize, (query.page - 1) * query.pageSize), this.records.total(ctx, where)]);
    return { records, total, references: await this.references(ctx, objects, records) };
  }

  async summarize(ctx: Context, query: SummaryQuery): Promise<SummaryRow[]> {
    const object = await this.workspace.definition(ctx, query.objectId);
    property(object, query.groupBy);
    if (query.sumProperty) property(object, query.sumProperty);
    return this.records.groups(ctx, this.where(ctx, object, query), query.groupBy, query.sumProperty);
  }

  async find(ctx: Context, id: string): Promise<CrmRecord> {
    // A record the person may not see is reported the same way as one that does not exist.
    const record = await this.records.one(ctx, id, ...this.visible(ctx));
    if (!record) throw new NotFoundError('record', id);
    return record;
  }

  async get(ctx: Context, id: string): Promise<RecordDetail> {
    const record = await this.find(ctx, id);
    return { record, references: await this.references(ctx, await this.workspace.definitions(ctx), [record]) };
  }

  async related(ctx: Context, id: string): Promise<RelatedGroup[]> {
    const record = await this.find(ctx, id);
    const objects = await this.workspace.definitions(ctx);
    const own = objects.find((object) => object.id === record.objectId);
    const groups: RelatedGroup[] = [];
    // Records this one points at.
    for (const definition of own?.properties ?? []) {
      if (definition.type !== 'reference' || !definition.referenceObjectId) continue;
      const target = record.properties[definition.id];
      const linked = typeof target === 'string' ? await this.records.one(ctx, target, ...this.visible(ctx)) : undefined;
      groups.push({ objectId: definition.referenceObjectId, total: linked ? 1 : 0, records: linked ? [linked] : [] });
    }
    // Records of other objects that point at this one.
    for (const object of objects) {
      const pointing = object.properties.filter((candidate) => candidate.type === 'reference' && candidate.referenceObjectId === record.objectId);
      if (pointing.length === 0 || groups.some((group) => group.objectId === object.id)) continue;
      const where = [sql`records.object_id = ${object.id}`, ...this.visible(ctx), sql`(${sql.join(pointing.map((reference) => sql`${propertyText(reference.id)} = ${id}`), sql` or `)})`];
      const [records, total] = await Promise.all([this.records.select(ctx, where, sql`records.created_at desc, records.id`, RELATED_LIMIT, 0), this.records.total(ctx, where)]);
      groups.push({ objectId: object.id, total, records });
    }
    return groups;
  }

  /** Checks values against the object's definition: required fields, email addresses, and values that must be unique. */
  private async validate(ctx: Context, object: ObjectDefinition, values: Record<string, PropertyValue>, recordId: string | undefined): Promise<void> {
    for (const key of Object.keys(values)) property(object, key);
    for (const definition of object.properties) {
      if (definition.system) continue;
      if (!(definition.id in values) && recordId !== undefined) continue;
      const value = values[definition.id] ?? null;
      if (empty(value)) {
        if (definition.required || definition.id === object.primaryProperty) throw new ValidationError(`${definition.label} is required.`);
        continue;
      }
      if (definition.type === 'email' && typeof value === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new ValidationError(`"${value}" is not an email address.`);
      if (definition.unique) {
        const where = [sql`records.object_id = ${object.id}`, sql`records.properties->${definition.id}::text = ${JSON.stringify(value)}::jsonb`];
        if (recordId) where.push(sql`records.id <> ${recordId}`);
        if ((await this.records.total(ctx, where)) > 0) throw new ConflictError(`Another ${object.singular.toLowerCase()} already has ${definition.label.toLowerCase()} "${String(value)}".`);
      }
    }
  }

  async create(ctx: Context, input: CreateRecord): Promise<CrmRecord> {
    const object = await this.workspace.definition(ctx, input.objectId);
    await this.validate(ctx, object, input.properties, undefined);
    const properties = { ...input.properties, createdAt: new Date().toISOString().slice(0, 10) };
    return this.records.insert(ctx, { id: `${object.id.slice(0, 3)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`, objectId: object.id, properties });
  }

  async update(ctx: Context, input: UpdateRecord): Promise<CrmRecord> {
    const record = await this.find(ctx, input.id);
    const object = await this.workspace.definition(ctx, record.objectId);
    assertCan(actorOf(ctx), 'edit', record, object.singular.toLowerCase());
    await this.validate(ctx, object, input.properties, record.id);
    return (await this.records.patch(ctx, record.id, input.properties)) ?? record;
  }

  reassign(ctx: Context, fromId: string, toId: string): Promise<number> {
    return this.records.reassign(ctx, fromId, toId);
  }

  async remove(ctx: Context, ids: string[]): Promise<{ deleted: number }> {
    const actor = actorOf(ctx);
    const objects = await this.workspace.definitions(ctx);
    const records = await this.records.byIds(ctx, ids, ...this.visible(ctx));
    // All or nothing: one record the person may not delete stops the whole request.
    for (const record of records) assertCan(actor, 'delete', record, objects.find((object) => object.id === record.objectId)?.singular.toLowerCase() ?? 'record');
    return { deleted: records.length === 0 ? 0 : await this.records.remove(ctx, records.map((record) => record.id)) };
  }
}
