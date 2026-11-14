import { z } from 'zod';

/**
 * Privacy requests. A person can ask what an organization holds about them, and ask for it to be
 * removed. Both are done for one record that has an email address: a contact or a lead.
 */

const rows = z.array(z.record(z.unknown()));

/** Everything held about one person, in one document that can be handed to them. */
export const personalDataSchema = z.object({
  exportedAt: z.string(),
  /** The record itself, with its fields under their labels. */
  record: z.object({ id: z.string(), kind: z.string(), createdAt: z.string(), fields: z.record(z.unknown()) }),
  /** Whether they may be emailed, and why. */
  emailPreference: z.record(z.unknown()).nullable(),
  /** Each time they agreed to be emailed: the words, where and when. */
  consents: rows,
  /** Notes, calls, meetings and emails logged about them. */
  activity: rows,
  /** Email conversations with them, with every message. */
  conversations: rows,
  formSubmissions: rows,
  meetings: rows,
  /** Email sequences they were put in. */
  sequences: rows,
  /** Other records that point at them, such as deals and tasks, by name. */
  linkedRecords: rows,
});
export type PersonalData = z.infer<typeof personalDataSchema>;

/** What an erasure removed, by kind. */
export const erasureSchema = z.object({
  removed: z.object({
    record: z.number().int(),
    activity: z.number().int(),
    conversations: z.number().int(),
    messages: z.number().int(),
    formSubmissions: z.number().int(),
    meetings: z.number().int(),
    sequences: z.number().int(),
    consents: z.number().int(),
    other: z.number().int(),
  }),
  /** How many other records pointed at them and no longer do. */
  unlinked: z.number().int(),
  /** Whether their address was put on the never-email list, so they are not contacted again by mistake. */
  blocked: z.boolean(),
});
export type Erasure = z.infer<typeof erasureSchema>;

export interface PrivacyApi {
  /** Gathers everything held about the person behind a record. */
  exportPersonalData(recordId: string): Promise<PersonalData>;
  /** Removes the person behind a record and everything held about them. Cannot be undone. `confirm` must be their email address, or their name if they have none. */
  erasePerson(input: { recordId: string; confirm: string }): Promise<Erasure>;
}
