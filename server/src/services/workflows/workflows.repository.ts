import type { Context } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { and, sql } from 'drizzle-orm';
import { type WorkflowRow, type WorkflowRunRow, workflowRunsTable, workflowsTable } from '../../schema';

export class WorkflowsRepository extends DrizzleRepository<WorkflowRow> {
  constructor(db: DrizzleDb) {
    super(workflowsTable, db);
  }

  /** Takes the next turn of a workflow that shares records out, and says which turn it was (0, 1, 2…). */
  async takeTurn(ctx: Context, id: string): Promise<number> {
    const rows = (await this.db.execute(sql`update workflows set turn = turn + 1 where ${and(this.buildWhere(ctx), sql`workflows.id = ${id}`)} returning turn`)) as unknown as Array<{ turn: number }>;
    return (rows[0]?.turn ?? 1) - 1;
  }

  /** Records that a scheduled workflow has dealt with one of the moments it was due. */
  async reached(ctx: Context, id: string, slot: string): Promise<void> {
    await this.db.execute(sql`update workflows set last_slot = ${slot} where ${and(this.buildWhere(ctx), sql`workflows.id = ${id}`)}`);
  }
}

export class WorkflowRunsRepository extends DrizzleRepository<WorkflowRunRow> {
  constructor(db: DrizzleDb) {
    super(workflowRunsTable, db);
  }

  /** How many times each workflow has run, and when it last did. */
  async totals(ctx: Context): Promise<Map<string, { runs: number; lastRunAt: string | null }>> {
    const rows = (await this.db.execute(
      sql`select workflow_id, count(*)::int as runs, to_char(max(started_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_run_at from workflow_runs where ${and(this.buildWhere(ctx))} group by workflow_id`,
    )) as unknown as Array<{ workflow_id: string; runs: number; last_run_at: string | null }>;
    return new Map(rows.map((row) => [row.workflow_id, { runs: row.runs, lastRunAt: row.last_run_at }]));
  }
}
