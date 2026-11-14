import { z } from 'zod';
import { type ObjectDefinition, type User, filterSchema, propertyValueSchema, sortSchema } from './metadata';

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

export type Workspace = { name: string; objects: ObjectDefinition[]; users: User[]; currentUserId: string };

export interface CrmApi {
  getWorkspace(): Promise<Workspace>;
  listRecords(query: ListQuery): Promise<ListResult>;
  summarize(query: SummaryQuery): Promise<SummaryRow[]>;
  getRecord(id: string): Promise<RecordDetail>;
  /** Records of other objects that point at this one, or that it points at, a few per object. */
  listRelated(id: string): Promise<RelatedGroup[]>;
  listActivity(recordId: string): Promise<Activity[]>;
  createRecord(input: CreateRecord): Promise<CrmRecord>;
  updateRecord(input: UpdateRecord): Promise<CrmRecord>;
  createActivity(input: CreateActivity): Promise<Activity>;
}
