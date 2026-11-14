import type { CrmRecord } from '../contracts/records';
import type { Access, Member, Role, Scope, Team, TeamApi } from '../contracts/team';
import { CURRENT_USER_ID, users } from './definitions';

/** People, teams, roles and who is signed in, for the mock. `can*` and `visible` are what the rest of the mock asks before reading or writing. */

const roles: Role[] = [
  { id: 'role_admin', name: 'Admin', description: 'Sees and changes everything, and runs the workspace.', view: 'all', edit: 'all', delete: 'all', manageSettings: true, managePeople: true, exportRecords: true, builtIn: true },
  { id: 'role_manager', name: 'Manager', description: 'Sees everything; changes and deletes their team\'s records.', view: 'all', edit: 'team', delete: 'team', manageSettings: true, managePeople: false, exportRecords: true, builtIn: true },
  { id: 'role_rep', name: 'Sales rep', description: 'Sees their team\'s records and changes their own.', view: 'team', edit: 'own', delete: 'none', manageSettings: false, managePeople: false, exportRecords: false, builtIn: true },
  { id: 'role_viewer', name: 'Read only', description: 'Sees everything and changes nothing.', view: 'all', edit: 'none', delete: 'none', manageSettings: false, managePeople: false, exportRecords: false, builtIn: true },
];

const teams: Team[] = [
  { id: 'team_new', name: 'New business' },
  { id: 'team_accounts', name: 'Account management' },
];

const PLACEMENT: Record<string, { roleId: string; teamId: string }> = {
  usr_maya: { roleId: 'role_admin', teamId: 'team_new' },
  usr_priya: { roleId: 'role_manager', teamId: 'team_new' },
  usr_jonas: { roleId: 'role_rep', teamId: 'team_new' },
  usr_dario: { roleId: 'role_manager', teamId: 'team_accounts' },
  usr_aiko: { roleId: 'role_rep', teamId: 'team_accounts' },
  usr_femi: { roleId: 'role_viewer', teamId: 'team_accounts' },
};

const members: Member[] = users.map((user) => ({ ...user, roleId: PLACEMENT[user.id]?.roleId ?? 'role_rep', teamId: PLACEMENT[user.id]?.teamId ?? null, status: 'active' }));

/** Who is signed in, and who they are looking as. Everything in the mock that says "me" reads `session.userId`. */
export const session = { signedInId: CURRENT_USER_ID, userId: CURRENT_USER_ID };

let counter = 0;

function member(id: string): Member {
  const found = members.find((item) => item.id === id);
  if (!found) throw new Error('That person is no longer in the workspace.');
  return found;
}

function roleOf(userId: string): Role {
  return roles.find((role) => role.id === member(userId).roleId) ?? (roles[roles.length - 1] as Role);
}

/** Whether a scope reaches a record, for the person acting. Records nobody owns are open to any scope but "none". */
function reaches(scope: Scope, record: CrmRecord): boolean {
  if (scope === 'all') return true;
  if (scope === 'none') return false;
  const owner = record.properties.owner;
  if (typeof owner !== 'string') return true;
  if (owner === session.userId) return true;
  if (scope === 'own') return false;
  const myTeam = member(session.userId).teamId;
  return myTeam !== null && members.some((item) => item.id === owner && item.teamId === myTeam);
}

export const visible = (record: CrmRecord) => reaches(roleOf(session.userId).view, record);

/** Throws, in words the person can act on, when they may not change or delete a record. */
export function assertCan(action: 'edit' | 'delete', record: CrmRecord, noun: string): void {
  const role = roleOf(session.userId);
  if (reaches(role[action], record)) return;
  const scope = role[action];
  const reach = scope === 'none' ? `can't ${action} ${noun}s` : scope === 'own' ? `can only ${action} ${noun}s you own` : `can only ${action} your team's ${noun}s`;
  throw new Error(`As ${role.name}, you ${reach}.`);
}

export function assertAllowed(permission: 'manageSettings' | 'managePeople' | 'exportRecords', doing: string): void {
  const role = roleOf(session.userId);
  if (!role[permission]) throw new Error(`As ${role.name}, you can't ${doing}. Ask an admin.`);
}

export function currentAccess(): Access {
  const role = roleOf(session.userId);
  return { roleName: role.name, view: role.view, edit: role.edit, delete: role.delete, manageSettings: role.manageSettings, managePeople: role.managePeople, exportRecords: role.exportRecords, viewedBy: session.userId === session.signedInId ? null : session.signedInId };
}

