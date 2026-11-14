import { z } from 'zod';

/**
 * The top of a record page: what last happened, what happens next, and what is at risk. The backend
 * works it out from the record, its activity and its open tasks, so the page opens on the answer
 * instead of a list of fields to read.
 */

export const briefSchema = z.object({
  /** One or two sentences a person could read aloud in a pipeline review. */
  summary: z.string(),
  happened: z.object({ title: z.string(), detail: z.string().optional(), occurredAt: z.string(), daysAgo: z.number().int() }).nullable(),
  next: z.object({ title: z.string(), date: z.string().nullable(), daysAway: z.number().int().nullable(), recordId: z.string().nullable(), objectId: z.string().nullable() }).nullable(),
  risks: z.array(z.object({ tone: z.enum(['danger', 'warning']), text: z.string() })),
  /** A next step to offer when nothing is planned. */
  suggestion: z.string().nullable(),
});
export type Brief = z.infer<typeof briefSchema>;

export interface BriefApi {
  /** Null for records that have no story to tell: a task, a product. */
  getBrief(recordId: string): Promise<Brief | null>;
}
