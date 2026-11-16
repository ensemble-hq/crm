import { installAuditAppendOnly } from '@mariachi/audit/postgres';
import { createStorage } from '@mariachi/storage';
import { createCommunication } from '@mariachi/communication';
import type { Context, Logger } from '@mariachi/core';
import { type PostgresDatabase, createPostgresDatabase, runMigrations } from '@mariachi/database-postgres';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PropertyValue } from '../../src/contracts/metadata';
import { objects, users } from '../../src/mock/definitions';
import { emailTemplates } from '../../src/mock/inbox';
import { PLACEMENT, roles, teams } from '../../src/mock/team';
import { TENANT_ID } from '../src/config';
import { DevEmailProvider } from '../src/email/dev.provider';
import { createServices, registerServices } from '../src/services/index';
import type { MigrationSource } from '../src/services/migration/source';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * A CRM to test against: the real services on a real database, with the demo company's objects,
 * people, roles and email templates and no records. Tests call operations the way the HTTP API and
 * MCP do, through the one list, so everything in between (who is acting, an agent's limits, the
 * audit log) is exercised too.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const quiet: Logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => quiet } as unknown as Logger;

let database: PostgresDatabase | undefined;
let migrated = false;

export type Crm = Awaited<ReturnType<typeof startCrm>>;

export async function startCrm(options: { push?: (ctx: Context, userId: string, data: unknown) => Promise<void>; migrationSource?: (key: string) => MigrationSource } = {}) {
  if (!database) {
    database = createPostgresDatabase({ url: TEST_DATABASE_URL, poolMax: 5 });
    await database.connect();
  }
  const db = database.db;
  if (!migrated) {
    // Each run starts from the migrations as they are now.
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(database.adapter, { migrationsFolder: path.join(here, '../drizzle') });
    await installAuditAppendOnly(db);
    migrated = true;
  }
  const tables = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`)) as unknown as Array<{ tablename: string }>;
  await db.execute(sql.raw(`truncate ${tables.map((table) => `"${table.tablename}"`).join(', ')}`));

  for (const [position, definition] of objects.entries()) {
    await db.execute(sql`insert into objects (id, tenant_id, position, definition) values (${definition.id}, ${TENANT_ID}, ${position}, ${JSON.stringify(definition)}::jsonb)`);
  }
  for (const [position, { id, builtIn, ...settings }] of roles.entries()) {
    await db.execute(sql`insert into roles (id, tenant_id, settings, built_in, position) values (${id}, ${TENANT_ID}, ${JSON.stringify(settings)}::jsonb, ${builtIn}, ${position})`);
  }
  for (const team of teams) await db.execute(sql`insert into teams (id, tenant_id, name) values (${team.id}, ${TENANT_ID}, ${team.name})`);
  for (const user of users.slice(0, 6)) {
    const placement = PLACEMENT[user.id];
    await db.execute(sql`insert into people (id, tenant_id, name, email, role_id, team_id) values (${user.id}, ${TENANT_ID}, ${user.name}, ${user.email}, ${placement?.roleId ?? 'role_rep'}, ${placement?.teamId ?? null})`);
  }
  for (const template of emailTemplates.slice(0, 5)) {
    await db.execute(sql`insert into email_templates (id, tenant_id, name, subject, body) values (${template.id}, ${TENANT_ID}, ${template.name}, ${template.subject}, ${template.body})`);
  }

  const email = new DevEmailProvider(db);
  const deps = { db, transaction: database.transaction, source: 'test', email, files: createStorage({ adapter: 'memory' }), ...(options.push ? { push: options.push } : {}), ...(options.migrationSource ? { migrationSource: options.migrationSource } : {}), secretsKey: 'test-secrets-key-0123456789-0123456789', appOrigin: 'http://crm.test' };
  const communication = createCommunication({}, { logger: quiet });
  registerServices(communication, deps);
  const services = createServices(deps);
  let sequence = 0;

  const context = (userId: string | null, identityType = 'session'): Context => ({ traceId: `test-${++sequence}`, userId, tenantId: userId === null ? null : TENANT_ID, scopes: [], identityType, logger: quiet });

  return {
    db,
    email,
    services,
    /** A context for the parts of the system that act for no one: the worker. */
    system: (): Context => ({ ...context(null), tenantId: TENANT_ID, identityType: 'service' }),
    /** Runs an operation as a member, as the HTTP API and MCP do. `as` is a person's or an agent's id. */
    call: <T = unknown>(as: string, operation: string, input?: unknown, identityType?: string) => communication.call<T>(context(as, identityType), operation, input),
    /** Runs an operation as a visitor who is not signed in. Only the public operations allow it. */
    visit: <T = unknown>(operation: string, input?: unknown) => communication.call<T>(context(null), operation, input),
    /** Adds a record straight to the database, with no rules, events or audit entry: for setting a scene. */
    async seed(objectId: string, properties: Record<string, PropertyValue>): Promise<string> {
      const id = `${objectId.slice(0, 3)}_seed_${++sequence}`;
      await db.execute(sql`insert into records (id, tenant_id, object_id, properties) values (${id}, ${TENANT_ID}, ${objectId}, ${JSON.stringify({ createdAt: '2026-01-01', ...properties })}::jsonb)`);
      return id;
    },
    rows: async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[],
  };
}

/** The message of whatever an operation was refused with. Fails the test if it was not refused. */
export async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected this to be refused, and it went through.');
}

export const MAYA = 'usr_maya'; // Admin, New business
export const PRIYA = 'usr_priya'; // Manager, New business
export const JONAS = 'usr_jonas'; // Sales rep, New business
export const AIKO = 'usr_aiko'; // Sales rep, Account management
export const FEMI = 'usr_femi'; // Read only, Account management
