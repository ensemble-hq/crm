import type { Context } from '@mariachi/core';
import { and, sql } from 'drizzle-orm';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type DashboardRow, type GoalRow, type ReportRow, dashboardsTable, goalsTable, reportsTable } from '../../schema';

export class ReportsRepository extends DrizzleRepository<ReportRow> {
  constructor(db: DrizzleDb) {
    super(reportsTable, db);
  }

  /** Records that an emailed report has dealt with one of the moments it was due. */
  async reached(ctx: Context, id: string, slot: string): Promise<void> {
    await this.db.execute(sql`update reports set last_slot = ${slot} where ${and(this.buildWhere(ctx), sql`reports.id = ${id}`)}`);
  }
}

export class DashboardsRepository extends DrizzleRepository<DashboardRow> {
  constructor(db: DrizzleDb) {
    super(dashboardsTable, db);
  }
}

export class GoalsRepository extends DrizzleRepository<GoalRow> {
  constructor(db: DrizzleDb) {
    super(goalsTable, db);
  }
}
