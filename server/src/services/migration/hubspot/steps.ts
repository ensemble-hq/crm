import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ObjectDefinition, Option, PropertyDefinition, PropertyValue } from '../../../../../src/contracts/metadata';
import type { LinkMap } from '../../../../../src/contracts/migration';
import { compute } from '../../../../../src/lib/rules';
import type { MigrationSource } from '../source';
import { type NewStep, type Registry, type StepHandler, type StepIO, id } from '../steps';
import { ALSO_BRING, type HubSpotProperty, type Lookups, NOT_CHOICES, SAME_CHOICE, STANDARD, type Standard, TYPE_IDS, coerce, plain, propertyOf, sameOption, slug, typeFor } from './mapping';

/**
 * What each kind of step does for HubSpot. Every handler reads one page, counts what it found,
 * and returns the writes for the engine to make. See `../steps.ts` for the contract they keep.
 */

type List<T> = { results?: T[]; paging?: { next?: { after?: string } } };
type Item = { id: string; properties?: Record<string, string | null>; createdAt?: string; associations?: Record<string, { results?: Array<{ id: string | number }> }> };

const PAGE = '100';
/** Where a step got to is kept as `{ after }`: HubSpot's own marker for the next page. */
const after = (cursor: unknown) => {
  const value = (cursor as { after?: unknown } | null)?.after;
  return typeof value === 'string' && value !== '' ? value : undefined;
};
const onward = (next: string | null) => (next === null ? null : { after: next });
const nextOf = (list: List<unknown>) => list.paging?.next?.after ?? null;
const empty = (value: PropertyValue | undefined) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
const isChoice = (property: PropertyDefinition | undefined): property is PropertyDefinition => property?.type === 'select' || property?.type === 'multiselect';
const lower = (text: string) => text.trim().toLowerCase();

/** One page of an object type's records. A long list of fields is asked for in several requests, so no address gets too long for HubSpot. */
async function readObjects(source: MigrationSource, type: string, cursor: string | undefined, properties: string[], associations: string[]): Promise<{ results: Item[]; next: string | null }> {
  const groups: string[][] = [[]];
  for (const name of properties) {
    const last = groups[groups.length - 1] as string[];
    if (last.join(',').length + name.length > 3_000) groups.push([name]);
    else last.push(name);
  }
  let results: Item[] | undefined;
  let next: string | null = null;
  for (const [index, names] of groups.entries()) {
    const list = (await source.get(`/crm/v3/objects/${type}`, { limit: PAGE, archived: 'false', ...(cursor ? { after: cursor } : {}), ...(names.length > 0 ? { properties: names.join(',') } : {}), ...(index === 0 && associations.length > 0 ? { associations: associations.join(',') } : {}) })) as List<Item>;
    if (!results) {
      results = list.results ?? [];
      next = nextOf(list);
      continue;
    }
    const more = new Map((list.results ?? []).map((item) => [item.id, item.properties ?? {}]));
    for (const item of results) item.properties = { ...item.properties, ...more.get(item.id) };
  }
  return { results: results ?? [], next };
}

/** The ids of the records of another type that this one is associated with. */
function associated(item: Item, type: string): string[] {
  const all = item.associations ?? {};
  const key = Object.keys(all).find((name) => name === type || name.endsWith(`_${type}`));
  return key ? [...new Set((all[key]?.results ?? []).map((entry) => String(entry.id)))] : [];
}

// People

type Owner = { id: string; email?: string; firstName?: string; lastName?: string };

