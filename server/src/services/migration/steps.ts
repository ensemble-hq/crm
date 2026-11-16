import type { Context } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { MigrationIssue, StepCounts, StepKind, StepSpec } from '../../../../src/contracts/migration';
import { type MigrationIssueRow, type MigrationLinkRow, type MigrationRunRow, type MigrationStepRow, migrationIssuesTable, migrationLinksTable, migrationRunsTable, migrationStepsTable } from '../../schema';
import type { ActivityRepository } from '../activity/activity.repository';
import type { EmailRules } from '../inbox/email-rules.service';
import type { PeopleRepository } from '../people/people.repository';
import type { RecordsRepository } from '../records/records.repository';
import type { SettingsService } from '../workspace/settings.service';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { MigrationSource } from './source';

/**
 * How a step is written. A step kind is one function, `page`, which reads the next page from the
 * other system and works out what it means here. It counts what it found, raises anything a person
 * should know, and returns the writes to make and where to carry on from. The engine makes those
 * writes and saves the step's progress in one transaction, so a page is either wholly done and
 * recorded or not done at all. In a check nothing returned in `write` is run.
 *
 * To teach the importer something new, add a kind to the contract (`stepSpecSchema`) and a
 * handler to the registry in `hubspot/index.ts`. Anything that is the same work on different
 * things (another object, another activity type) needs no code: it is a new step of an existing
 * kind, added with `migrations.addStep`.
 */

export const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

export const noCounts = (): StepCounts => ({ read: 0, created: 0, updated: 0, skipped: 0, failed: 0, warnings: 0 });

export type NewStep = { title: string; spec: StepSpec; required?: boolean };

export type Page = {
  /** Where to carry on from. Null when the step is finished. */
  next: unknown | null;
  /** Everything this page changes in the CRM. Not run in a check. */
  write?: () => Promise<void>;
  /** Steps to add straight after this one. */
  steps?: NewStep[];
  /** One line about the step as a whole, shown beside it. */
  note?: string;
};

/** What a step has to work with. */
export type StepIO = {
  /** Acting as the person who started the run. */
  ctx: Context;
  source: MigrationSource;
  /** A check: read and count, write nothing. */
  dry: boolean;
  counts: StepCounts;
  issue(level: MigrationIssue['level'], message: string, sourceId?: string): void;
  links: Links;
  crm: Crm;
};

export type Crm = {
  db: DrizzleDb;
  records: RecordsRepository;
  settings: SettingsService;
  workspace: WorkspaceService;
  people: PeopleRepository;
  rules: EmailRules;
  activities: ActivityRepository;
};

export type StepHandler<K extends StepKind = StepKind> = {
  page(io: StepIO, spec: Extract<StepSpec, { kind: K }>, cursor: unknown): Promise<Page>;
};
export type Registry = { [K in StepKind]: StepHandler<K> };

export class RunsRepository extends DrizzleRepository<MigrationRunRow> {
  constructor(db: DrizzleDb) {
    super(migrationRunsTable, db);
  }

  /** Takes the next run that is under way and that no other worker is carrying, and holds it for a while. */
  async claim(ctx: Context, seconds: number): Promise<MigrationRunRow | undefined> {
    const rows = (await this.db.execute(sql`
      update migration_runs set locked_until = now() + make_interval(secs => ${seconds})
      where id = (select id from migration_runs where tenant_id = ${ctx.tenantId} and status = 'running' and (locked_until is null or locked_until < now()) order by started_at limit 1 for update skip locked)
      returning id`)) as unknown as Array<{ id: string }>;
    return rows[0] ? ((await this.findById(ctx, rows[0].id)) ?? undefined) : undefined;
  }

  async release(ctx: Context, runId: string): Promise<void> {
    await this.db.execute(sql`update migration_runs set locked_until = null where tenant_id = ${ctx.tenantId} and id = ${runId}`);
  }
}

