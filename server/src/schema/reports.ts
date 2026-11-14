import { column, defineTable, type InferEntity } from '@mariachi/database';
import type { ReportSettings } from '../../../src/contracts/reports';

/** A saved question about the records: what to count or add up, split by what, for which records. */
export const reportsTable = defineTable('reports', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  settings: column.json().$type<ReportSettings>().notNull(),
  /** For a report that is emailed: the last moment it was due that has been dealt with. */
  lastSlot: column.text(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type ReportRow = InferEntity<typeof reportsTable>;

/** An ordered set of reports shown together. */
export const dashboardsTable = defineTable('dashboards', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  name: column.text().notNull(),
  reportIds: column.json().$type<string[]>().notNull(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type DashboardRow = InferEntity<typeof dashboardsTable>;

/** What each person is expected to close in a quarter. The row's id is the person's id. */
export const goalsTable = defineTable('goals', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  amount: column.double().notNull(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type GoalRow = InferEntity<typeof goalsTable>;