const people: StepHandler<'people'> = {
  // Two passes: the people who are in HubSpot now, then the ones who were removed but still own records.
  async page(io, spec, cursor) {
    const at = (cursor ?? {}) as { after?: string; archived?: boolean };
    const list = (await io.source.get('/crm/v3/owners', { limit: PAGE, archived: at.archived ? 'true' : 'false', ...(at.after ? { after: at.after } : {}) })) as List<Owner>;
    const owners = list.results ?? [];
    const members = await io.crm.people.findMany(io.ctx, {}, { limit: 1000 });
    const byEmail = new Map(members.map((member) => [lower(member.email), member.id]));
    const linked = await io.links.get(io.ctx, 'owner', owners.map((owner) => String(owner.id)));
    const pairs: Array<[string, string]> = [];
    const add: Array<{ id: string; name: string; email: string }> = [];
    for (const owner of owners) {
      io.counts.read += 1;
      const ownerId = String(owner.id);
      const email = owner.email ? lower(owner.email) : '';
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim() || email;
      const known = linked.get(ownerId);
      if (known && members.some((member) => member.id === known)) {
        io.counts.skipped += 1;
        continue;
      }
      if (!email) {
        io.issue('warning', 'A HubSpot user has no email address, so their records come across with no owner.', ownerId);
        continue;
      }
      const memberId = byEmail.get(email);
      if (memberId) {
        pairs.push([ownerId, memberId]);
        io.counts.skipped += 1;
        continue;
      }
      if (!spec.add) {
        io.issue('warning', `${name} (${email}) is not a member here, so their records come across with no owner.`, ownerId);
        continue;
      }
      const memberId2 = id('usr');
      add.push({ id: memberId2, name, email });
      byEmail.set(email, memberId2);
      pairs.push([ownerId, memberId2]);
      io.counts.created += 1;
    }
    const after2 = nextOf(list);
    return {
      next: after2 ? { ...at, after: after2 } : at.archived ? null : { archived: true },
      write: async () => {
        if (add.length > 0) {
          // New people get the plainest role there is: one that manages neither settings nor people.
          const roles = (await io.crm.db.execute(sql`select id, settings from roles where tenant_id = ${io.ctx.tenantId} order by position`)) as unknown as Array<{ id: string; settings: { manageSettings?: boolean; managePeople?: boolean } }>;
          const plainest = roles.find((role) => role.id === 'role_rep') ?? roles.find((role) => !role.settings.manageSettings && !role.settings.managePeople);
          if (!plainest) throw new Error('There is no role to give the people being added. Add a role that manages neither settings nor people, then try this step again.');
          // Someone removed from HubSpot is kept for their name on what they owned, with no way in.
          for (const person of add) await io.crm.people.create(io.ctx, { ...person, roleId: plainest.id, teamId: null, status: at.archived ? 'deactivated' : 'invited' });
        }
        await io.links.put(io.ctx, 'owner', pairs);
      },
    };
  },
};

// Deal stages

type Pipeline = { id: string; label: string; displayOrder?: number; stages?: Array<{ id: string; label: string; displayOrder?: number; metadata?: { probability?: string | number } }> };
const ordered = <T extends { displayOrder?: number }>(items: T[]) => [...items].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

