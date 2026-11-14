import { z } from 'zod';
import type { CaptureApi } from './capture';
import type { InboxApi } from './inbox';
import type { ReportsApi } from './reports';
import type { SalesApi } from './sales';
import type { SequencesApi } from './sequences';
import type { Access, TeamApi } from './team';
import type { WorkflowsApi } from './workflows';
import { type CreateObject, type CreateProperty, type ObjectDefinition, type SaveView, type UpdateProperty, type User, type ViewDefinition, filterSchema, propertyValueSchema, sortSchema } from './metadata';

/**
 * Record contracts and the API the app talks to. The mock in `src/mock/api.ts` implements `CrmApi`
 * today; the backend's procedures replace it one method at a time, with no change to the pages.
 */

export const recordSchema = z.object({
  id: z.string(),
  objectId: z.string(),
  properties: z.record(propertyValueSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmRecord = z.infer<typeof recordSchema>;

/** What a `reference` value points at, resolved so lists never fetch per row. */
export const referenceSchema = z.object({ objectId: z.string(), label: z.string() });
export type Reference = z.infer<typeof referenceSchema>;

export const listQuerySchema = z.object({
  objectId: z.string(),
  /** Applies the view's filters, and its sort when `sort` is absent. */
  viewId: z.string().optional(),
  /** Added to the view's filters; with no `viewId`, these are the only filters. */
  filters: z.array(filterSchema).optional(),
  search: z.string().optional(),
  sort: sortSchema.optional(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(200),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const listResultSchema = z.object({
  records: z.array(recordSchema),
  total: z.number().int(),
  references: z.record(referenceSchema),
});
export type ListResult = z.infer<typeof listResultSchema>;

export const summaryQuerySchema = z.object({
  objectId: z.string(),
  viewId: z.string().optional(),
  filters: z.array(filterSchema).optional(),
  search: z.string().optional(),
  groupBy: z.string(),
  sumProperty: z.string().optional(),
});
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

export const summaryRowSchema = z.object({ value: z.string().nullable(), count: z.number().int(), sum: z.number() });
export type SummaryRow = z.infer<typeof summaryRowSchema>;

export const recordDetailSchema = z.object({
  record: recordSchema,
  references: z.record(referenceSchema),
});
export type RecordDetail = z.infer<typeof recordDetailSchema>;

export const relatedGroupSchema = z.object({
  objectId: z.string(),
  total: z.number().int(),
  records: z.array(recordSchema),
});
export type RelatedGroup = z.infer<typeof relatedGroupSchema>;

export const activityKindSchema = z.enum(['note', 'email', 'call', 'meeting', 'task', 'change']);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activitySchema = z.object({
  id: z.string(),
  recordId: z.string(),
  kind: activityKindSchema,
  title: z.string(),
  body: z.string().optional(),
  actorId: z.string(),
  occurredAt: z.string(),
});
export type Activity = z.infer<typeof activitySchema>;

export const createRecordSchema = z.object({
  objectId: z.string(),
  properties: z.record(propertyValueSchema),
});
export type CreateRecord = z.infer<typeof createRecordSchema>;

export const updateRecordSchema = z.object({
  id: z.string(),
  properties: z.record(propertyValueSchema),
});
export type UpdateRecord = z.infer<typeof updateRecordSchema>;

export const createActivitySchema = z.object({
  recordId: z.string(),
  kind: activityKindSchema,
  title: z.string(),
  body: z.string().optional(),
});
export type CreateActivity = z.infer<typeof createActivitySchema>;

/**
 * One import. Values arrive as the text from the file; the server turns them into each property's
 * type (a choice by its label, a person by name or email, a linked record by its name).
 * With `dryRun`, nothing is written and the result says what would happen.
 */
export const importRequestSchema = z.object({
  objectId: z.string(),
  /** One entry per row: property id to the text in that row's cell. */
  rows: z.array(z.record(z.string())),
  /** Rows are matched to existing records on this property. Absent, every row is new. */
  matchOn: z.string().optional(),
  /** What to do with a row that matches an existing record. */
  onMatch: z.enum(['skip', 'update']),
  /** Properties set on every created record, such as the owner. */
  defaults: z.record(propertyValueSchema).optional(),
  dryRun: z.boolean().optional(),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const importResultSchema = z.object({
  created: z.array(z.string()),
  updated: z.number().int(),
  /** Rows left out, by their position in the file (1 is the first data row), with the reason. */
  skipped: z.array(z.object({ row: z.number().int(), reason: z.string() })),
  /** Values that could not be understood and were left empty, such as an unknown choice. */
  warnings: z.array(z.object({ row: z.number().int(), message: z.string() })),
});
export type ImportResult = z.infer<typeof importResultSchema>;

/** Folds one record into another: the kept record takes the chosen values, everything that pointed at the other now points at it, and the other is removed. */
export const mergeRecordsSchema = z.object({
  keepId: z.string(),
  mergeId: z.string(),
  /** The values the kept record ends up with, for the properties where the two differed. */
  properties: z.record(propertyValueSchema),
});
export type MergeRecords = z.infer<typeof mergeRecordsSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  message: z.string(),
  /** The record it is about, when there is one. */
  recordId: z.string().nullable(),
  createdAt: z.string(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof notificationSchema>;

export type Workspace = {
  name: string;
  objects: ObjectDefinition[];
  /** Everyone records can be given to. People who have been deactivated are left out. */
  users: User[];
  /** Who the CRM is being used as: the signed-in person, or the one they are viewing as. */
  currentUserId: string;
  access: Access;
};

export interface CrmApi extends InboxApi, ReportsApi, SequencesApi, WorkflowsApi, CaptureApi, TeamApi, SalesApi {
  getWorkspace(): Promise<Workspace>;
  listRecords(query: ListQuery): Promise<ListResult>;
  summarize(query: SummaryQuery): Promise<SummaryRow[]>;
  getRecord(id: string): Promise<RecordDetail>;
  /** Records of other objects that point at this one, or that it points at, a few per object. */
  listRelated(id: string): Promise<RelatedGroup[]>;
  listActivity(recordId: string): Promise<Activity[]>;
  createRecord(input: CreateRecord): Promise<CrmRecord>;
  updateRecord(input: UpdateRecord): Promise<CrmRecord>;
  deleteRecords(ids: string[]): Promise<{ deleted: number }>;
  importRecords(input: ImportRequest): Promise<ImportResult>;
  mergeRecords(input: MergeRecords): Promise<CrmRecord>;
  /** The signed-in user's notifications, newest first, with names for the records they are about. */
  listNotifications(): Promise<{ notifications: Notification[]; references: Record<string, Reference> }>;
  /** Marks one notification read, or all of them when no id is given. */
  markNotificationsRead(id?: string): Promise<void>;
  createActivity(input: CreateActivity): Promise<Activity>;
  /** Metadata changes. Each returns the object as it now stands. */
  createObject(input: CreateObject): Promise<ObjectDefinition>;
  createProperty(input: CreateProperty): Promise<ObjectDefinition>;
  updateProperty(input: UpdateProperty): Promise<ObjectDefinition>;
  deleteProperty(input: { objectId: string; propertyId: string }): Promise<ObjectDefinition>;
  /** Creates a saved view, or replaces one's columns, filters and sort. */
  saveView(input: SaveView): Promise<ViewDefinition>;
  deleteView(input: { objectId: string; viewId: string }): Promise<ObjectDefinition>;
}
