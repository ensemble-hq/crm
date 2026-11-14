import { AuthError, type Context } from '@mariachi/core';
import { type SQL, sql } from 'drizzle-orm';
import type { CrmRecord } from '../../../../src/contracts/records';
import type { Access, Role, Scope } from '../../../../src/contracts/team';

/**
 * Who an operation runs as, and what they may do. Every operation is given an actor before it
 * starts; the records service turns the actor's reach into SQL, so a person never receives a record
 * they may not see, whichever way the request came in (the app, the API or an agent over MCP).
 */
export type Actor = {
  /** The person who signed in. */
  signedInId: string;
  /** The person the CRM is being used as: the same, unless an administrator is viewing as someone else. */
  userId: string;
  role: Role;
  teamId: string | null;
  /** Everyone on the acting person's team, themselves included. */
  teammates: string[];  /** Set when the actor is an agent: what kind of thing it may do at all, whatever its role reaches. */
  agent?: { reach: 'read' | 'write' | 'everything' };
};

const actors = new WeakMap<Context, Actor>();

/** The context an operation runs with: "me" is the acting person from here on. */
export function actingContext(ctx: Context, actor: Actor): Context {
  const acting = { ...ctx, userId: actor.userId };
  actors.set(acting, actor);
  return acting;
}

export function actorOf(ctx: Context): Actor {
  const actor = actors.get(ctx);
  if (!actor) throw new AuthError('auth/unauthorized', 'This operation was run without a signed-in person.');
  return actor;
}

/** The scope as a condition on `records`, or undefined when it reaches everything. Records nobody owns are open to any scope but "none". */
export function reach(actor: Actor, scope: Scope): SQL | undefined {
  if (scope === 'all') return undefined;
  if (scope === 'none') return sql`false`;
  const owners = scope === 'team' ? actor.teammates : [actor.userId];
  const list = sql.join(owners.map((id) => sql`${id}`), sql`, `);
  return sql`(jsonb_typeof(records.properties->'owner') is distinct from 'string' or records.properties->>'owner' in (${list}))`;
}

export const visibility = (actor: Actor) => reach(actor, actor.role.view);

function reaches(actor: Actor, scope: Scope, record: CrmRecord): boolean {
  if (scope === 'all') return true;
  if (scope === 'none') return false;
  const owner = record.properties.owner;
  if (typeof owner !== 'string' || owner === actor.userId) return true;
  return scope === 'team' && actor.teammates.includes(owner);
}

/** Throws, in words the person can act on, when they may not change or delete a record. */
export function assertCan(actor: Actor, action: 'edit' | 'delete', record: CrmRecord, noun: string): void {
  const scope = actor.role[action];
  if (reaches(actor, scope, record)) return;
  const limit = scope === 'none' ? `can't ${action} ${noun}s` : scope === 'own' ? `can only ${action} ${noun}s you own` : `can only ${action} your team's ${noun}s`;
  throw new AuthError('auth/forbidden', `As ${actor.role.name}, you ${limit}.`);
}

export function assertAllowed(actor: Actor, permission: 'manageSettings' | 'managePeople' | 'exportRecords', doing: string): void {
  // Who is in the CRM, and what they may do, is decided by people. An agent never does, whatever its role says.
  if (actor.agent && permission === 'managePeople') throw new AuthError('auth/forbidden', `An agent can't ${doing}. A person has to.`);
  if (!actor.role[permission]) throw new AuthError('auth/forbidden', `As ${actor.role.name}, you can't ${doing}. Ask an admin.`);
}

export function accessOf(actor: Actor): Access {
  const { role } = actor;
  return { roleName: role.name, view: role.view, edit: role.edit, delete: role.delete, manageSettings: role.manageSettings, managePeople: role.managePeople, exportRecords: role.exportRecords, viewedBy: actor.userId === actor.signedInId ? null : actor.signedInId };
}

/** Refuses an operation an agent is not let do: by its kind (reading, changing, or deleting and sending), and any that manage the CRM's own plumbing. */
export function assertAgentMay(actor: Actor, operation: { title: string; effect: 'read' | 'write' | 'destructive' | 'send'; internal?: boolean }): void {
  if (!actor.agent) return;
  if (operation.internal) throw new AuthError('auth/forbidden', 'That is for people to do, not agents.');
  const allowed = actor.agent.reach === 'everything' || operation.effect === 'read' || (actor.agent.reach === 'write' && operation.effect === 'write');
  if (!allowed) {
    const limit = actor.agent.reach === 'read' ? 'only look things up' : 'create and change things, but not delete, merge or send';
    throw new AuthError('auth/forbidden', `This agent may ${limit}. A person who manages people can change that.`);
  }
}