export class StepsRepository extends DrizzleRepository<MigrationStepRow> {
  constructor(db: DrizzleDb) {
    super(migrationStepsTable, db);
  }

  async ofRun(ctx: Context, runId: string): Promise<MigrationStepRow[]> {
    return (await this.findMany(ctx, { runId }, { limit: 1000 })).sort((a, b) => a.position - b.position);
  }

  /** Makes room after a position for `count` more steps. */
  async shift(ctx: Context, runId: string, after: number, count: number): Promise<void> {
    await this.db.execute(sql`update migration_steps set position = position + ${count} where tenant_id = ${ctx.tenantId} and run_id = ${runId} and position > ${after}`);
  }
}

export class IssuesRepository extends DrizzleRepository<MigrationIssueRow> {
  constructor(db: DrizzleDb) {
    super(migrationIssuesTable, db);
  }

  async clear(ctx: Context, runId: string, stepId?: string): Promise<void> {
    await this.db.execute(sql`delete from migration_issues where tenant_id = ${ctx.tenantId} and run_id = ${runId} ${stepId ? sql`and step_id = ${stepId}` : sql``}`);
  }
}

/** What things in the other system became here. Kinds: `record:<type>`, `owner`, `field:<type>`, `option:<object>.<property>`, `object`, `activity:<type>`. */
export class Links extends DrizzleRepository<MigrationLinkRow> {
  constructor(
    db: DrizzleDb,
    private readonly origin: string,
  ) {
    super(migrationLinksTable, db);
  }

  /** The CRM ids for these ids of the other system. Ids nothing was brought for are absent. */
  async get(ctx: Context, kind: string, sourceIds: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const wanted = [...new Set(sourceIds)];
    for (let start = 0; start < wanted.length; start += 1000) {
      const rows = (await this.db.execute(sql`select source_id, target_id from migration_links where tenant_id = ${ctx.tenantId} and source = ${this.origin} and kind = ${kind} and source_id in (${sql.join(wanted.slice(start, start + 1000).map((item) => sql`${item}`), sql`, `)})`)) as unknown as Array<{ source_id: string; target_id: string }>;
      for (const row of rows) found.set(row.source_id, row.target_id);
    }
    return found;
  }

  /** Everything of one kind, for the small kinds (fields, choices, owners). */
  async all(ctx: Context, kind: string): Promise<Map<string, string>> {
    const rows = (await this.db.execute(sql`select source_id, target_id from migration_links where tenant_id = ${ctx.tenantId} and source = ${this.origin} and kind = ${kind}`)) as unknown as Array<{ source_id: string; target_id: string }>;
    return new Map(rows.map((row) => [row.source_id, row.target_id]));
  }

  /** Which of these CRM ids something from the other system already became. */
  async taken(ctx: Context, kind: string, targetIds: string[]): Promise<Set<string>> {
    if (targetIds.length === 0) return new Set();
    const rows = (await this.db.execute(sql`select target_id from migration_links where tenant_id = ${ctx.tenantId} and source = ${this.origin} and kind = ${kind} and target_id in (${sql.join(targetIds.map((item) => sql`${item}`), sql`, `)})`)) as unknown as Array<{ target_id: string }>;
    return new Set(rows.map((row) => row.target_id));
  }

  async put(ctx: Context, kind: string, pairs: Array<[sourceId: string, targetId: string]>): Promise<void> {
    if (pairs.length === 0) return;
    const rows = pairs.map(([sourceId, targetId]) => ({ id: id('lnk'), sourceId, targetId }));
    await this.db.execute(sql`
      insert into migration_links (id, tenant_id, source, kind, source_id, target_id)
      select item.id, ${ctx.tenantId}, ${this.origin}, ${kind}, item."sourceId", item."targetId"
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as item(id text, "sourceId" text, "targetId" text)
      on conflict (tenant_id, source, kind, source_id) do update set target_id = excluded.target_id, updated_at = now()`);
  }
}
