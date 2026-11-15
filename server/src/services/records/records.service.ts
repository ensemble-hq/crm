import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { type SQL, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ObjectDefinition, PropertyValue } from '../../../../src/contracts/metadata';
import type { CreateRecord, CrmRecord, Duplicates, MergeRecords, ListQuery, ListResult, RecordDetail, Reference, RelatedGroup, SummaryQuery, SummaryRow, UpdateRecord, LabelRecords, LabelResult } from '../../../../src/contracts/records';
import { actorOf, assertCan, visibility } from '../people/access';
import { compute, isEditable, problemWith } from '../../../../src/lib/rules';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { RecordEvents } from './records.events';
import { condition, order, property, propertyText, search, tokens } from './records.query';
import type { RecordsRepository } from './records.repository';

/** How many linked records a record page shows per object before "see all". */
const RELATED_LIMIT = 5;

function empty(value: PropertyValue | undefined): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** The most records one labelling may touch. */
const LABEL_LIMIT = 5_000;

export class RecordsService {
  constructor(
    private readonly records: RecordsRepository,
    private readonly workspace: WorkspaceService,
    private readonly events: RecordEvents,
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
      const links = pointing.map((reference) => sql`${propertyText(reference.id)} = ${id}`);
      // A contact is also on the deals where they were given a part to play.
      if (object.lineItems && record.objectId === 'contacts') links.push(sql`records.id in (select deal_id from deal_people where tenant_id = ${ctx.tenantId} and contact_id = ${id})`);
      const where = [sql`records.object_id = ${object.id}`, ...this.visible(ctx), sql`(${sql.join(links, sql` or `)})`];
      const [records, total] = await Promise.all([this.records.select(ctx, where, sql`records.created_at desc, records.id`, RELATED_LIMIT, 0), this.records.total(ctx, where)]);
      groups.push({ objectId: object.id, total, records });
    }
    return groups;
  }

  /** Checks values against the object's definition: required fields, email addresses, and values that must be unique. */
  private async validate(ctx: Context, object: ObjectDefinition, values: Record<string, PropertyValue>, recordId: string | undefined): Promise<void> {
    for (const key of Object.keys(values)) property(object, key);
    for (const definition of object.properties) {
      // A computed field is never typed, so it is never checked as if it had been.
      if (!isEditable(definition)) continue;
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
    const typed = { ...input.properties, createdAt: new Date().toISOString().slice(0, 10) };
    // Computed fields are worked out from what was typed, then the whole record is checked against the object's rules.
    const properties = { ...typed, ...compute(object, typed) };
    const problem = problemWith(object, undefined, properties);
    if (problem) throw new ValidationError(problem);
    return this.events.transaction(ctx, async () => {
      const record = await this.records.insert(ctx, { id: `${object.id.slice(0, 3)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`, objectId: object.id, properties });
      await this.events.created(ctx, record);
      return record;
    });
  }

  async update(ctx: Context, input: UpdateRecord): Promise<CrmRecord> {
    const record = await this.find(ctx, input.id);
    const object = await this.workspace.definition(ctx, record.objectId);
    assertCan(actorOf(ctx), 'edit', record, object.singular.toLowerCase());
    await this.validate(ctx, object, input.properties, record.id);
    // Only what really changed is announced, so saving a form untouched sets nothing off.
    const after = { ...record.properties, ...input.properties };
    const patch = { ...input.properties, ...compute(object, after) };
    const problem = problemWith(object, record.properties, { ...after, ...patch });
    if (problem) throw new ValidationError(problem);
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(record.properties[key] ?? null) !== JSON.stringify(value ?? null)));
    return this.events.transaction(ctx, async () => {
      const updated = (await this.records.patch(ctx, record.id, patch)) ?? record;
      await this.events.changed(ctx, updated, changed);
      return updated;
    });
  }

  /**
   * Folds one record into another: the kept record takes the chosen values, everything that pointed
   * at the other now points at it, and the other is removed. All of it happens or none of it does.
   */
  async merge(ctx: Context, input: MergeRecords): Promise<CrmRecord> {
    if (input.keepId === input.mergeId) throw new ValidationError('Choose two different records.');
    const [keep, merged] = [await this.find(ctx, input.keepId), await this.find(ctx, input.mergeId)];
    if (keep.objectId !== merged.objectId) throw new ValidationError('Only two records of the same kind can be merged.');
    const objects = await this.workspace.definitions(ctx);
    const object = objects.find((item) => item.id === keep.objectId);
    if (!object) throw new NotFoundError('object', keep.objectId);
    const actor = actorOf(ctx);
    const noun = object.singular.toLowerCase();
    assertCan(actor, 'edit', keep, noun);
    assertCan(actor, 'delete', merged, noun);
    const references = objects.flatMap((other) => other.properties.filter((item) => item.type === 'reference' && item.referenceObjectId === object.id).map((item) => ({ objectId: other.id, propertyId: item.id })));
    const changed = Object.fromEntries(Object.entries(input.properties).filter(([key, value]) => JSON.stringify(keep.properties[key] ?? null) !== JSON.stringify(value ?? null)));
    return this.events.transaction(ctx, async () => {
      // The other record goes first, so a unique value moving across does not clash with itself.
      await this.records.remove(ctx, [merged.id]);
      await this.validate(ctx, object, input.properties, keep.id);
      const updated = (await this.records.patch(ctx, keep.id, input.properties)) ?? keep;
      await this.records.repoint(ctx, merged.id, keep.id, references);
      await this.records.repointDealPeople(ctx, merged.id, keep.id);
      await this.events.changed(ctx, updated, changed);
      await this.events.deleted(ctx, merged);
      return updated;
    });
  }

  /** Sets of records that share a value which should be one of a kind. */
  async duplicates(ctx: Context, input: { objectId: string; property?: string }): Promise<Duplicates> {
    const object = await this.workspace.definition(ctx, input.objectId);
    // The most telling field the object has: an email address, a website, or failing those the name.
    const chosen = input.property ?? object.properties.find((item) => item.type === 'email')?.id ?? object.properties.find((item) => item.id === 'domain' || item.type === 'url')?.id ?? object.primaryProperty;
    property(object, chosen);
    const where = this.where(ctx, object, {});
    const { groups, total } = await this.records.sharedValues(ctx, where, chosen, 50);
    const records = await this.records.byIds(ctx, groups.flatMap((group) => group.ids.slice(0, 5)), ...this.visible(ctx));
    return { property: chosen, total, groups: groups.map((group) => ({ value: group.value, count: group.count, records: group.ids.slice(0, 5).flatMap((id) => records.filter((record) => record.id === id)) })) };
  }

  /** The conditions for an object's records that pass some filters and that the acting person may see. For services that build their own queries on top. */
  async conditions(ctx: Context, objectId: string, filters: NonNullable<ListQuery['filters']>): Promise<{ object: ObjectDefinition; where: SQL[] }> {
    const object = await this.workspace.definition(ctx, objectId);
    return { object, where: this.where(ctx, object, { filters }) };
  }

  /** How many of an object's records pass some conditions, out of how many the person can see. */
  async count(ctx: Context, objectId: string, conditions: NonNullable<ListQuery['filters']>): Promise<{ matching: number; total: number }> {
    const object = await this.workspace.definition(ctx, objectId);
    const [matching, total] = await Promise.all([this.records.total(ctx, this.where(ctx, object, { filters: conditions })), this.records.total(ctx, this.where(ctx, object, {}))]);
    return { matching, total };
  }

  /** Adds or removes choices of a several-choices field on many records, leaving their other choices alone. */
  async label(ctx: Context, input: LabelRecords): Promise<LabelResult> {
    const object = await this.workspace.definition(ctx, input.objectId);
    const field = property(object, input.property);
    if (field.type !== 'multiselect' || !isEditable(field)) throw new ValidationError(`${field.label} is not a field that holds several choices.`);
    const add = input.add ?? [];
    const remove = input.remove ?? [];
    if (add.length + remove.length === 0) throw new ValidationError('Say what to add or remove.');
    const unknown = add.find((choice) => !field.options?.some((option) => option.id === choice));
    if (unknown) throw new ValidationError(`${field.label} has no choice "${unknown}". Add it to the field first.`);
    const inObject = sql`records.object_id = ${object.id}`;
    let targets: CrmRecord[];
    if (input.ids) targets = await this.records.byIds(ctx, input.ids, inObject, ...this.visible(ctx));
    else {
      const where = this.where(ctx, object, { viewId: input.viewId, filters: input.filters, search: input.search });
      if ((await this.records.total(ctx, where)) > LABEL_LIMIT) throw new ValidationError(`That is more than ${LABEL_LIMIT.toLocaleString('en-US')} ${object.plural.toLowerCase()}. Narrow it down and do it in parts.`);
      targets = await this.records.select(ctx, where, sql`records.id`, LABEL_LIMIT, 0);
    }
    const actor = actorOf(ctx);
    const changes: Array<{ record: CrmRecord; changes: Record<string, PropertyValue> }> = [];
    let unchanged = 0;
    let skipped = 0;
    for (const record of targets) {
      try {
        assertCan(actor, 'edit', record, object.singular.toLowerCase());
      } catch {
        skipped += 1;
        continue;
      }
      const current = Array.isArray(record.properties[field.id]) ? (record.properties[field.id] as string[]) : [];
      const next = [...current.filter((choice) => !remove.includes(choice)), ...add.filter((choice) => !current.includes(choice))];
      if (next.length === current.length && next.every((choice, index) => choice === current[index])) unchanged += 1;
      // A score or formula that counts on the field is worked out again with it.
      else changes.push({ record, changes: { [field.id]: next, ...compute(object, { ...record.properties, [field.id]: next }) } });
    }
    await this.events.transaction(ctx, async () => {
      for (let start = 0; start < changes.length; start += 1_000) {
        const batch = changes.slice(start, start + 1_000);
        await this.records.patchMany(ctx, batch.map((item) => ({ id: item.record.id, changes: item.changes })));
        // Each record is announced like any other change, so workflows that watch the field run.
        for (const item of batch) await this.events.changed(ctx, { ...item.record, properties: { ...item.record.properties, ...item.changes } }, item.changes);
      }
    });
    return { changed: changes.length, unchanged, skipped };
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
    if (records.length === 0) return { deleted: 0 };
    return this.events.transaction(ctx, async () => {
      const deleted = await this.records.remove(ctx, records.map((record) => record.id));
      for (const record of records) await this.events.deleted(ctx, record);
      return { deleted };
    });
  }
}
