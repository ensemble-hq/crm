import type { BookingPage, BookingPageSettings, CaptureApi, DaySlots, Form, FormSettings, Meeting, Submission } from '../contracts/capture';
import { canOffer, freeHosts, requestedStart, slotsFor } from '../lib/booking';
import { isTimeZone, zoneName, zonedParts, zonedToUtc } from '../lib/zones';
import type { PropertyValue } from '../contracts/metadata';
import type { CrmRecord, Reference } from '../contracts/records';
import { MOCK_NOW, MOCK_TODAY, objects, users } from './definitions';
import { dataset, mulberry32 } from './generate';

/** Forms and booking pages, in memory. Submitting either really creates or updates a contact. */

type StoredForm = FormSettings & { id: string; submissions: number };
type StoredPage = BookingPageSettings & { id: string };

export const forms: StoredForm[] = [
  {
    id: 'form_demo',
    name: 'Demo request',
    heading: 'See it in action',
    fields: [
      { property: 'name', label: 'Your name', required: true },
      { property: 'email', label: 'Work email', required: true },
      { property: 'jobTitle', required: false },
      { property: 'phone', required: false },
    ],
    submitLabel: 'Request a demo',
    thanks: 'Thanks. Someone from the team will be in touch within one working day.',
    submissions: 0,
  },
  {
    id: 'form_newsletter',
    name: 'Newsletter sign-up',
    heading: 'Get our monthly update',
    fields: [
      { property: 'email', required: true },
      { property: 'name', label: 'First name', required: false },
    ],
    submitLabel: 'Subscribe',
    thanks: 'You are on the list. The next issue goes out at the start of the month.',
    submissions: 0,
  },
];

export const pages: StoredPage[] = [
  { id: 'intro-call', name: '30-minute intro call', hostIds: ['usr_maya'], durationMinutes: 30, days: [1, 2, 3, 4, 5], fromHour: 9, toHour: 17, timeZone: 'UTC', attendance: 'turn' },
  { id: 'team-demo', name: 'Demo with the team', hostIds: ['usr_priya', 'usr_jonas', 'usr_dario'], durationMinutes: 45, days: [1, 2, 3, 4], fromHour: 10, toHour: 16, timeZone: 'UTC', attendance: 'turn' },
];

let submissions: Submission[] | undefined;
let meetings: Meeting[] | undefined;
const turn = new Map<string, number>();
let counter = 0;

const DAY = 86_400_000;
const pad = (value: number) => String(value).padStart(2, '0');

/** The date `offset` days from the mock's today, and its weekday (1 Monday to 7 Sunday). */
function dayAt(offset: number): { date: string; weekday: number } {
  const date = new Date(Date.parse(MOCK_TODAY) + offset * DAY);
  return { date: date.toISOString().slice(0, 10), weekday: date.getUTCDay() || 7 };
}

/** The meetings the demo starts with. */
export function seededMeetings(): Meeting[] {
  seed();
  return meetings ?? [];
}

function seed(): void {
  if (submissions && meetings) return;
  const random = mulberry32(55_2026);
  const contacts = dataset().byObject.get('contacts') ?? [];
  const now = Date.parse(MOCK_NOW);
  submissions = [];
  for (const form of forms) {
    const count = form.id === 'form_demo' ? 86 : 240;
    form.submissions = count;
    for (let index = 0; index < 20; index += 1) {
      counter += 1;
      submissions.push({ id: `sub_${counter}`, formId: form.id, contactId: (contacts[Math.floor(random() * contacts.length)] as CrmRecord).id, submittedAt: new Date(now - Math.floor(random() ** 2 * 30 * 24) * 3_600_000).toISOString(), isNew: random() < 0.7 });
    }
  }
  submissions.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  meetings = [];
  for (const page of pages) {
    for (let index = 0; index < 12; index += 1) {
      // Scatter a few meetings over the next two weeks, on the page's own days and hours.
      const day = dayAt(1 + Math.floor(random() * 13));
      if (!page.days.includes(day.weekday)) continue;
      const hour = page.fromHour + Math.floor(random() * (page.toHour - page.fromHour));
      const startsAt = zonedToUtc(day.date, hour * 60, page.timeZone).toISOString();
      const hostId = page.hostIds[index % page.hostIds.length] as string;
      // Nobody is seeded into two meetings at once.
      if (!freeHosts(page.hostIds, page.durationMinutes, startsAt, meetings).includes(hostId)) continue;
      counter += 1;
      meetings.push({ id: `mtg_${counter}`, bookingPageId: page.id, contactId: (contacts[Math.floor(random() * contacts.length)] as CrmRecord).id, hostId, otherHostIds: [], startsAt, durationMinutes: page.durationMinutes });
    }
  }
}

