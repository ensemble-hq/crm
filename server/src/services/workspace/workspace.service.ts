import { AuthError, type Context, NotFoundError } from '@mariachi/core';
import type { ObjectDefinition, User } from '../../../../src/contracts/metadata';
import type { Workspace } from '../../../../src/contracts/records';
import type { ObjectsRepository, PeopleRepository } from './workspace.repository';

/** The shape of the CRM: its objects and its people. Every other service asks here what a record may hold. */
export class WorkspaceService {
  constructor(
    private readonly objects: ObjectsRepository,
    private readonly people: PeopleRepository,
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

  async users(ctx: Context): Promise<User[]> {
    const rows = await this.people.findMany(ctx, { active: true }, { sort: { field: 'name', direction: 'asc' }, limit: 500 });
    return rows.map((row) => ({ id: row.id, name: row.name, email: row.email }));
  }

  async get(ctx: Context): Promise<Workspace> {
    const [objects, users] = await Promise.all([this.definitions(ctx), this.users(ctx)]);
    const me = users.find((user) => user.id === ctx.userId);
    if (!me) throw new AuthError('auth/unknown-person', 'You are signed in, but you are not a member of this CRM.');
    return {
      name: 'Northwind',
      objects,
      users,
      currentUserId: me.id,
      // Roles and record-level access arrive with the people module; until then every member is an administrator.
      access: { roleName: 'Administrator', view: 'all', edit: 'all', delete: 'all', manageSettings: true, managePeople: true, exportRecords: true, viewedBy: null },
    };
  }
}
