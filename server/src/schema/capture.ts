import { column, defineTable, index, type InferEntity } from '@mariachi/database';
import type { BookingPageSettings, FormSettings } from '../../../src/contracts/capture';

/** A form on a public page. Submitting it creates a contact, or adds to the one with that email. */
export const formsTable = defineTable('forms', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  settings: column.json().$type<FormSettings>().notNull(),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type FormRow = InferEntity<typeof formsTable>;

export const submissionsTable = defineTable(
  'submissions',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    formId: column.text().notNull(),
    contactId: column.text().notNull(),
    /** Whether the submission made the contact, or they were already known. */
    isNew: column.boolean().notNull(),
    /** What was typed, kept as submitted. */
    values: column.json().$type<Record<string, string>>().notNull().defaultSql("'{}'::jsonb"),
    submittedAt: column.timestamp().notNull().defaultNow(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('submissions_form_idx').on('tenantId', 'formId', 'submittedAt')] },
);
export type SubmissionRow = InferEntity<typeof submissionsTable>;

/** A public page where someone books time with one person, or with whoever of several is next in turn. Its id is its link. */
export const bookingPagesTable = defineTable('booking_pages', {
  id: column.text().primaryKey(),
  tenantId: column.text().notNull(),
  settings: column.json().$type<BookingPageSettings>().notNull(),
  turn: column.integer().notNull().default(0),
  createdAt: column.timestamp().notNull().defaultNow(),
  updatedAt: column.timestamp().notNull().defaultNow(),
});
export type BookingPageRow = InferEntity<typeof bookingPagesTable>;

export const meetingsTable = defineTable(
  'meetings',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    bookingPageId: column.text().notNull(),
    contactId: column.text().notNull(),
    hostId: column.text().notNull(),
    /** Local date and time, `2026-11-17T10:30`. */
    startsAt: column.text().notNull(),
    durationMinutes: column.integer().notNull(),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  // The last line of defence against a double booking: one person cannot have two meetings starting at the same moment.
  { indexes: [index('meetings_host_start_idx').on('tenantId', 'hostId', 'startsAt').unique(), index('meetings_start_idx').on('tenantId', 'startsAt')] },
);
export type MeetingRow = InferEntity<typeof meetingsTable>;