function referencesFor(ids: string[]): Record<string, Reference> {
  const result: Record<string, Reference> = {};
  for (const id of ids) {
    const record = dataset().byId.get(id);
    if (record) result[id] = { objectId: record.objectId, label: String(record.properties.name ?? record.properties.email ?? id) };
  }
  return result;
}

function findForm(id: string): StoredForm {
  const form = forms.find((item) => item.id === id);
  if (!form) throw new Error('That form no longer exists.');
  return form;
}

function findPage(id: string): StoredPage {
  const page = pages.find((item) => item.id === id);
  if (!page) throw new Error('That booking page no longer exists.');
  return page;
}

function withCount(page: StoredPage): BookingPage {
  seed();
  return { ...page, booked: (meetings ?? []).filter((meeting) => meeting.bookingPageId === page.id).length };
}

/** The mock's clock: noon on its fixed today. */
const mockNow = () => new Date(`${MOCK_TODAY}T12:00:00Z`);

export type CaptureDeps = {
  respond: <T>(compute: () => T) => Promise<T>;
  /** Creates a contact, or updates the one with that email. New contacts set off workflows, like any other. */
  upsertContact: (properties: Record<string, PropertyValue>) => { record: CrmRecord; isNew: boolean };
  logActivity: (recordId: string, kind: 'note' | 'meeting', title: string, body: string) => void;
};

