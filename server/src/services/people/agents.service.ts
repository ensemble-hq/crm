import { ApiKeyService } from '@mariachi/auth';
import { DrizzleApiKeyStore } from '@mariachi/auth/postgres';
import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import type { DrizzleDb } from '@mariachi/database-postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Agent, createAgentKeySchema, createdAgentKeySchema, saveAgentSchema } from '../../../../src/contracts/team';
import type { PersonRow } from '../../schema';
import { actorOf, assertAllowed } from './access';
import type { PeopleRepository, RolesRepository, TeamsRepository } from './people.repository';

type KeyRow = { id: string; user_id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };
const ISO = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/**
 * Agents: software that works in the CRM under its own name. An agent is a member with a role, so
 * everything that limits a person limits it the same way, and it signs in with a key in place of a
 * password. Keys are Mariachi's API keys: only a hash is stored, and the key is shown once.
 *
 * Only people create agents and hand out keys. An agent can never do either, whatever its role.
 */
export class AgentsService {
  private readonly keys: ApiKeyService;

  constructor(
    private readonly db: DrizzleDb,
    private readonly people: PeopleRepository,
    private readonly teams: TeamsRepository,
    private readonly roles: RolesRepository,
  ) {
    this.keys = new ApiKeyService(new DrizzleApiKeyStore(db));
  }

  /** Who a key belongs to. Throws when the key is unknown, revoked or expired. */
  verify(key: string) {
    return this.keys.verify(key);
  }

  private async keysOf(ctx: Context, agentIds: string[]): Promise<KeyRow[]> {
    if (agentIds.length === 0) return [];
    const list = sql.join(agentIds.map((agentId) => sql`${agentId}`), sql`, `);
    return (await this.db.execute(
      sql`select id::text as id, user_id, name, prefix, ${ISO('created_at')} as created_at, ${ISO('last_used_at')} as last_used_at from api_keys where tenant_id = ${ctx.tenantId} and user_id in (${list}) and revoked_at is null and active order by created_at`,
    )) as unknown as KeyRow[];
  }

  private toAgent(row: PersonRow, keys: KeyRow[]): Agent {
    return {
      id: row.id,
      name: row.name,
      roleId: row.roleId,
      teamId: row.teamId,
      reach: row.reach === 'write' || row.reach === 'everything' ? row.reach : 'read',
      status: row.status === 'deactivated' ? 'deactivated' : 'active',
      keys: keys.filter((key) => key.user_id === row.id).map((key) => ({ id: key.id, name: key.name, prefix: key.prefix, createdAt: key.created_at, lastUsedAt: key.last_used_at })),
    };
  }

  private async agent(ctx: Context, agentId: string): Promise<PersonRow> {
    const row = await this.people.findById(ctx, agentId);
    if (!row || row.kind !== 'agent') throw new NotFoundError('agent', agentId);
    return row;
  }

  async list(ctx: Context): Promise<Agent[]> {
    const rows = (await this.people.findMany(ctx, { kind: 'agent' }, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 })).filter((row) => row.status !== 'deactivated');
    const keys = await this.keysOf(ctx, rows.map((row) => row.id));
    return rows.map((row) => this.toAgent(row, keys));
  }

  async save(ctx: Context, input: z.infer<typeof saveAgentSchema>): Promise<Agent> {
    assertAllowed(actorOf(ctx), 'managePeople', 'set up agents');
    const name = input.name.trim();
    if (!name) throw new ValidationError('Give the agent a name.');
    if (!(await this.roles.findById(ctx, input.roleId))) throw new ValidationError('That role no longer exists.');
    if (input.teamId && !(await this.teams.findById(ctx, input.teamId))) throw new ValidationError('That team no longer exists.');
    const fields = { name, roleId: input.roleId, teamId: input.teamId, reach: input.reach };
    if (input.id) {
      const existing = await this.agent(ctx, input.id);
      return this.toAgent(await this.people.update(ctx, existing.id, fields), await this.keysOf(ctx, [existing.id]));
    }
    const id = `agt_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    // An agent has no inbox; the address only keeps it distinct in lists that show one.
    return this.toAgent(await this.people.create(ctx, { id, ...fields, email: `${id}@agents.invalid`, kind: 'agent', status: 'active', viewingAs: null }), []);
  }

  /** Switches an agent off and revokes every key it has. It is kept, deactivated, so what it did still has a name. */
  async remove(ctx: Context, agentId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'managePeople', 'remove agents');
    const row = await this.agent(ctx, agentId);
    for (const key of await this.keysOf(ctx, [row.id])) await this.keys.revoke(ctx, key.id);
    await this.people.update(ctx, row.id, { status: 'deactivated' });
  }

  async createKey(ctx: Context, input: z.infer<typeof createAgentKeySchema>): Promise<z.infer<typeof createdAgentKeySchema>> {
    assertAllowed(actorOf(ctx), 'managePeople', 'make keys for agents');
    const row = await this.agent(ctx, input.agentId);
    if (row.status === 'deactivated') throw new ConflictError('That agent has been removed.');
    const issued = await this.keys.issue(ctx, { name: input.name.trim(), scopes: [], userId: row.id, env: 'crm' });
    return { id: issued.id, prefix: issued.prefix, key: issued.key };
  }

  async revokeKey(ctx: Context, keyId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'managePeople', "revoke an agent's key");
    await this.keys.revoke(ctx, keyId);
  }
}
