import { z } from 'zod';
import { filterSchema } from './metadata';

/**
 * Report contracts. A report is a question asked of one object: count its records, or add up or
 * average a number on them, split by one property. Dates split by month or quarter. A dashboard is
 * an ordered set of reports.
 */

export const measureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('count') }),
  z.object({ kind: z.literal('sum'), property: z.string() }),
  z.object({ kind: z.literal('average'), property: z.string() }),
]);
export type Measure = z.infer<typeof measureSchema>;

export const chartTypeSchema = z.enum(['bars', 'columns', 'line', 'number', 'table']);
export type ChartType = z.infer<typeof chartTypeSchema>;

/** Sending a report by email on a schedule: every day, or every week on one weekday (1 Monday to 7 Sunday), at an hour of the day in UTC. */
export const deliverySchema = z.object({
  every: z.enum(['day', 'week']),
  hour: z.number().int().min(0).max(23),
  weekday: z.number().int().min(1).max(7).optional(),
  /** The people it goes to, by id. Each is sent the numbers their own role lets them see. */
  to: z.array(z.string()).min(1).max(50),
  /** Who set it up; the email comes from them. Filled in by the server. */
  by: z.string().optional(),
});
export type Delivery = z.infer<typeof deliverySchema>;

export const reportSettingsSchema = z.object({
  name: z.string().min(1),
  objectId: z.string(),
  measure: measureSchema,
  /** The property to split by. Absent for a single number. */
  groupBy: z.string().optional(),
  /** How a date property is split. */
  bucket: z.enum(['month', 'quarter']).optional(),
  filters: z.array(filterSchema),
  chart: chartTypeSchema,
  /** When present, the report is also emailed on this schedule. */
  delivery: deliverySchema.optional(),
});
export type ReportSettings = z.infer<typeof reportSettingsSchema>;

export const reportDefinitionSchema = reportSettingsSchema.extend({ id: z.string() });
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const reportRowSchema = z.object({
  /** The group's raw value: an option id, a user id, `2026-11`. Null for records with no value. */
  key: z.string().nullable(),
  /** The group as a person reads it. */
  label: z.string(),
  value: z.number(),
  /** How many records are in the group, whatever the measure. */
  count: z.number().int(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportResultSchema = z.object({
  rows: z.array(reportRowSchema),
  /** The measure over every matching record, not just the groups shown. */
  total: z.number(),
  records: z.number().int(),
  /** Groups beyond the largest ones are folded into "Other" when there are too many to chart. */
  truncated: z.boolean(),
});
export type ReportResult = z.infer<typeof reportResultSchema>;

export const dashboardSchema = z.object({ id: z.string(), name: z.string(), reportIds: z.array(z.string()) });
export type Dashboard = z.infer<typeof dashboardSchema>;

export interface ReportsApi {
  listReports(): Promise<ReportDefinition[]>;
  /** Runs settings as they stand, saved or not, so a report can be previewed while it is built. */
  runReport(settings: ReportSettings): Promise<ReportResult>;
  /** Creates a report, or replaces one when `id` is given. */
  saveReport(input: ReportSettings & { id?: string }): Promise<ReportDefinition>;
  deleteReport(id: string): Promise<void>;
  listDashboards(): Promise<Dashboard[]>;
  /** Replaces a dashboard's reports and their order. */
  saveDashboard(input: Dashboard): Promise<Dashboard>;
}