const stages: StepHandler<'stages'> = {
  async page(io) {
    const { ctx } = io;
    const pipelines = ordered(((await io.source.get('/crm/v3/pipelines/deals')) as List<Pipeline>).results ?? []);
    const deals = (await io.crm.workspace.definitions(ctx)).find((item) => item.id === 'deals');
    const stage = deals?.board ? propertyOf(deals, deals.board.groupBy) : undefined;
    if (!deals || !stage) {
      io.issue('problem', 'This CRM has no deals that move through stages, so HubSpot pipelines have nowhere to go.');
      return { next: null };
    }
    const kind = `option:deals.${stage.id}`;
    const linked = await io.links.all(ctx, kind);
    const options: Option[] = [...(stage.options ?? [])];
    const pairs: Array<[string, string]> = [];
    let added = 0;
    for (const [index, pipeline] of pipelines.entries()) {
      for (const item of ordered(pipeline.stages ?? [])) {
        io.counts.read += 1;
        const known = linked.get(item.id);
        if (known && options.some((option) => option.id === known)) {
          io.counts.skipped += 1;
          continue;
        }
        // A stage HubSpot is certain about is the CRM's own won or lost, whatever the account calls it.
        const probability = item.metadata?.probability === undefined ? Number.NaN : Number(item.metadata.probability);
        const label = index === 0 ? item.label : `${pipeline.label}: ${item.label}`;
        let option = probability === 1 ? options.find((entry) => entry.id === 'won') : probability === 0 ? options.find((entry) => entry.id === 'lost') : undefined;
        option ??= sameOption(options, item.id, label);
        if (option) io.counts.skipped += 1;
        else {
          let optionId = slug(label) || item.id;
          for (let suffix = 2; options.some((entry) => entry.id === optionId); suffix += 1) optionId = `${slug(label) || item.id}-${suffix}`;
          option = { id: optionId, label, ...(probability === 1 ? { tone: 'success' as const } : probability === 0 ? { tone: 'danger' as const } : {}) };
          // Open stages sit before the closed ones.
          const closed = options.findIndex((entry) => entry.id === 'won' || entry.id === 'lost');
          if (closed >= 0 && probability !== 1 && probability !== 0) options.splice(closed, 0, option);
          else options.push(option);
          io.counts.created += 1;
          added += 1;
        }
        pairs.push([item.id, option.id]);
      }
    }
    const several = pipelines.length > 1;
    if (several) io.issue('note', `HubSpot has ${pipelines.length} deal pipelines and this CRM has one. Stages of the other pipelines are named with their pipeline, and each deal says which pipeline it was in.`);
    return {
      next: null,
      note: added > 0 ? `${added} new ${added === 1 ? 'stage' : 'stages'}.` : 'Every stage was already here.',
      write: async () => {
        if (added > 0) await io.crm.settings.updateProperty(ctx, { objectId: 'deals', propertyId: stage.id, options });
        await io.links.put(ctx, kind, pairs);
        if (!several) return;
        const choices = pipelines.map((pipeline) => ({ id: pipeline.id, label: pipeline.label }));
        const existing = deals.properties.find((item) => lower(item.label) === 'pipeline');
        const definition = existing ? await io.crm.settings.updateProperty(ctx, { objectId: 'deals', propertyId: existing.id, options: [...(existing.options ?? []).filter((option) => !choices.some((choice) => choice.id === option.id)), ...choices] }) : await io.crm.settings.createProperty(ctx, { objectId: 'deals', label: 'Pipeline', type: 'select', group: 'About', options: choices });
        const property = definition.properties.find((item) => lower(item.label) === 'pipeline');
        if (!property) return;
        await io.links.put(ctx, 'field:deals', [['pipeline', property.id]]);
        await io.links.put(ctx, `option:deals.${property.id}`, choices.map((choice) => [choice.id, choice.id]));
      },
    };
  },
};

// Fields

