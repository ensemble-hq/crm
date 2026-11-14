import { z } from 'zod';
import type { EmailTemplate } from './inbox';
import { referenceSchema } from './records';

/**
 * Sequence contracts. A sequence is a series of steps (emails and tasks) that each enrolled contact
 * moves through on a schedule. A contact leaves the sequence when they reply, when the steps run
 * out, or when someone takes them out.
 */

export const sequenceStepSchema = z.object({
  id: z.string(),
  kind: z.enum(['email', 'call', 'task']),
  /** Working days to wait after the previous step (after enrolment, for the first). */
  waitDays: z.number().int().min(0),
  /** For an email: the template it sends. */
  templateId: z.string().optional(),
  /** For a call or task: what the person is asked to do. */
  title: z.string().optional(),
});
export type SequenceStep = z.infer<typeof sequenceStepSchema>;

export const sequenceStatsSchema = z.object({
  enrolled: z.number().int(),
  active: z.number().int(),
  replied: z.number().int(),
  finished: z.number().int(),
  stopped: z.number().int(),
});
export type SequenceStats = z.infer<typeof sequenceStatsSchema>;

export const sequenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** A paused sequence keeps its contacts but sends nothing. */
  status: z.enum(['active', 'paused']),
  steps: z.array(sequenceStepSchema),
  stats: sequenceStatsSchema,
});
export type Sequence = z.infer<typeof sequenceSchema>;

export const enrollmentSchema = z.object({
  id: z.string(),
  sequenceId: z.string(),
  contactId: z.string(),
  status: z.enum(['active', 'replied', 'finished', 'stopped']),
  /** How many steps this contact has been through. */
  stepsDone: z.number().int(),
  enrolledAt: z.string(),
  /** When the next step runs. Null when there is none. */
  nextRunAt: z.string().nullable(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

export const sequenceDetailSchema = z.object({
  sequence: sequenceSchema,
  enrollments: z.array(enrollmentSchema),
  /** How many enrolments there are in all; `enrollments` holds the most recent. */
  total: z.number().int(),
  references: z.record(referenceSchema),
});
export type SequenceDetail = z.infer<typeof sequenceDetailSchema>;

export const saveSequenceSchema = z.object({
  /** Absent to create a sequence. */
  id: z.string().optional(),
  name: z.string().min(1),
  status: z.enum(['active', 'paused']),
  steps: z.array(sequenceStepSchema),
});
export type SaveSequence = z.infer<typeof saveSequenceSchema>;

export const enrollResultSchema = z.object({
  enrolled: z.number().int(),
  /** Contacts left out, with the reason: already in the sequence, or no email address. */
  skipped: z.array(z.object({ contactId: z.string(), reason: z.string() })),
});
export type EnrollResult = z.infer<typeof enrollResultSchema>;

export interface SequencesApi {
  listSequences(): Promise<Sequence[]>;
  getSequence(id: string): Promise<SequenceDetail>;
  saveSequence(input: SaveSequence): Promise<Sequence>;
  deleteSequence(id: string): Promise<void>;
  enrollContacts(input: { sequenceId: string; contactIds: string[] }): Promise<EnrollResult>;
  /** Takes a contact out of a sequence. */
  stopEnrollment(id: string): Promise<void>;
  /** Creates a template, or replaces one when `id` is given. */
  saveEmailTemplate(input: { id?: string; name: string; subject: string; body: string }): Promise<EmailTemplate>;
  deleteEmailTemplate(id: string): Promise<void>;
}
