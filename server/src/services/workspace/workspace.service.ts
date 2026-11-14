import { type Context, NotFoundError } from '@mariachi/core';
import type { ObjectDefinition } from '../../../../src/contracts/metadata';
import type { Workspace } from '../../../../src/contracts/records';
import { accessOf, actorOf } from '../people/access';
import type { PeopleService } from '../people/people.service';
import type { ObjectsRepository } from './workspace.repository';

/** The shape of the CRM: its objects and its people. Every other service asks here what a record may hold. */
export class WorkspaceService {
  constructor(
    private readonly objects: ObjectsRepository,
    private readonly people: PeopleService,
  ) {}

  async definitions(ctx: Context): Promise<ObjectDefinition[]> {
    const rows = await this.objects.findMany(ctx, {}, { sort: { field: 'position', direction: 'asc' }, limit: 500 });
    return rows.map((row) => row.definition);
  }

  async definition(ctx: Context, objectId: string): Promise<ObjectDefinition> {
    const row = await this.objects.findById(ctx, objectId);
    if (!row) throw new NotFoundError('object', objectId);
    return row.definition;
  }

  async get(ctx: Context): Promise<Workspace> {
    const actor = actorOf(ctx);
    const [objects, users] = await Promise.all([this.definitions(ctx), this.people.users(ctx)]);
    return { name: 'Northwind', objects, users, currentUserId: actor.userId, access: accessOf(actor) };
  }
}
