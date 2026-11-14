import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type DashboardRow, type GoalRow, type ReportRow, dashboardsTable, goalsTable, reportsTable } from '../../schema';

export class ReportsRepository extends DrizzleRepository<ReportRow> {
  constructor(db: DrizzleDb) {
    super(reportsTable, db);
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