/** The forms and meetings half of the mock API. */
export function createCaptureApi(deps: CaptureDeps): CaptureApi {
  return {
    listForms: () =>
      deps.respond(() => {
        seed();
        return forms as Form[];
      }),

    getForm: (id) =>
      deps.respond(() => {
        seed();
        const recent = (submissions ?? []).filter((submission) => submission.formId === id).slice(0, 15);
        return { form: findForm(id), recent, references: referencesFor(recent.map((submission) => submission.contactId)) };
      }),

    getPublicForm: (id) =>
      deps.respond(() => {
        const { submissions: _count, ...form } = findForm(id);
        const contacts = objects.find((object) => object.id === 'contacts');
        return { form, fields: (contacts?.properties ?? []).filter((property) => form.fields.some((field) => field.property === property.id)) };
      }),

    saveForm: (input) =>
      deps.respond(() => {
        const { id, ...settings } = input;
        if (!settings.fields.some((field) => field.property === 'email')) throw new Error('A form needs an email field, so submissions can be matched to a contact.');
        if (id) return Object.assign(findForm(id), settings);
        counter += 1;
        const created: StoredForm = { id: `form_new_${counter}`, ...settings, submissions: 0 };
        forms.push(created);
        return created;
      }),

    deleteForm: (id) =>
      deps.respond(() => {
        const index = forms.findIndex((form) => form.id === id);
        if (index >= 0) forms.splice(index, 1);
      }),

    submitForm: (input) =>
      deps.respond(() => {
        seed();
        const form = findForm(input.formId);
        const properties: Record<string, PropertyValue> = {};
        for (const field of form.fields) {
          const value = (input.values[field.property] ?? '').trim();
          if (field.required && value === '') throw new Error(`${field.label ?? field.property} is required.`);
          if (value !== '') properties[field.property] = value;
        }
        const { record, isNew } = deps.upsertContact({ ...properties, ...(typeof properties.name === 'string' ? {} : { name: String(properties.email ?? 'New contact') }), source: 'website', lifecycleStage: 'lead', leadStatus: 'new' });
        deps.logActivity(record.id, 'note', 'Form submitted', `Submitted the "${form.name}" form.`);
        form.submissions += 1;
        counter += 1;
        submissions?.unshift({ id: `sub_new_${counter}`, formId: form.id, contactId: record.id, submittedAt: new Date().toISOString(), isNew });
        return { contactId: record.id, isNew };
      }),

    listBookingPages: () => deps.respond(() => pages.map(withCount)),

    saveBookingPage: (input) =>
      deps.respond(() => {
        const { id, ...settings } = input;
        if (settings.toHour <= settings.fromHour) throw new Error('The last start time has to be after the first.');
        if (!isTimeZone(settings.timeZone)) throw new Error(`"${settings.timeZone}" is not a time zone.`);
        if (id) return withCount(Object.assign(findPage(id), settings));
        const base = settings.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meeting';
        let slug = base;
        for (let suffix = 2; pages.some((page) => page.id === slug); suffix += 1) slug = `${base}-${suffix}`;
        const created: StoredPage = { id: slug, ...settings };
        pages.push(created);
        return withCount(created);
      }),

    deleteBookingPage: (id) =>
      deps.respond(() => {
        const index = pages.findIndex((page) => page.id === id);
        if (index >= 0) pages.splice(index, 1);
      }),

    listSlots: (bookingPageId) =>
      deps.respond(() => {
        seed();
        const page = findPage(bookingPageId);
        return { page: withCount(page), days: slotsFor(page, meetings ?? [], mockNow()) };
      }),

    bookMeeting: (input) =>
      deps.respond(() => {
        seed();
        const page = findPage(input.bookingPageId);
        if (input.name.trim() === '' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) throw new Error('Enter your name and a valid email address.');
        const startsAt = requestedStart(page, input.startsAt);
        const offered = startsAt !== undefined && slotsFor(page, meetings ?? [], mockNow()).some((day) => day.starts.includes(startsAt));
        const free = offered ? freeHosts(page.hostIds, page.durationMinutes, startsAt, meetings ?? []) : [];
        if (!offered || !canOffer(page, free)) throw new Error('That time has just been taken. Please choose another.');
        // Taking turns: the booking goes to whoever is free and next. All together: everyone is in the one meeting.
        const position = turn.get(page.id) ?? 0;
        const hostId = (page.attendance === 'all' ? page.hostIds[0] : free[position % free.length]) as string;
        const otherHostIds = page.attendance === 'all' ? page.hostIds.filter((other) => other !== hostId) : [];
        turn.set(page.id, position + 1);
        const { record } = deps.upsertContact({ name: input.name.trim(), email: input.email.trim(), source: 'website', lifecycleStage: 'lead', leadStatus: 'new' });
        counter += 1;
        const meeting: Meeting = { id: `mtg_new_${counter}`, bookingPageId: page.id, contactId: record.id, hostId, otherHostIds, startsAt, durationMinutes: page.durationMinutes };
        meetings?.push(meeting);
        const names = [hostId, ...otherHostIds].map((userId) => users.find((user) => user.id === userId)?.name ?? 'someone on the team');
        const local = zonedParts(startsAt, page.timeZone);
        deps.logActivity(record.id, 'meeting', `Meeting booked: ${page.name}`, `With ${names.join(' and ')} on ${local.date} at ${local.time} (${zoneName(page.timeZone)} time), for ${page.durationMinutes} minutes.`);
        return meeting;
      }),

    listMeetings: () =>
      deps.respond(() => {
        seed();
        const upcoming = [...(meetings ?? [])].filter((meeting) => meeting.startsAt >= MOCK_TODAY).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        return { meetings: upcoming, references: referencesFor(upcoming.map((meeting) => meeting.contactId)) };
      }),
  };
}