const fields: StepHandler<'fields'> = {
  async page(io, spec) {
    const { ctx } = io;
    const found = ((await io.source.get(`/crm/v3/properties/${spec.from}`)) as List<HubSpotProperty>).results ?? [];
    const object = (await io.crm.workspace.definitions(ctx)).find((item) => item.id === spec.to);
    if (!object && !io.dry) throw new Error(`There is no object "${spec.to}" in this CRM to add fields to.`);
    const standard = new Map((spec.from === spec.to ? (STANDARD[spec.from] ?? []) : []).flatMap((map) => map.from.map((name) => [name, map.to] as const)));
    const also = new Set(ALSO_BRING[spec.from] ?? []);
    const linked = await io.links.all(ctx, `field:${spec.from}`);
    const fieldPairs: Array<[string, string]> = [];
    const optionPairs = new Map<string, Array<[string, string]>>();
    const labelPairs = new Map<string, Array<[string, string]>>();
    const create: Array<{ property: HubSpotProperty; label: string; type: NonNullable<ReturnType<typeof typeFor>> }> = [];
    const labels = new Set((object?.properties ?? []).map((item) => lower(item.label)));

    /** Works out which choice of ours each of HubSpot's choices is. The ones that are none yet are remembered by name, and added when a record uses them. */
    const choices = (property: HubSpotProperty, target: PropertyDefinition) => {
      const same = SAME_CHOICE[`${spec.to}.${target.id}`] ?? {};
      for (const option of property.options ?? []) {
        const match = same[option.value] ? target.options?.find((item) => item.id === same[option.value]) : sameOption(target.options, option.value, option.label);
        const into = match ? optionPairs : labelPairs;
        into.set(target.id, [...(into.get(target.id) ?? []), [option.value, match ? match.id : option.label]]);
      }
    };

    for (const property of found) {
      io.counts.read += 1;
      const mapped = standard.get(property.name);
      if (property.archived || NOT_CHOICES.has(property.name)) {
        io.counts.skipped += 1;
        continue;
      }
      if (mapped) {
        const target = object ? propertyOf(object, mapped) : undefined;
        if (isChoice(target)) choices(property, target);
        io.counts.skipped += 1;
        continue;
      }
      // HubSpot's own fields (analytics, internal bookkeeping) stay behind unless they are on the short list worth having.
      if (property.hubspotDefined && !also.has(property.name)) {
        io.counts.skipped += 1;
        continue;
      }
      const known = linked.get(property.name);
      const existing = object?.properties.find((item) => item.id === known) ?? (known ? undefined : object?.properties.find((item) => lower(item.label) === lower(property.label)));
      if (existing) {
        fieldPairs.push([property.name, existing.id]);
        if (isChoice(existing)) choices(property, existing);
        if (!known) io.issue('note', `"${property.label}" was matched to the property of the same name that was already here.`, property.name);
        io.counts.skipped += 1;
        continue;
      }
      const type = typeFor(property);
      if (!type) {
        io.issue('warning', `"${property.label}" holds a kind of value (${property.type}) this CRM has no field for, so it is left behind.`, property.name);
        continue;
      }
      if (property.calculated) io.issue('note', `"${property.label}" is worked out by HubSpot. Here it holds the value it had on the day of the move.`, property.name);
      // Two HubSpot fields can share a label; here labels are one of a kind.
      const label = labels.has(lower(property.label)) ? `${property.label} (${property.name})` : property.label;
      labels.add(lower(label));
      create.push({ property, label, type });
      io.counts.created += 1;
    }
    return {
      next: null,
      note: create.length > 0 ? `${create.length} new ${create.length === 1 ? 'property' : 'properties'}.` : 'No new properties were needed.',
      write: async () => {
        for (const { property, label, type } of create) {
          const choice = type === 'select' || type === 'multiselect';
          const options = choice ? (property.options ?? []).filter((option) => !option.hidden).map((option) => ({ id: option.value, label: option.label })) : undefined;
          const definition = await io.crm.settings.createProperty(ctx, { objectId: spec.to, label, type, group: 'HubSpot', options });
          const made = definition.properties.find((item) => lower(item.label) === lower(label));
          if (!made) continue;
          fieldPairs.push([property.name, made.id]);
          if (options) optionPairs.set(made.id, options.map((option) => [option.id, option.id]));
        }
        await io.links.put(ctx, `field:${spec.from}`, fieldPairs);
        for (const [propertyId, pairs] of optionPairs) await io.links.put(ctx, `option:${spec.to}.${propertyId}`, pairs);
        for (const [propertyId, pairs] of labelPairs) await io.links.put(ctx, `label:${spec.to}.${propertyId}`, pairs);
      },
    };
  },
};

// Custom objects

type Schema = { id?: string; objectTypeId?: string; name: string; labels?: { singular?: string; plural?: string }; primaryDisplayProperty?: string; associations?: Array<{ fromObjectTypeId?: string; toObjectTypeId?: string }> };

