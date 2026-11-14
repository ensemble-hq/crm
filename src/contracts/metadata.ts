import { z } from 'zod';

/**
 * Metadata contracts. Objects, their properties and their saved views are data, not code: every
 * list, form, board and record page renders from these definitions, so a custom object or a new
 * field needs no new screen.
 */

export const propertyTypeSchema = z.enum([
  'text',
  'email',
  'phone',
  'url',
  'number',
  'currency',
  'date',
  'datetime',
  'select',
  'multiselect',
  'boolean',
  'user',
  'reference',
]);
export type PropertyType = z.infer<typeof propertyTypeSchema>;

export const toneSchema = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);
export type Tone = z.infer<typeof toneSchema>;

export const optionSchema = z.object({
  id: z.string(),
  label: z.string(),
  tone: toneSchema.optional(),
});
export type Option = z.infer<typeof optionSchema>;

export const propertyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);
export type PropertyValue = z.infer<typeof propertyValueSchema>;

export const propertyDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: propertyTypeSchema,
  /** Heading the property sits under on the record page. */
  group: z.string(),
  /** Choices for `select` and `multiselect`. */
  options: z.array(optionSchema).optional(),
  /** The object a `reference` points at. */
  referenceObjectId: z.string().optional(),
  /** Set by the system; shown but never edited. */
  system: z.boolean().optional(),
  /** Asked for when a record is created. */
  onCreate: z.boolean().optional(),
  /** Added in this workspace, not part of the template. Only custom properties can be deleted. */
  custom: z.boolean().optional(),
  /** A record cannot be saved with this empty. */
  required: z.boolean().optional(),
  /** No two records may hold the same value. */
  unique: z.boolean().optional(),
});
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>;

export const filterOperatorSchema = z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'lt', 'between', 'empty', 'notEmpty']);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

/**
 * One condition of a view. String values may be tokens the server resolves per request:
 * `$me` (the signed-in user), `$today`, `$monthStart`, `$monthEnd`.
 */
export const filterSchema = z.object({
  property: z.string(),
  operator: filterOperatorSchema,
  value: propertyValueSchema.optional(),
});
export type Filter = z.infer<typeof filterSchema>;

export const sortSchema = z.object({
  property: z.string(),
  direction: z.enum(['asc', 'desc']),
});
export type Sort = z.infer<typeof sortSchema>;

export const viewDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.array(z.string()),
  filters: z.array(filterSchema),
  sort: sortSchema.optional(),
});
export type ViewDefinition = z.infer<typeof viewDefinitionSchema>;

export const objectDefinitionSchema = z.object({
  /** Also the URL segment: `/contacts`. */
  id: z.string(),
  singular: z.string(),
  plural: z.string(),
  /** A Lucide icon name from `ui/icons`. */
  icon: z.string(),
  /** The property that names a record. */
  primaryProperty: z.string(),
  /** A second line under the name in lists and cards. */
  secondaryProperty: z.string().optional(),
  properties: z.array(propertyDefinitionSchema),
  views: z.array(viewDefinitionSchema).min(1),
  /** Present when records move through stages: the board groups by this `select` property. */
  board: z
    .object({
      groupBy: z.string(),
      sumProperty: z.string().optional(),
      dateProperty: z.string().optional(),
    })
    .optional(),
  /** Present when records belong on a calendar: the date property that places them. */
  calendar: z.object({ dateProperty: z.string() }).optional(),
  /** Present when records get finished (tasks): the `select` property that says so, and its two values. */
  completion: z.object({ property: z.string(), open: z.string(), done: z.string() }).optional(),
  /** Added in this workspace, not part of the template. */
  custom: z.boolean().optional(),
});
export type ObjectDefinition = z.infer<typeof objectDefinitionSchema>;

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type User = z.infer<typeof userSchema>;

/** What a new property needs; its id is derived from the label. */
export const createPropertySchema = z.object({
  objectId: z.string(),
  label: z.string().min(1),
  type: propertyTypeSchema,
  group: z.string().min(1),
  options: z.array(optionSchema).optional(),
  referenceObjectId: z.string().optional(),
  onCreate: z.boolean().optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  /** Also show it as a column in every saved view of the object. */
  addToViews: z.boolean().optional(),
});
export type CreateProperty = z.infer<typeof createPropertySchema>;

/** A property's type and id never change once it holds data; everything else can. */
export const updatePropertySchema = z.object({
  objectId: z.string(),
  propertyId: z.string(),
  label: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
  options: z.array(optionSchema).optional(),
  onCreate: z.boolean().optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
});
export type UpdateProperty = z.infer<typeof updatePropertySchema>;

export const createObjectSchema = z.object({
  singular: z.string().min(1),
  plural: z.string().min(1),
  icon: z.string(),
});
export type CreateObject = z.infer<typeof createObjectSchema>;

/** A new saved view, or the new state of an existing one. */
export const saveViewSchema = z.object({
  objectId: z.string(),
  /** Absent to create a view; present to replace that view's settings. */
  viewId: z.string().optional(),
  name: z.string().min(1),
  columns: z.array(z.string()).min(1),
  filters: z.array(filterSchema),
  sort: sortSchema.optional(),
});
export type SaveView = z.infer<typeof saveViewSchema>;
