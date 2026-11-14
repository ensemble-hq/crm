import { z } from 'zod';
import { propertyDefinitionSchema } from './metadata';
import { referenceSchema } from './records';

/**
 * Lead capture contracts: forms, and pages where someone books a meeting. Both are public pages that
 * end in a contact being created or updated, matched on email.
 */

export const formFieldSchema = z.object({
  /** The contact property this field fills. */
  property: z.string(),
  /** What the visitor sees; the property's own label when absent. */
  label: z.string().optional(),
  required: z.boolean(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formSettingsSchema = z.object({
  name: z.string().min(1),
  /** Shown above the fields on the public page. */
  heading: z.string(),
  fields: z.array(formFieldSchema).min(1),
  submitLabel: z.string().min(1),
  /** Shown after a successful submission. */
  thanks: z.string(),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export const formSchema = formSettingsSchema.extend({ id: z.string(), submissions: z.number().int() });
export type Form = z.infer<typeof formSchema>;

export const submissionSchema = z.object({ id: z.string(), formId: z.string(), contactId: z.string(), submittedAt: z.string(), isNew: z.boolean() });
export type Submission = z.infer<typeof submissionSchema>;

export const formDetailSchema = z.object({ form: formSchema, recent: z.array(submissionSchema), references: z.record(referenceSchema) });
export type FormDetail = z.infer<typeof formDetailSchema>;

/** What a visitor's browser is given to draw a form: the form itself and the fields it asks for. Nothing about who else has filled it in. */
export const publicFormSchema = z.object({ form: formSettingsSchema.extend({ id: z.string() }), fields: z.array(propertyDefinitionSchema) });
export type PublicForm = z.infer<typeof publicFormSchema>;

export const bookingPageSettingsSchema = z.object({
  name: z.string().min(1),
  /** Who can be booked. With several people, bookings go to each in turn. */
  hostIds: z.array(z.string()).min(1),
  durationMinutes: z.number().int().min(15).max(240),
  /** Days of the week on offer: 1 is Monday, 7 is Sunday. */
  days: z.array(z.number().int().min(1).max(7)).min(1),
  /** The first and last hour a meeting can start, on the 24-hour clock. */
  fromHour: z.number().int().min(0).max(23),
  toHour: z.number().int().min(1).max(24),
});
export type BookingPageSettings = z.infer<typeof bookingPageSettingsSchema>;

export const bookingPageSchema = bookingPageSettingsSchema.extend({ id: z.string(), booked: z.number().int() });
export type BookingPage = z.infer<typeof bookingPageSchema>;

export const meetingSchema = z.object({
  id: z.string(),
  bookingPageId: z.string(),
  contactId: z.string(),
  hostId: z.string(),
  /** Local date and time, `2026-11-17T10:30`. */
  startsAt: z.string(),
  durationMinutes: z.number().int(),
});
export type Meeting = z.infer<typeof meetingSchema>;

export const daySlotsSchema = z.object({ date: z.string(), times: z.array(z.string()) });
export type DaySlots = z.infer<typeof daySlotsSchema>;

export interface CaptureApi {
  listForms(): Promise<Form[]>;
  getForm(id: string): Promise<FormDetail>;
  /** What the public page loads. Open to anyone with the link. */
  getPublicForm(id: string): Promise<PublicForm>;
  /** Creates a form, or replaces one when `id` is given. */
  saveForm(input: FormSettings & { id?: string }): Promise<Form>;
  deleteForm(id: string): Promise<void>;
  /** What the public page calls. Creates the contact, or updates the one with that email. */
  submitForm(input: { formId: string; values: Record<string, string> }): Promise<{ contactId: string; isNew: boolean }>;

  listBookingPages(): Promise<BookingPage[]>;
  /** Creates a booking page, or replaces one when `id` is given. */
  saveBookingPage(input: BookingPageSettings & { id?: string }): Promise<BookingPage>;
  deleteBookingPage(id: string): Promise<void>;
  /** The free times on a booking page for the coming days. */
  listSlots(bookingPageId: string): Promise<{ page: BookingPage; days: DaySlots[] }>;
  /** What the public page calls. Books the time and logs the meeting on the contact. */
  bookMeeting(input: { bookingPageId: string; startsAt: string; name: string; email: string }): Promise<Meeting>;
  /** Meetings from now on, soonest first. */
  listMeetings(): Promise<{ meetings: Meeting[]; references: Record<string, z.infer<typeof referenceSchema>> }>;
}
