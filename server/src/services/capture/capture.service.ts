import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { and, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { BookingPage, BookingPageSettings, DaySlots, Form, FormDetail, FormSettings, Meeting, PublicForm } from '../../../../src/contracts/capture';
import type { PropertyValue } from '../../../../src/contracts/metadata';
import type { CrmRecord, Reference } from '../../../../src/contracts/records';
import { type BookingPageRow, type FormRow, type MeetingRow, type SubmissionRow, bookingPagesTable, formsTable, meetingsTable, submissionsTable } from '../../schema';
import type { ActivityRepository } from '../activity/activity.repository';
import { actorOf, assertAllowed } from '../people/access';
import type { PeopleService } from '../people/people.service';
import type { RecordEvents } from '../records/records.events';
import type { RecordsRepository } from '../records/records.repository';
import type { WorkspaceService } from '../workspace/workspace.service';

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const DAY = 86_400_000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const pad = (value: number) => String(value).padStart(2, '0');

export class FormsRepository extends DrizzleRepository<FormRow> {
  constructor(db: DrizzleDb) {
    super(formsTable, db);
  }
}

export class SubmissionsRepository extends DrizzleRepository<SubmissionRow> {
  constructor(db: DrizzleDb) {
    super(submissionsTable, db);
  }

  async counts(ctx: Context): Promise<Map<string, number>> {
    const rows = (await this.db.execute(sql`select form_id, count(*)::int as total from submissions where ${and(this.buildWhere(ctx))} group by form_id`)) as unknown as Array<{ form_id: string; total: number }>;
    return new Map(rows.map((row) => [row.form_id, row.total]));
  }
}

export class BookingPagesRepository extends DrizzleRepository<BookingPageRow> {
  constructor(db: DrizzleDb) {
    super(bookingPagesTable, db);
  }

  /** Takes the next turn on a page shared between several people, and says which turn it was. */
  async takeTurn(ctx: Context, pageId: string): Promise<number> {
    const rows = (await this.db.execute(sql`update booking_pages set turn = turn + 1 where ${and(this.buildWhere(ctx), sql`booking_pages.id = ${pageId}`)} returning turn`)) as unknown as Array<{ turn: number }>;
    return (rows[0]?.turn ?? 1) - 1;
  }

  /** Holds these people's calendars for the rest of the transaction, so two visitors cannot both be given the same person's time. */
  async lockHosts(ctx: Context, hostIds: string[]): Promise<void> {
    const list = sql.join(hostIds.map((hostId) => sql`${hostId}`), sql`, `);
    await this.db.execute(sql`select id from people where tenant_id = ${ctx.tenantId} and id in (${list}) order by id for update`);
  }
}

export class MeetingsRepository extends DrizzleRepository<MeetingRow> {
  constructor(db: DrizzleDb) {
    super(meetingsTable, db);
  }

  async counts(ctx: Context): Promise<Map<string, number>> {
    const rows = (await this.db.execute(sql`select booking_page_id, count(*)::int as total from meetings where ${and(this.buildWhere(ctx))} group by booking_page_id`)) as unknown as Array<{ booking_page_id: string; total: number }>;
    return new Map(rows.map((row) => [row.booking_page_id, row.total]));
  }

  /** Meetings these people have from a date on. */
  async of(ctx: Context, hostIds: string[], from: string): Promise<MeetingRow[]> {
    return hostIds.length === 0 ? [] : this.findMany(ctx, [{ field: 'hostId', op: 'in', value: hostIds }, { field: 'startsAt', op: 'gte', value: from }], { limit: 5_000 });
  }
}

/** The hosts free at a time: those with no meeting overlapping it. */
function freeHosts(hostIds: string[], durationMinutes: number, startsAt: string, meetings: MeetingRow[]): string[] {
  const start = Date.parse(startsAt);
  const end = start + durationMinutes * 60_000;
  return hostIds.filter((hostId) => !meetings.some((meeting) => meeting.hostId === hostId && Date.parse(meeting.startsAt) < end && Date.parse(meeting.startsAt) + meeting.durationMinutes * 60_000 > start));
}

/** The free times on a page for its next eight open days, starting tomorrow. */
function slotsFor(page: BookingPageSettings, meetings: MeetingRow[], today: string): DaySlots[] {
  const days: DaySlots[] = [];
  for (let offset = 1; days.length < 8 && offset < 40; offset += 1) {
    const day = new Date(Date.parse(today) + offset * DAY);
    const date = day.toISOString().slice(0, 10);
    if (!page.days.includes(day.getUTCDay() || 7)) continue;
    const times: string[] = [];
    for (let minutes = page.fromHour * 60; minutes + page.durationMinutes <= page.toHour * 60; minutes += page.durationMinutes) {
      const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
      if (freeHosts(page.hostIds, page.durationMinutes, `${date}T${time}`, meetings).length > 0) times.push(time);
    }
    if (times.length > 0) days.push({ date, times });
  }
  return days;
}

/**
 * Forms and booking pages: the two ways someone outside the team puts themselves into the CRM. The
 * operations a visitor's browser calls (`publicForm`, `submit`, `slots`, `book`) run with no
 * signed-in person, so they take nothing on trust: every value is checked against the form or page
 * as the team set it up, and they give back nothing about anyone else.
 */
export class CaptureService {
  constructor(
    private readonly forms: FormsRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly pages: BookingPagesRepository,
    private readonly meetings: MeetingsRepository,
    private readonly records: RecordsRepository,
    private readonly events: RecordEvents,
    private readonly activities: ActivityRepository,
    private readonly people: PeopleService,
    private readonly workspace: WorkspaceService,
  ) {}

  private async references(ctx: Context, ids: string[]): Promise<Record<string, Reference>> {
    const result: Record<string, Reference> = {};
    for (const record of await this.records.byIds(ctx, [...new Set(ids)])) result[record.id] = { objectId: record.objectId, label: String(record.properties.name ?? record.properties.email ?? record.id) };
    return result;
  }

  /**
   * Makes the contact, or finds the one with that email. Someone already known keeps what the team
   * has on record: a visitor who knows an email address can add missing details but cannot change
   * existing ones. New contacts are announced, so routing workflows give them an owner.
   */
  private async upsertContact(ctx: Context, typed: Record<string, PropertyValue>): Promise<{ record: CrmRecord; isNew: boolean }> {
    const contacts = await this.workspace.definition(ctx, 'contacts');
    const has = (propertyId: string) => contacts.properties.some((property) => property.id === propertyId);
    const email = String(typed.email ?? '').trim().toLowerCase();
    const existing = await this.records.byText(ctx, 'contacts', 'email', email);
    if (existing) {
      const gaps = Object.fromEntries(Object.entries(typed).filter(([key, value]) => has(key) && key !== 'email' && value !== '' && (existing.properties[key] === null || existing.properties[key] === undefined || existing.properties[key] === '')));
      if (Object.keys(gaps).length === 0) return { record: existing, isNew: false };
      const updated = (await this.records.patch(ctx, existing.id, gaps)) ?? existing;
      await this.events.changed(ctx, updated, gaps);
      return { record: updated, isNew: false };
    }
    const wanted: Record<string, PropertyValue> = { ...typed, email, name: typeof typed.name === 'string' && typed.name ? typed.name : email, source: 'website', lifecycleStage: 'lead', leadStatus: 'new', createdAt: new Date().toISOString().slice(0, 10) };
    const record = await this.records.insert(ctx, { id: id('con'), objectId: 'contacts', properties: Object.fromEntries(Object.entries(wanted).filter(([key]) => has(key))) });
    await this.events.created(ctx, record);
    return { record, isNew: true };
  }

  // Forms

  private toForm(row: FormRow, counts: Map<string, number>): Form {
    return { id: row.id, ...row.settings, submissions: counts.get(row.id) ?? 0 };
  }

  private async form(ctx: Context, formId: string): Promise<FormRow> {
    const row = await this.forms.findById(ctx, formId);
    if (!row) throw new NotFoundError('form', formId);
    return row;
  }

  async listForms(ctx: Context): Promise<Form[]> {
    const [rows, counts] = await Promise.all([this.forms.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 }), this.submissions.counts(ctx)]);
    return rows.map((row) => this.toForm(row, counts));
  }

  async getForm(ctx: Context, formId: string): Promise<FormDetail> {
    const row = await this.form(ctx, formId);
    const [recent, counts] = await Promise.all([this.submissions.findMany(ctx, { formId }, { sort: { field: 'submittedAt', direction: 'desc' }, limit: 15 }), this.submissions.counts(ctx)]);
    return { form: this.toForm(row, counts), recent: recent.map((item) => ({ id: item.id, formId: item.formId, contactId: item.contactId, submittedAt: item.submittedAt.toISOString(), isNew: item.isNew })), references: await this.references(ctx, recent.map((item) => item.contactId)) };
  }

  /** What a visitor's browser gets: the form and the fields it asks for, and nothing else. */
  async publicForm(ctx: Context, formId: string): Promise<PublicForm> {
    const row = await this.form(ctx, formId);
    const contacts = await this.workspace.definition(ctx, 'contacts');
    return { form: { id: row.id, ...row.settings }, fields: contacts.properties.filter((property) => row.settings.fields.some((field) => field.property === property.id)) };
  }

  async saveForm(ctx: Context, input: FormSettings & { id?: string }): Promise<Form> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'change forms');
    const { id: formId, ...settings } = input;
    if (!settings.fields.some((field) => field.property === 'email')) throw new ValidationError('A form needs an email field, so submissions can be matched to a contact.');
    const contacts = await this.workspace.definition(ctx, 'contacts');
    const unknown = settings.fields.find((field) => !contacts.properties.some((property) => property.id === field.property && !property.system));
    if (unknown) throw new ValidationError(`Contacts have no property "${unknown.property}" a form can fill in.`);
    if (formId) {
      await this.form(ctx, formId);
      return this.toForm(await this.forms.update(ctx, formId, { settings }), await this.submissions.counts(ctx));
    }
    return this.toForm(await this.forms.create(ctx, { id: id('form'), settings }), new Map());
  }

  async deleteForm(ctx: Context, formId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'delete forms');
    await this.forms.deleteWhere(ctx, { id: formId });
  }

  /** What the public page calls. Only the form's own fields are taken; anything else in the request is ignored. */
  async submit(ctx: Context, input: { formId: string; values: Record<string, string> }): Promise<{ contactId: string; isNew: boolean }> {
    const row = await this.form(ctx, input.formId);
    const contacts = await this.workspace.definition(ctx, 'contacts');
    const typed: Record<string, PropertyValue> = {};
    const kept: Record<string, string> = {};
    for (const field of row.settings.fields) {
      const property = contacts.properties.find((item) => item.id === field.property);
      const value = (input.values[field.property] ?? '').trim().slice(0, 2_000);
      const label = field.label ?? property?.label ?? field.property;
      if (field.required && value === '') throw new ValidationError(`${label} is required.`);
      if (value === '' || !property) continue;
      if (property.type === 'email' && !EMAIL.test(value)) throw new ValidationError(`"${value}" is not an email address.`);
      if (property.type === 'select' && !property.options?.some((option) => option.id === value)) throw new ValidationError(`Choose one of the options for ${label}.`);
      typed[field.property] = property.type === 'number' || property.type === 'currency' ? Number(value) : property.type === 'boolean' ? value === 'true' : value;
      kept[field.property] = value;
    }
    if (typeof typed.email !== 'string') throw new ValidationError('An email address is required.');
    return this.events.transaction(ctx, async () => {
      const { record, isNew } = await this.upsertContact(ctx, typed);
      await this.submissions.create(ctx, { id: id('sub'), formId: row.id, contactId: record.id, isNew, values: kept });
      await this.activities.create(ctx, { id: id('act'), recordId: record.id, kind: 'note', title: 'Form submitted', body: `Submitted the "${row.settings.name}" form.`, actorId: 'system' });
      return { contactId: record.id, isNew };
    });
  }

  // Booking pages

  private toPage(row: BookingPageRow, counts: Map<string, number>): BookingPage {
    return { id: row.id, ...row.settings, booked: counts.get(row.id) ?? 0 };
  }

  private async page(ctx: Context, pageId: string): Promise<BookingPageRow> {
    const row = await this.pages.findById(ctx, pageId);
    if (!row) throw new NotFoundError('booking page', pageId);
    return row;
  }

  async listPages(ctx: Context): Promise<BookingPage[]> {
    const [rows, counts] = await Promise.all([this.pages.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 }), this.meetings.counts(ctx)]);
    return rows.map((row) => this.toPage(row, counts));
  }

  async savePage(ctx: Context, input: BookingPageSettings & { id?: string }): Promise<BookingPage> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'change booking pages');
    const { id: pageId, ...settings } = input;
    if (settings.toHour <= settings.fromHour) throw new ValidationError('The last start time has to be after the first.');
    const users = await this.people.users(ctx);
    if (settings.hostIds.some((hostId) => !users.some((user) => user.id === hostId))) throw new ValidationError('Everyone who can be booked has to be an active member.');
    if (pageId) {
      await this.page(ctx, pageId);
      return this.toPage(await this.pages.update(ctx, pageId, { settings }), await this.meetings.counts(ctx));
    }
    const base = settings.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meeting';
    let slug = base;
    for (let suffix = 2; await this.pages.findById(ctx, slug); suffix += 1) slug = `${base}-${suffix}`;
    return this.toPage(await this.pages.create(ctx, { id: slug, settings, turn: 0 }), new Map());
  }

  async deletePage(ctx: Context, pageId: string): Promise<void> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'delete booking pages');
    await this.pages.deleteWhere(ctx, { id: pageId });
  }

  /** The free times on a booking page for the coming days. Open to anyone with the link. */
  async slots(ctx: Context, pageId: string): Promise<{ page: BookingPage; days: DaySlots[] }> {
    const row = await this.page(ctx, pageId);
    const today = new Date().toISOString().slice(0, 10);
    const [meetings, counts] = await Promise.all([this.meetings.of(ctx, row.settings.hostIds, today), this.meetings.counts(ctx)]);
    return { page: this.toPage(row, counts), days: slotsFor(row.settings, meetings, today) };
  }

  /** What the public page calls. The time must be one the page is offering right now, checked while the hosts' calendars are held. */
  async book(ctx: Context, input: { bookingPageId: string; startsAt: string; name: string; email: string }): Promise<Meeting> {
    const row = await this.page(ctx, input.bookingPageId);
    const page = row.settings;
    const name = input.name.trim().slice(0, 200);
    const email = input.email.trim().toLowerCase();
    if (name === '' || !EMAIL.test(email)) throw new ValidationError('Enter your name and a valid email address.');
    const today = new Date().toISOString().slice(0, 10);
    const [date = '', time = ''] = input.startsAt.split('T');
    return this.events.transaction(ctx, async () => {
      await this.pages.lockHosts(ctx, page.hostIds);
      const meetings = await this.meetings.of(ctx, page.hostIds, today);
      const offered = slotsFor(page, meetings, today).find((day) => day.date === date)?.times.includes(time) ?? false;
      const free = offered ? freeHosts(page.hostIds, page.durationMinutes, input.startsAt, meetings) : [];
      if (free.length === 0) throw new ConflictError('That time has just been taken. Please choose another.');
      // Among the hosts who are free, the booking goes to whoever is next in turn.
      const hostId = free[(await this.pages.takeTurn(ctx, row.id)) % free.length] as string;
      const { record } = await this.upsertContact(ctx, { name, email });
      const meeting = await this.meetings.create(ctx, { id: id('mtg'), bookingPageId: row.id, contactId: record.id, hostId, startsAt: input.startsAt, durationMinutes: page.durationMinutes });
      const host = (await this.people.users(ctx)).find((user) => user.id === hostId)?.name ?? 'the team';
      await this.activities.create(ctx, { id: id('act'), recordId: record.id, kind: 'meeting', title: `Meeting booked: ${page.name}`, body: `With ${host} on ${input.startsAt.replace('T', ' at ')}, for ${page.durationMinutes} minutes.`, actorId: hostId });
      return { id: meeting.id, bookingPageId: meeting.bookingPageId, contactId: meeting.contactId, hostId: meeting.hostId, startsAt: meeting.startsAt, durationMinutes: meeting.durationMinutes };
    });
  }

  /** Meetings from today on, soonest first. */
  async listMeetings(ctx: Context): Promise<{ meetings: Meeting[]; references: Record<string, Reference> }> {
    const rows = await this.meetings.findMany(ctx, [{ field: 'startsAt', op: 'gte', value: new Date().toISOString().slice(0, 10) }], { sort: { field: 'startsAt', direction: 'asc' }, limit: 500 });
    return { meetings: rows.map((row) => ({ id: row.id, bookingPageId: row.bookingPageId, contactId: row.contactId, hostId: row.hostId, startsAt: row.startsAt, durationMinutes: row.durationMinutes })), references: await this.references(ctx, rows.map((row) => row.contactId)) };
  }
}