/** The people who can be given records: everyone who has not been deactivated. */
export function activeUsers() {
  return members.filter((item) => item.status !== 'deactivated').map((item) => ({ id: item.id, name: item.name, email: item.email }));
}

/** The team half of the mock API. `reassign` moves every record one person owns to another, and says how many. */
export function createTeamApi(respond: <T>(compute: () => T) => Promise<T>, reassign: (fromId: string, toId: string) => number): TeamApi {
  return {
    getDirectory: () => respond(() => ({ members, teams, roles })),

    inviteMember: (input) =>
      respond(() => {
        assertAllowed('managePeople', 'invite people');
        const email = input.email.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
        if (members.some((item) => item.email.toLowerCase() === email)) throw new Error('Someone with that email is already here.');
        counter += 1;
        const invited: Member = { id: `usr_new_${counter}`, name: input.name.trim() || email, email, roleId: input.roleId, teamId: input.teamId, status: 'invited' };
        members.push(invited);
        users.push({ id: invited.id, name: invited.name, email: invited.email });
        return invited;
      }),

    updateMember: (input) =>
      respond(() => {
        assertAllowed('managePeople', 'change people\'s roles');
        const found = member(input.id);
        if (input.roleId !== undefined) {
          const admins = members.filter((item) => item.roleId === 'role_admin' && item.status === 'active');
          if (found.roleId === 'role_admin' && input.roleId !== 'role_admin' && admins.length === 1) throw new Error('The workspace needs at least one admin.');
          found.roleId = input.roleId;
        }
        if (input.teamId !== undefined) found.teamId = input.teamId;
        return found;
      }),

    deactivateMember: (input) =>
      respond(() => {
        assertAllowed('managePeople', 'deactivate people');
        const found = member(input.id);
        if (found.id === session.signedInId) throw new Error('You can\'t deactivate yourself.');
        if (found.roleId === 'role_admin' && members.filter((item) => item.roleId === 'role_admin' && item.status === 'active').length === 1) throw new Error('The workspace needs at least one admin.');
        member(input.reassignTo);
        found.status = 'deactivated';
        return { reassigned: reassign(found.id, input.reassignTo) };
      }),

    reactivateMember: (id) =>
      respond(() => {
        assertAllowed('managePeople', 'reactivate people');
        const found = member(id);
        found.status = 'active';
        return found;
      }),

    saveTeam: (input) =>
      respond(() => {
        assertAllowed('managePeople', 'change teams');
        const name = input.name.trim();
        if (!name) throw new Error('Give the team a name.');
        if (input.id) {
          const existing = teams.find((team) => team.id === input.id);
          if (!existing) throw new Error('That team no longer exists.');
          existing.name = name;
          return existing;
        }
        counter += 1;
        const created: Team = { id: `team_new_${counter}`, name };
        teams.push(created);
        return created;
      }),

    deleteTeam: (id) =>
      respond(() => {
        assertAllowed('managePeople', 'change teams');
        if (members.some((item) => item.teamId === id && item.status !== 'deactivated')) throw new Error('Move its people to another team first.');
        const index = teams.findIndex((team) => team.id === id);
        if (index >= 0) teams.splice(index, 1);
      }),

    saveRole: (input) =>
      respond(() => {
        assertAllowed('managePeople', 'change roles');
        const { id, ...settings } = input;
        if (id) {
          const existing = roles.find((role) => role.id === id);
          if (!existing) throw new Error('That role no longer exists.');
          if (existing.id === 'role_admin') throw new Error('The Admin role can\'t be changed, so there is always a way back in.');
          Object.assign(existing, settings);
          return existing;
        }
        counter += 1;
        const created: Role = { id: `role_new_${counter}`, ...settings, builtIn: false };
        roles.push(created);
        return created;
      }),

    deleteRole: (id) =>
      respond(() => {
        assertAllowed('managePeople', 'change roles');
        const role = roles.find((item) => item.id === id);
        if (!role) return;
        if (role.builtIn) throw new Error('The roles that come with the CRM can be changed but not deleted.');
        if (members.some((item) => item.roleId === id)) throw new Error('Give its people another role first.');
        roles.splice(roles.indexOf(role), 1);
      }),

    viewAs: (userId) =>
      respond(() => {
        if (userId === null) {
          session.userId = session.signedInId;
          return;
        }
        if (!roleOf(session.signedInId).managePeople) throw new Error('Only an admin can view the CRM as someone else.');
        if (member(userId).status === 'deactivated') throw new Error('That person has been deactivated.');
        session.userId = userId;
      }),
  };
}
