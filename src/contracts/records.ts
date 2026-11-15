import { z } from 'zod';
import type { AssistantApi } from './assistant';
import type { AuditApi } from './audit';
import type { PrivacyApi } from './privacy';
import type { BriefApi } from './brief';
import type { CaptureApi } from './capture';
import type { InboxApi } from './inbox';
import type { ReportsApi } from './reports';
import type { SalesApi } from './sales';
import type { SequencesApi } from './sequences';
import type { Access, TeamApi } from './team';
import type { WorkflowsApi } from './workflows';
import { type CreateObject, type CreateProperty, type ObjectDefinition, type SaveView, type StageRules, type UpdateProperty, type User, type ViewDefinition, filterSchema, propertyValueSchema, sortSchema } from './metadata';

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

/**
 * Adds choices to, or takes them off, a several-choices field on many records at once, leaving
 * each record's other choices alone. This is how records are put in a segment by hand. The records
 * are named by id, or as everything a list shows (a view, filters, a search).
 */
export const labelRecordsSchema = z.object({
  objectId: z.string(),
  /** The several-choices property, such as `segments` or `tags`. */
  property: z.string(),
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
  ids: z.array(z.string()).max(5_000).optional(),
  viewId: z.string().optional(),
  filters: z.array(filterSchema).optional(),
  search: z.string().optional(),
});
export type LabelRecords = z.input<typeof labelRecordsSchema>;
export const labelResultSchema = z.object({ changed: z.number().int(), unchanged: z.number().int(), skipped: z.number().int() });
export type LabelResult = z.infer<typeof labelResultSchema>;

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

/** Records that look like the same thing entered twice: they share a value that should be one of a kind, such as an email address. */
export const duplicatesQuerySchema = z.object({
  objectId: z.string(),
  /** The field to compare. Absent, the object's most telling one: an email address, a website, or failing those the name. */
  property: z.string().optional(),
});
export const duplicatesSchema = z.object({
  /** The field that was compared. */
  property: z.string(),
  /** Each set of records sharing a value, largest sets first. At most 50 sets, and five records of each. */
  groups: z.array(z.object({ value: z.string(), count: z.number().int(), records: z.array(recordSchema) })),
  /** How many sets there are in all. */
  total: z.number().int(),
});
export type Duplicates = z.infer<typeof duplicatesSchema>;

export type Workspace = {
  name: string;
  objects: ObjectDefinition[];
  /** Everyone records can be given to. People who have been deactivated are left out. */
  users: User[];
  /** People who have been deactivated and agents that have been removed. Only for showing a name next to what they did. */
  former?: User[];
  /** Who the CRM is being used as: the signed-in person, or the one they are viewing as. */
  currentUserId: string;
  access: Access;
};

export const deletedQuerySchema = z.object({ objectId: z.string(), page: z.number().int().min(1), pageSize: z.number().int().min(1).max(100) });
export type DeletedQuery = z.infer<typeof deletedQuerySchema>;
export const deletedListSchema = z.object({
  records: z.array(z.object({ id: z.string(), objectId: z.string(), name: z.string(), deletedAt: z.string(), /** The id of whoever deleted it, when that is known. */ deletedBy: z.string().nullable() })),
  total: z.number().int(),
});
export type DeletedList = z.infer<typeof deletedListSchema>;
export const restoreResultSchema = z.object({ restored: z.number().int(), skipped: z.array(z.object({ id: z.string(), reason: z.string() })) });
export type RestoreResult = z.infer<typeof restoreResultSchema>;

export interface CrmApi extends InboxApi, ReportsApi, SequencesApi, WorkflowsApi, CaptureApi, TeamApi, SalesApi, BriefApi, AssistantApi, AuditApi, PrivacyApi {
  getWorkspace(): Promise<Workspace>;
  listRecords(query: ListQuery): Promise<ListResult>;
  summarize(query: SummaryQuery): Promise<SummaryRow[]>;
  getRecord(id: string): Promise<RecordDetail>;
  /** Records of other objects that point at this one, or that it points at, a few per object. */
  listRelated(id: string): Promise<RelatedGroup[]>;
  listActivity(recordId: string): Promise<Activity[]>;
  createRecord(input: CreateRecord): Promise<CrmRecord>;
  updateRecord(input: UpdateRecord): Promise<CrmRecord>;
  /** Adds or removes choices of a several-choices field on many records. `skipped` counts records the caller may not edit. */
  labelRecords(input: LabelRecords): Promise<LabelResult>;
  deleteRecords(ids: string[]): Promise<{ deleted: number }>;
  /** Records that were deleted and can be brought back, newest first. For the people who run the workspace. */
  listDeletedRecords(query: DeletedQuery): Promise<DeletedList>;
  /** Brings deleted records back as they were. */
  restoreRecords(ids: string[]): Promise<RestoreResult>;
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
  /** Sets which fields each stage needs and whether stages can be skipped. */
  saveStageRules(input: StageRules): Promise<ObjectDefinition>;
  findDuplicates(input: z.infer<typeof duplicatesQuerySchema>): Promise<Duplicates>;
}