const objects: StepHandler<'objects'> = {
  async page(io) {
    const { ctx } = io;
    const schemas = ((await io.source.get('/crm/v3/schemas')) as List<Schema>).results ?? [];
    const definitions = await io.crm.workspace.definitions(ctx);
    const linked = await io.links.all(ctx, 'object');
    const steps: NewStep[] = [];
    const make: Array<{ typeId: string; to: string; singular: string; plural: string; primary?: string; exists: boolean }> = [];
    for (const schema of schemas) {
      io.counts.read += 1;
      const typeId = schema.objectTypeId ?? schema.id ?? schema.name;
      const plural = schema.labels?.plural?.trim() || schema.name;
      const singular = schema.labels?.singular?.trim() || plural;
      const known = linked.get(typeId);
      const to = known && definitions.some((item) => item.id === known) ? known : slug(plural);
      const exists = definitions.some((item) => item.id === to);
      if (exists) io.counts.skipped += 1;
      else io.counts.created += 1;
      make.push({ typeId, to, singular, plural, primary: schema.primaryDisplayProperty, exists });
      // What it is associated with among HubSpot's own objects becomes a link on each record.
      const links: LinkMap[] = [];
      for (const association of schema.associations ?? []) {
        const other = [association.toObjectTypeId, association.fromObjectTypeId].find((item) => item && item !== typeId && TYPE_IDS[item]);
        const target = other ? TYPE_IDS[other] : undefined;
        if (target && !links.some((link) => link.from === target.type)) links.push({ from: target.type, to: target.property });
      }
      steps.push({ title: `${singular} fields`, spec: { kind: 'fields', from: typeId, to } }, { title: plural, spec: { kind: 'records', from: typeId, to, links } });
    }
    return {
      next: null,
      steps,
      note: schemas.length === 0 ? 'This account has no custom objects.' : `${schemas.length} custom ${schemas.length === 1 ? 'object, with its own steps below' : 'objects, each with its own steps below'}.`,
      write: async () => {
        for (const item of make) {
          if (!item.exists) await io.crm.settings.createObject(ctx, { singular: item.singular, plural: item.plural, icon: 'box' });
          await io.links.put(ctx, 'object', [[item.typeId, item.to]]);
          // The field HubSpot shows as the record's name is its name here.
          if (item.primary) await io.links.put(ctx, `field:${item.typeId}`, [[item.primary, 'name']]);
        }
      },
    };
  },
};

// Records

const EMAIL_STATE = ['hs_email_optout', 'hs_email_hard_bounce_reason_enum', 'hs_email_quarantined'];

