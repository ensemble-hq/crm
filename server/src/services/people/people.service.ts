import { AuthError, ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { User } from '../../../../src/contracts/metadata';
import type { Directory, Member, Role, Team, deactivateMemberSchema, inviteMemberSchema, saveRoleSchema, saveTeamSchema, updateMemberSchema } from '../../../../src/contracts/team';
import type { PersonRow, RoleRow } from '../../schema';
import { type Actor, actorOf, assertAllowed } from './access';
import type { PeopleRepository, RolesRepository, TeamsRepository } from './people.repository';

const ADMIN_ROLE = 'role_admin';
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

function toMember(row: PersonRow): Member {
  return { id: row.id, name: row.name, email: row.email, roleId: row.roleId, teamId: row.teamId, status: row.status as Member['status'] };
}

function toRole(row: RoleRow): Role {
  return { id: row.id, ...row.settings, builtIn: row.builtIn };
}

export class PeopleService {
  constructor(
    private readonly people: PeopleRepository,
    private readonly teams: TeamsRepository,
    private readonly roles: RolesRepository,
    /** Hands every record one person owns to another, and says how many. */
    private readonly reassign: (ctx: Context, fromId: string, toId: string) => Promise<number>,
  ) {}

  /**
   * Who a request runs as. The auth provider says who signed in; this checks they are a member, and
   * applies "view as" when an administrator has switched it on.
   */
  async actor(ctx: Context): Promise<Actor> {
    const everyone = await this.people.findMany(ctx, {}, { limit: 1000 });
    const signedIn = everyone.find((person) => person.id === ctx.userId);
    if (!signedIn || signedIn.status === 'deactivated') throw new AuthError('auth/forbidden', 'You are signed in, but you do not have access to this CRM.');
    const roles = (await this.roles.findMany(ctx, {}, { limit: 200 })).map(toRole);
    const roleOf = (person: PersonRow) => roles.find((role) => role.id === person.roleId);
    const viewed = signedIn.viewingAs ? everyone.find((person) => person.id === signedIn.viewingAs && person.status !== 'deactivated') : undefined;
    // "View as" only holds while the signed-in person is still allowed to use it.
    const acting = viewed && roleOf(signedIn)?.managePeople ? viewed : signedIn;
    const role = roleOf(acting);
    if (!role) throw new AuthError('auth/forbidden', 'Your role no longer exists. Ask an admin to give you another.');
    const teammates = acting.teamId === null ? [acting.id] : everyone.filter((person) => person.teamId === acting.teamId).map((person) => person.id);
    const reach = acting.reach === 'write' || acting.reach === 'everything' ? acting.reach : 'read';
    return { signedInId: signedIn.id, userId: acting.id, role, teamId: acting.teamId, teammates, ...(acting.kind === 'agent' ? { agent: { reach } } : {}) };
  }

  /** Everyone records can be given to: people who have not been deactivated. */
  async users(ctx: Context): Promise<User[]> {
    const rows = await this.people.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 1000 });
    // Agents are included so what they did shows their name and records can be given to them.
    return rows.filter((row) => row.status !== 'deactivated').map((row) => ({ id: row.id, name: row.name, email: row.email, ...(row.kind === 'agent' ? { kind: 'agent' as const } : {}) }));
  }

  async directory(ctx: Context): Promise<Directory> {
    const [members, teams, roles] = await Promise.all([
      this.people.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 1000 }),
      this.teams.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 200 }),
      this.roles.findMany(ctx, {}, { sort: { field: 'position', direction: 'asc' }, limit: 200 }),
    ]);
    return { members: members.filter((member) => member.kind !== 'agent').map(toMember), teams: teams.map((team) => ({ id: team.id, name: team.name })), roles: roles.map(toRole) };
  }

  private async member(ctx: Context, memberId: string): Promise<PersonRow> {
    const found = await this.people.findById(ctx, memberId);
    if (!found) throw new NotFoundError('person', memberId);
    return found;
  }

  private async activeAdmins(ctx: Context): Promise<number> {
    return this.people.count(ctx, { roleId: ADMIN_ROLE, status: 'active', kind: 'person' });
  }

  private async checkPlacement(ctx: Context, roleId: string | undefined, teamId: string | null | undefined): Promise<void> {
    if (roleId !== undefined && !(await this.roles.findById(ctx, roleId))) throw new ValidationError('That role no longer exists.');
    if (teamId && !(await this.teams.findById(ctx, teamId))) throw new ValidationError('That team no longer exists.');
  }

  async invite(ctx: Context, input: z.infer<typeof inviteMemberSchema>): Promise<Member> {
    assertAllowed(actorOf(ctx), 'managePeople', 'invite people');
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError('Enter a valid email address.');
    if ((await this.people.findMany(ctx, {}, { limit: 1000 })).some((person) => person.email.toLowerCase() === email)) throw new ConflictError('Someone with that email is already here.');
    await this.checkPlacement(ctx, input.roleId, input.teamId);
    return toMember(await this.people.create(ctx, { id: id('usr'), name: input.name.trim() || email, email, roleId: input.roleId, teamId: input.teamId, status: 'invited' }));
  }

  async update(ctx: Context, input: z.infer<typeof updateMemberSchema>): Promise<Member> {
    assertAllowed(actorOf(ctx), 'managePeople', "change people's roles");
    const found = await this.member(ctx, input.id);
    await this.checkPlacement(ctx, input.roleId, input.teamId);
    if (input.roleId !== undefined && found.roleId === ADMIN_ROLE && input.roleId !== ADMIN_ROLE && found.status === 'active' && (await this.activeAdmins(ctx)) === 1) throw new ConflictError('The workspace needs at least one admin.');
    return toMember(await this.people.update(ctx, found.id, { ...(input.roleId !== undefined ? { roleId: input.roleId } : {}), ...(input.teamId !== undefined ? { teamId: input.teamId } : {}) }));
  }

  async deactivate(ctx: Context, input: z.infer<typeof deactivateMemberSchema>): Promise<{ reassigned: number }> {
    const actor = actorOf(ctx);
    assertAllowed(actor, 'managePeople', 'deactivate people');
    const found = await this.member(ctx, input.id);
    if (found.id === actor.signedInId) throw new ConflictError("You can't deactivate yourself.");
    if (found.roleId === ADMIN_ROLE && found.status === 'active' && (await this.activeAdmins(ctx)) === 1) throw new ConflictError('The workspace needs at least one admin.');
    const heir = await this.member(ctx, input.reassignTo);
    if (heir.status === 'deactivated' || heir.id === found.id) throw new ValidationError('Choose an active person to take over their records.');
    await this.people.update(ctx, found.id, { status: 'deactivated', viewingAs: null });
    return { reassigned: await this.reassign(ctx, found.id, heir.id) };
  }

  async reactivate(ctx: Context, memberId: string): Promise<Member> {
    assertAllowed(actorOf(ctx), 'managePeople', 'reactivate people');
    return toMember(await this.people.update(ctx, (await this.member(ctx, memberId)).id, { status: 'active' }));
  }

  async saveTeam(ctx: Context, input: z.infer<typeof saveTeamSchema>): Promise<Team> {
    assertAllowed(actorOf(ctx), 'managePeople', 'change teams');
    const name = input.name.trim();
    if (!name) throw new ValidationError('Give the team a name.');
    if (input.id && !(await this.teams.findById(ctx, input.id))) throw new NotFoundError('team', input.id);
    const row = input.id ? await this.teams.update(ctx, input.id, { name }) : await this.teams.create(ctx, { id: id('team'), name });
    return { id: row.id, name: row.name };
  }

  async deleteTeam(ctx: Context, teamId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'managePeople', 'change teams');
    const members = await this.people.findMany(ctx, { teamId }, { limit: 1000 });
    if (members.some((person) => person.status !== 'deactivated')) throw new ConflictError('Move its people to another team first.');
    for (const person of members) await this.people.update(ctx, person.id, { teamId: null });
    await this.teams.deleteWhere(ctx, { id: teamId });
  }

  async saveRole(ctx: Context, input: z.infer<typeof saveRoleSchema>): Promise<Role> {
    assertAllowed(actorOf(ctx), 'managePeople', 'change roles');
    const { id: roleId, ...settings } = input;
    if (roleId) {
      if (!(await this.roles.findById(ctx, roleId))) throw new NotFoundError('role', roleId);
      if (roleId === ADMIN_ROLE) throw new ConflictError("The Admin role can't be changed, so there is always a way back in.");
      return toRole(await this.roles.update(ctx, roleId, { settings }));
    }
    return toRole(await this.roles.create(ctx, { id: id('role'), settings, builtIn: false, position: await this.roles.count(ctx) }));
  }

  async deleteRole(ctx: Context, roleId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'managePeople', 'change roles');
    const role = await this.roles.findById(ctx, roleId);
    if (!role) return;
    if (role.builtIn) throw new ConflictError('The roles that come with the CRM can be changed but not deleted.');
    if ((await this.people.count(ctx, { roleId })) > 0) throw new ConflictError('Give its people another role first.');
    await this.roles.deleteWhere(ctx, { id: roleId });
  }

  /** See the CRM as another person does, or pass null to go back to yourself. */
  async viewAs(ctx: Context, userId: string | null): Promise<void> {
    const actor = actorOf(ctx);
    if (userId === null || userId === actor.signedInId) {
      await this.people.update(ctx, actor.signedInId, { viewingAs: null });
      return;
    }
    // The check is on the person who signed in, so "view as" a rep can still be switched to someone else or off.
    const signedIn = await this.member(ctx, actor.signedInId);
    const role = await this.roles.findById(ctx, signedIn.roleId);
    if (!role?.settings.managePeople) throw new AuthError('auth/forbidden', 'Only an admin can view the CRM as someone else.');
    if ((await this.member(ctx, userId)).status === 'deactivated') throw new ConflictError('That person has been deactivated.');
    await this.people.update(ctx, actor.signedInId, { viewingAs: userId });
  }
}
