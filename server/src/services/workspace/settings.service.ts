import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import type { CreateObject, CreateProperty, ObjectDefinition, SaveView, UpdateProperty, ViewDefinition } from '../../../../src/contracts/metadata';
import { actorOf, assertAllowed } from '../people/access';
import type { RecordsRepository } from '../records/records.repository';
import type { ObjectsRepository } from './workspace.repository';

/**
 * Changing the shape of the CRM: its objects, their properties and their saved views. These are
 * rows of data, so none of this is a migration and all of it takes effect at once.
 */

/** URL segments the app uses itself, so no object may take them. */
const RESERVED = new Set(['assistant', 'inbox', 'tasks', 'import', 'sequences', 'workflows', 'reports', 'forecast', 'forms', 'meetings', 'settings', 'f', 'book', 'api']);

/** "Renewal date" becomes `renewalDate` (joiner '') or `renewal-date` (joiner '-'). */
function slug(text: string, joiner: '' | '-'): string {
  const words = text.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (joiner === '-') return words.join('-');
  return words.map((word, index) => (index === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)).join('');
}

export class SettingsService {
  constructor(
    private readonly objects: ObjectsRepository,
    private readonly records: RecordsRepository,
    private readonly transaction: <T>(ctx: Context, fn: () => Promise<T>) => Promise<T>,
    /** Announces, inside the transaction, that the CRM's shape changed. */
    private readonly changed: (ctx: Context, objectId: string) => Promise<void>,
  ) {}

  /** Reads an object's definition, lets `change` alter it, and stores the result, as one step no other change can interleave with. */
  private async change<T>(ctx: Context, objectId: string, change: (object: ObjectDefinition) => Promise<T> | T): Promise<{ object: ObjectDefinition; result: T }> {
    return this.transaction(ctx, async () => {
      await this.objects.lock(ctx, objectId);
      const row = await this.objects.findById(ctx, objectId);
      if (!row) throw new NotFoundError('object', objectId);
      const object = structuredClone(row.definition);
      const result = await change(object);
      await this.objects.update(ctx, objectId, { definition: object });
      await this.changed(ctx, objectId);
      return { object, result };
    });
  }

  async createObject(ctx: Context, input: CreateObject): Promise<ObjectDefinition> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'add objects');
    const id = slug(input.plural, '-');
    if (!id) throw new ValidationError('Give the object a name.');
    if (RESERVED.has(id) || (await this.objects.findById(ctx, id))) throw new ConflictError(`"${input.plural}" is already in use.`);
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
    await this.transaction(ctx, async () => {
      await this.objects.create(ctx, { id, definition: created, position: await this.objects.count(ctx) });
      await this.changed(ctx, id);
    });
    return created;
  }

  async createProperty(ctx: Context, input: CreateProperty): Promise<ObjectDefinition> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'add properties');
    if (input.type === 'reference' && !(input.referenceObjectId && (await this.objects.findById(ctx, input.referenceObjectId)))) throw new ValidationError('Choose which kind of record this property links to.');
    const { object } = await this.change(ctx, input.objectId, (definition) => {
      const base = slug(input.label, '');
      if (!base) throw new ValidationError('Give the property a name.');
      if (definition.properties.some((item) => item.label.toLowerCase() === input.label.trim().toLowerCase())) throw new ConflictError(`${definition.plural} already have a property called "${input.label.trim()}".`);
      let id = base;
      for (let suffix = 2; definition.properties.some((item) => item.id === id); suffix += 1) id = `${base}${suffix}`;
      const choice = input.type === 'select' || input.type === 'multiselect';
      definition.properties.push({
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
      if (input.addToViews) for (const view of definition.views) view.columns.push(id);
    });
    return object;
  }

  async updateProperty(ctx: Context, input: UpdateProperty): Promise<ObjectDefinition> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'change properties');
    const { object } = await this.change(ctx, input.objectId, (definition) => {
      const found = definition.properties.find((item) => item.id === input.propertyId);
      if (!found) throw new NotFoundError('property', input.propertyId);
      if (input.label !== undefined) found.label = input.label.trim();
      if (input.group !== undefined) found.group = input.group.trim();
      if (input.options !== undefined) found.options = input.options;
      if (input.onCreate !== undefined) found.onCreate = input.onCreate;
      if (input.required !== undefined) found.required = input.required;
      if (input.unique !== undefined) found.unique = input.unique;
    });
    return object;
  }

  async deleteProperty(ctx: Context, input: { objectId: string; propertyId: string }): Promise<ObjectDefinition> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'delete properties');
    const { object } = await this.change(ctx, input.objectId, async (definition) => {
      const found = definition.properties.find((item) => item.id === input.propertyId);
      if (!found) return;
      if (!found.custom) throw new ConflictError('Properties that come with the CRM can be renamed, but not deleted.');
      definition.properties = definition.properties.filter((item) => item.id !== input.propertyId);
      for (const view of definition.views) {
        view.columns = view.columns.filter((column) => column !== input.propertyId);
        view.filters = view.filters.filter((filter) => filter.property !== input.propertyId);
        if (view.sort?.property === input.propertyId) view.sort = undefined;
      }
      // The values go with the property, in the same transaction.
      await this.records.dropProperty(ctx, definition.id, input.propertyId);
    });
    return object;
  }

  async saveView(ctx: Context, input: SaveView): Promise<ViewDefinition> {
    const { result } = await this.change(ctx, input.objectId, (definition) => {
      const has = (propertyId: string) => definition.properties.some((item) => item.id === propertyId);
      const unknown = [...input.columns, ...input.filters.map((filter) => filter.property), ...(input.sort ? [input.sort.property] : [])].find((propertyId) => !has(propertyId));
      if (unknown) throw new ValidationError(`${definition.plural} have no property "${unknown}".`);
      const settings = { name: input.name.trim(), columns: input.columns, filters: input.filters, sort: input.sort };
      if (input.viewId) {
        const existing = definition.views.find((view) => view.id === input.viewId);
        if (!existing) throw new NotFoundError('view', input.viewId);
        Object.assign(existing, settings);
        return existing;
      }
      if (definition.views.some((view) => view.name.toLowerCase() === settings.name.toLowerCase())) throw new ConflictError(`There is already a view called "${settings.name}".`);
      const base = slug(settings.name, '-') || 'view';
      let id = base;
      for (let suffix = 2; definition.views.some((view) => view.id === id); suffix += 1) id = `${base}-${suffix}`;
      const created: ViewDefinition = { id, ...settings };
      definition.views.push(created);
      return created;
    });
    return result;
  }

  async deleteView(ctx: Context, input: { objectId: string; viewId: string }): Promise<ObjectDefinition> {
    const { object } = await this.change(ctx, input.objectId, (definition) => {
      if (definition.views.length <= 1) throw new ConflictError('An object needs at least one view.');
      definition.views = definition.views.filter((view) => view.id !== input.viewId);
    });
    return object;
  }
}