const records: StepHandler<'records'> = {
  async page(io, spec, cursor) {
    const { ctx } = io;
    const definitions = await io.crm.workspace.definitions(ctx);
    let object = definitions.find((item) => item.id === spec.to) as ObjectDefinition | undefined;
    if (!object) {
      // In a check, the object may be one a custom objects step would have made. Count, and say no more.
      if (!io.dry) throw new Error(`There is no object "${spec.to}" in this CRM to bring ${spec.from} into.`);
      const page = await readObjects(io.source, spec.from, after(cursor), [], []);
      io.counts.read += page.results.length;
      io.counts.created += page.results.length;
      return { next: onward(page.next) };
    }
    const objectId = object.id;

    // Links to other records: make sure each has a property to live in.
    const objectLinks = await io.links.all(ctx, 'object');
    const linkProperties: Array<{ from: string; propertyId: string }> = [];
    for (const link of spec.links ?? []) {
      const otherId = objectLinks.get(link.from) ?? link.from;
      const other = definitions.find((item) => item.id === otherId);
      if (!other) continue;
      const pointsThere = (item: PropertyDefinition) => item.type === 'reference' && item.referenceObjectId === other.id;
      let property = object.properties.find((item) => item.id === link.to && pointsThere(item)) ?? object.properties.find(pointsThere);
      if (!property && !io.dry) {
        object = await io.crm.settings.createProperty(ctx, { objectId, label: other.singular, type: 'reference', referenceObjectId: other.id, group: 'Associations' });
        property = object.properties.find(pointsThere);
      }
      if (property) linkProperties.push({ from: link.from, propertyId: property.id });
    }
    const definition = object;

    // Which field fills which property: the built-in mapping, then what the fields step found, then what this step says. Later wins.
    const maps = new Map<string, Standard>();
    for (const map of spec.from === spec.to ? (STANDARD[spec.from] ?? []) : []) maps.set(map.to, map);
    for (const [from, to] of await io.links.all(ctx, `field:${spec.from}`)) maps.set(to, { to, from: [from] });
    for (const field of spec.fields ?? []) maps.set(field.to, { to: field.to, from: [field.from] });
    const filled = [...maps.values()].flatMap((map) => {
      const property = propertyOf(definition, map.to);
      return property && !property.system && !property.formula && !property.scoring ? [{ ...map, property }] : [];
    });

    const owners = await io.links.all(ctx, 'owner');
    const optionLinks = new Map<string, Map<string, string>>();
    const labelLinks = new Map<string, Map<string, string>>();
    for (const { property } of filled) {
      if (!isChoice(property)) continue;
      optionLinks.set(property.id, await io.links.all(ctx, `option:${objectId}.${property.id}`));
      labelLinks.set(property.id, await io.links.all(ctx, `label:${objectId}.${property.id}`));
    }
    // A value with no choice yet becomes one, named as HubSpot names it.
    const added = new Map<string, Option[]>();
    const lookups: Lookups = {
      owners,
      option(property, raw) {
        const known = optionLinks.get(property.id)?.get(raw);
        if (known) return known;
        const label = labelLinks.get(property.id)?.get(raw);
        const same = sameOption([...(property.options ?? []), ...(added.get(property.id) ?? [])], raw, label);
        if (same) return same.id;
        added.set(property.id, [...(added.get(property.id) ?? []), { id: raw, label: label ?? raw }]);
        return raw;
      },
    };

    const names = [...new Set([...filled.flatMap((map) => map.from), ...(spec.emailStatus ? ['email', ...EMAIL_STATE] : [])])];
    const page = await readObjects(io.source, spec.from, after(cursor), names, linkProperties.map((link) => link.from));
    const ids = page.results.map((item) => String(item.id));
    const kind = `record:${spec.from}`;
    const linked = await io.links.get(ctx, kind, ids);
    const resolved = new Map<string, Map<string, string>>();
    for (const link of linkProperties) resolved.set(link.from, await io.links.get(ctx, `record:${link.from}`, page.results.flatMap((item) => associated(item, link.from).slice(0, 1))));

    // Records already here that are the same thing: matched on one property, and only if nothing else from HubSpot became them.
    const matchProperty = spec.match ? propertyOf(definition, spec.match) : undefined;
    const matchFrom = matchProperty ? filled.find((map) => map.to === matchProperty.id)?.from : undefined;
    const matchText = (item: Item) => (matchFrom ? (matchFrom.map((name) => item.properties?.[name]?.trim()).find(Boolean) ?? '') : '');
    const candidates = matchProperty ? await io.crm.records.idsByText(ctx, objectId, matchProperty.id, page.results.filter((item) => !linked.has(String(item.id))).map(matchText)) : new Map<string, string>();
    const taken = await io.links.taken(ctx, kind, [...candidates.values()]);
    const current = new Map((await io.crm.records.byIds(ctx, [...candidates.values()].filter((recordId) => !taken.has(recordId)))).map((record) => [record.id, record]));

    const primary = propertyOf(definition, definition.primaryProperty);
    const creates: Array<{ id: string; objectId: string; properties: Record<string, PropertyValue>; createdAt?: string }> = [];
    const updates: Array<{ id: string; changes: Record<string, PropertyValue> }> = [];
    const pairs: Array<[string, string]> = [];
    const stops: Array<{ email: string; status: 'unsubscribed' | 'blocked'; reason: string }> = [];

    for (const item of page.results) {
      io.counts.read += 1;
      const itemId = String(item.id);
      const source = item.properties ?? {};
      const values: Record<string, PropertyValue> = {};
      for (const map of filled) {
        const parts = map.from.map((name) => source[name]?.trim()).filter((part): part is string => Boolean(part));
        if (parts.length === 0) continue;
        const raw = map.join ? parts.join(' ') : (parts[0] as string);
        const value = coerce(raw, map.property, lookups);
        if (value === undefined) io.issue('warning', `${map.property.label}: "${raw.slice(0, 80)}" was not understood and was left empty.`, itemId);
        else if (value !== null) values[map.to] = value;
      }
      for (const link of linkProperties) {
        const [first] = associated(item, link.from);
        const target = first ? resolved.get(link.from)?.get(first) : undefined;
        if (target) values[link.propertyId] = target;
      }

      const email = typeof source.email === 'string' ? lower(source.email) : '';
      if (spec.emailStatus && email) {
        if (source.hs_email_hard_bounce_reason_enum || source.hs_email_quarantined === 'true') stops.push({ email, status: 'blocked', reason: 'Email to this address bounced in HubSpot.' });
        else if (source.hs_email_optout === 'true') stops.push({ email, status: 'unsubscribed', reason: 'Unsubscribed in HubSpot.' });
      }

      const known = linked.get(itemId);
      if (known) {
        if (Object.keys(values).length > 0) updates.push({ id: known, changes: values });
        io.counts.updated += 1;
        continue;
      }
      const match = current.get(candidates.get(lower(matchText(item))) ?? '');
      if (match) {
        // What is already here stays; only what was empty is filled in.
        const changes = Object.fromEntries(Object.entries(values).filter(([key]) => empty(match.properties[key])));
        if (Object.keys(changes).length > 0) updates.push({ id: match.id, changes });
        current.delete(match.id);
        pairs.push([itemId, match.id]);
        io.counts.updated += 1;
        continue;
      }
      if (primary && empty(values[primary.id])) {
        const standIn = [values.email, values.domain].find((value): value is string => typeof value === 'string' && value !== '');
        values[primary.id] = standIn ?? `Unnamed ${definition.singular.toLowerCase()}`;
        if (!standIn) io.issue('warning', `It has no name in HubSpot, so it is called "Unnamed ${definition.singular.toLowerCase()}" here.`, itemId);
      }
      // A choice that must be made and was not gets the first one, so the record can be saved.
      for (const property of definition.properties) if (property.required && property.type === 'select' && empty(values[property.id]) && property.options?.[0]) values[property.id] = property.options[0].id;
      const recordId = `${objectId.slice(0, 3)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const whole = { ...values, createdAt: (item.createdAt ?? new Date().toISOString()).slice(0, 10) };
      creates.push({ id: recordId, objectId, properties: { ...whole, ...compute(definition, whole) }, ...(item.createdAt ? { createdAt: item.createdAt } : {}) });
      pairs.push([itemId, recordId]);
      io.counts.created += 1;
    }

    return {
      next: onward(page.next),
      write: async () => {
        for (const [propertyId, options] of added) {
          const now = (await io.crm.workspace.definition(ctx, objectId)).properties.find((item) => item.id === propertyId);
          await io.crm.settings.updateProperty(ctx, { objectId, propertyId, options: [...(now?.options ?? []), ...options.filter((option) => !now?.options?.some((item) => item.id === option.id))] });
        }
        await io.crm.records.insertImported(ctx, creates);
        await io.crm.records.patchMany(ctx, updates);
        await io.links.put(ctx, kind, pairs);
        for (const stop of stops) await io.crm.rules.carryOver(ctx, stop.email, stop.status, stop.reason);
        // Scores and worked-out fields are settled once, when everything is in.
        if (page.next === null) await io.crm.settings.recompute(ctx, objectId);
      },
    };
  },
};

// Activity history

const USUAL: Record<string, { title?: string; body?: string; otherBody?: string; time?: string; fallback: string }> = {
  notes: { body: 'hs_note_body', fallback: 'Note' },
  calls: { title: 'hs_call_title', body: 'hs_call_body', fallback: 'Call' },
  emails: { title: 'hs_email_subject', body: 'hs_email_text', otherBody: 'hs_email_html', fallback: 'Email' },
  meetings: { title: 'hs_meeting_title', body: 'hs_meeting_body', time: 'hs_meeting_start_time', fallback: 'Meeting' },
};
/** The kinds of record history is logged on. */
const ABOUT = ['contacts', 'companies', 'deals'];

const activities: StepHandler<'activities'> = {
  async page(io, spec, cursor) {
    const { ctx } = io;
    const usual = USUAL[spec.from] ?? { fallback: `${spec.as.slice(0, 1).toUpperCase()}${spec.as.slice(1)}` };
    const titleField = spec.titleField ?? usual.title;
    const bodyField = spec.bodyField ?? usual.body;
    const timeField = spec.timeField ?? usual.time;
    const names = [titleField, bodyField, usual.otherBody, timeField, 'hs_timestamp', 'hubspot_owner_id'].filter((name): name is string => Boolean(name));
    const page = await readObjects(io.source, spec.from, after(cursor), [...new Set(names)], ABOUT);
    const owners = await io.links.all(ctx, 'owner');
    const resolved = new Map<string, Map<string, string>>();
    for (const type of ABOUT) resolved.set(type, await io.links.get(ctx, `record:${type}`, page.results.flatMap((item) => associated(item, type))));
    const kind = `activity:${spec.from}`;
    const wanted: Array<{ key: string; recordId: string; item: Item }> = [];
    for (const item of page.results) {
      io.counts.read += 1;
      const about = ABOUT.flatMap((type) => associated(item, type).map((otherId) => ({ type, otherId })));
      if (about.length === 0) {
        // History about nothing that came across has nowhere to be shown.
        io.counts.skipped += 1;
        continue;
      }
      if (io.dry) {
        io.counts.created += about.length;
        continue;
      }
      const targets = [...new Set(about.flatMap(({ type, otherId }) => resolved.get(type)?.get(otherId) ?? []))];
      if (targets.length === 0) io.counts.skipped += 1;
      for (const recordId of targets) wanted.push({ key: `${item.id}>${recordId}`, recordId, item });
    }
    const done = await io.links.get(ctx, kind, wanted.map((entry) => entry.key));
    const rows = wanted.filter((entry) => !done.has(entry.key)).map(({ key, recordId, item }) => {
      const source = item.properties ?? {};
      const at = new Date(source[timeField ?? ''] ?? source.hs_timestamp ?? item.createdAt ?? Date.now());
      const body = plain(bodyField ? source[bodyField] : undefined) || plain(usual.otherBody ? source[usual.otherBody] : undefined);
      return { key, row: { id: id('act'), recordId, kind: spec.as, title: (titleField ? source[titleField]?.trim() : '')?.slice(0, 200) || usual.fallback, body: body || null, actorId: owners.get(source.hubspot_owner_id ?? '') ?? (ctx.userId as string), occurredAt: Number.isNaN(at.getTime()) ? new Date() : at } };
    });
    io.counts.created += rows.length;
    io.counts.skipped += wanted.length - rows.length;
    return {
      next: onward(page.next),
      write: async () => {
        if (rows.length > 0) await io.crm.activities.createMany(ctx, rows.map((entry) => entry.row));
        await io.links.put(ctx, kind, rows.map((entry) => [entry.key, entry.row.id]));
      },
    };
  },
};

export const hubspotSteps: Registry = { people, stages, fields, objects, records, activities };
