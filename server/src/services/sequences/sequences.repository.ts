import type { Context } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { and, sql } from 'drizzle-orm';
import type { SequenceStats } from '../../../../src/contracts/sequences';
import { type EnrollmentRow, type SequenceRow, enrollmentsTable, sequencesTable } from '../../schema';

export class SequencesRepository extends DrizzleRepository<SequenceRow> {
  constructor(db: DrizzleDb) {
    super(sequencesTable, db);
  }
}

export class EnrollmentsRepository extends DrizzleRepository<EnrollmentRow> {
  constructor(db: DrizzleDb) {
    super(enrollmentsTable, db);
  }

  async stats(ctx: Context): Promise<Map<string, SequenceStats>> {
    const rows = (await this.db.execute(sql`
      select sequence_id, count(*)::int as enrolled, count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'replied')::int as replied,
             count(*) filter (where status = 'finished')::int as finished, count(*) filter (where status = 'stopped')::int as stopped
      from enrollments where ${and(this.buildWhere(ctx))} group by sequence_id`)) as unknown as Array<SequenceStats & { sequence_id: string }>;
    return new Map(rows.map(({ sequence_id, ...stats }) => [sequence_id, stats]));
  }

  /** Enrolments whose next step is due, in sequences that are running. */
  async due(ctx: Context, limit: number): Promise<string[]> {
    const rows = (await this.db.execute(sql`
      select enrollments.id from enrollments join sequences on sequences.id = enrollments.sequence_id and sequences.tenant_id = enrollments.tenant_id
      where ${and(this.buildWhere(ctx), sql`enrollments.status = 'active'`, sql`enrollments.next_run_at <= now()`, sql`sequences.status = 'active'`)}
      order by enrollments.next_run_at limit ${limit}`)) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * Locks an enrolment for the rest of the transaction if its step is still due. A second worker
   * asking at the same moment gets nothing, and one asking afterwards finds the step already done.
   */
  async lockDue(ctx: Context, id: string): Promise<boolean> {
    const rows = (await this.db.execute(sql`select id from enrollments where ${and(this.buildWhere(ctx), sql`enrollments.id = ${id}`, sql`enrollments.status = 'active'`, sql`enrollments.next_run_at <= now()`)} for update skip locked`)) as unknown as unknown[];
    return rows.length > 0;
  }

  /** Gives a schedule back to the active contacts of a sequence that was paused and is running again. */
  async resume(ctx: Context, sequenceId: string): Promise<void> {
    await this.db.execute(sql`update enrollments set next_run_at = now(), updated_at = now() where ${and(this.buildWhere(ctx), sql`enrollments.sequence_id = ${sequenceId}`, sql`enrollments.status = 'active'`, sql`enrollments.next_run_at is null`)}`);
  }
}
