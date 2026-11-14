import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { PropertyValue } from '../../../../src/contracts/metadata';
import type { CrmRecord, Reference } from '../../../../src/contracts/records';
import type { EnrollResult, Enrollment, SaveSequence, Sequence, SequenceDetail, SequenceStep } from '../../../../src/contracts/sequences';
import type { EnrollmentRow, SequenceRow } from '../../schema';
import type { EmailTemplatesRepository } from '../inbox/inbox.repository';
import { type EmailRules, OverLimit } from '../inbox/email-rules.service';
import type { MailService } from '../inbox/mail.service';
import type { PeopleService } from '../people/people.service';
import type { RecordEvents } from '../records/records.events';
import type { RecordsRepository } from '../records/records.repository';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { EnrollmentsRepository, SequencesRepository } from './sequences.repository';

/**
 * Sequences that really run. Each step is carried out in one database transaction together with
 * moving the contact on to the next step: the email is queued (the worker sends it, as for any
 * email) or the task is created, and the schedule advances, or none of it happens. So a step is
 * never done twice and never half done, however many workers are running or when one stops.
 */

const RECENT = 40;
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const EMPTY = { enrolled: 0, active: 0, replied: 0, finished: 0, stopped: 0 };

/** `days` working days after `from`: weekends do not count, and nothing is ever scheduled on one. */
export function afterWorkingDays(from: Date, days: number): Date {
  const date = new Date(from);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) left -= 1;
  }
  return date;
}

/**
 * When a step with this wait becomes due. A step with no wait is due at once, and is dated a few
 * seconds back so that it counts as due even where this server's clock runs slightly ahead of the
 * database's.
 */
const dueAfter = (waitDays: number) => (waitDays <= 0 ? new Date(Date.now() - 5_000) : afterWorkingDays(new Date(), waitDays));

function toEnrollment(row: EnrollmentRow): Enrollment {
  return { id: row.id, sequenceId: row.sequenceId, contactId: row.contactId, status: row.status as Enrollment['status'], stepsDone: row.stepsDone, enrolledAt: row.enrolledAt.toISOString(), nextRunAt: row.nextRunAt?.toISOString() ?? null };
}

export class SequencesService {
  constructor(
    private readonly sequences: SequencesRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly templates: EmailTemplatesRepository,
    private readonly records: RecordsRepository,
    private readonly recordEvents: RecordEvents,
    private readonly mail: MailService,
    private readonly people: PeopleService,
    private readonly workspace: WorkspaceService,
    private readonly transaction: <T>(ctx: Context, fn: () => Promise<T>) => Promise<T>,
    private readonly rules: EmailRules,
  ) {}

  private async find(ctx: Context, sequenceId: string): Promise<SequenceRow> {
    const row = await this.sequences.findById(ctx, sequenceId);
    if (!row) throw new NotFoundError('sequence', sequenceId);
    return row;
  }

  async list(ctx: Context): Promise<Sequence[]> {
    const [rows, stats] = await Promise.all([this.sequences.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'asc' }, limit: 500 }), this.enrollments.stats(ctx)]);
    return rows.map((row) => ({ id: row.id, name: row.name, status: row.status as Sequence['status'], steps: row.steps, stats: stats.get(row.id) ?? EMPTY }));
  }

  async get(ctx: Context, sequenceId: string): Promise<SequenceDetail> {
    const row = await this.find(ctx, sequenceId);
    const [recent, stats] = await Promise.all([this.enrollments.findMany(ctx, { sequenceId }, { sort: { field: 'enrolledAt', direction: 'desc' }, limit: RECENT }), this.enrollments.stats(ctx)]);
    const references: Record<string, Reference> = {};
    for (const contact of await this.records.byIds(ctx, [...new Set(recent.map((enrollment) => enrollment.contactId))])) references[contact.id] = { objectId: contact.objectId, label: String(contact.properties.name ?? contact.id) };
    const mine = stats.get(row.id) ?? EMPTY;
    return { sequence: { id: row.id, name: row.name, status: row.status as Sequence['status'], steps: row.steps, stats: mine }, enrollments: recent.map(toEnrollment), total: mine.enrolled, references };
  }

  async save(ctx: Context, input: SaveSequence): Promise<Sequence> {
    if (input.steps.length === 0) throw new ValidationError('A sequence needs at least one step.');
    for (const step of input.steps) {
      if (step.kind === 'email' ? !step.templateId || !(await this.templates.findById(ctx, step.templateId)) : !step.title?.trim()) throw new ValidationError(step.kind === 'email' ? 'Choose a template for every email step.' : 'Say what each call or task is.');
    }
    const fields = { name: input.name.trim(), status: input.status, steps: input.steps };
    const stats = await this.enrollments.stats(ctx);
    if (input.id) {
      const before = await this.find(ctx, input.id);
      const row = await this.sequences.update(ctx, input.id, fields);
      if (before.status === 'paused' && row.status === 'active') await this.enrollments.resume(ctx, row.id);
      return { id: row.id, name: row.name, status: row.status as Sequence['status'], steps: row.steps, stats: stats.get(row.id) ?? EMPTY };
    }
    const row = await this.sequences.create(ctx, { id: id('seq'), ...fields });
    return { id: row.id, name: row.name, status: row.status as Sequence['status'], steps: row.steps, stats: EMPTY };
  }

  async remove(ctx: Context, sequenceId: string): Promise<void> {
    await this.transaction(ctx, async () => {
      await this.enrollments.deleteWhere(ctx, { sequenceId });
      await this.sequences.deleteWhere(ctx, { id: sequenceId });
    });
  }

  /** The sequence that uses a template, if any, so a template in use is not deleted from under it. */
  async usingTemplate(ctx: Context, templateId: string): Promise<string | undefined> {
    return (await this.sequences.findMany(ctx, {}, { limit: 500 })).find((sequence) => sequence.steps.some((step) => step.templateId === templateId))?.name;
  }

  /** Enrols one contact. Returns why not, in words, when it cannot. */
  private async enrollOne(ctx: Context, sequence: SequenceRow, contact: CrmRecord | undefined, senderId: string | null): Promise<string | undefined> {
    const name = String(contact?.properties.name ?? 'This contact');
    if (!contact || typeof contact.properties.email !== 'string' || contact.properties.email === '') return `${name} has no email address.`;
    if (await this.enrollments.exists(ctx, { sequenceId: sequence.id, contactId: contact.id, status: 'active' })) return `${name} is already in this sequence.`;
    const preference = await this.rules.describe(ctx, contact.properties.email);
    if (preference.status !== 'subscribed') return `${name} has ${preference.status === 'blocked' ? 'an address that cannot be emailed' : 'unsubscribed'}.`;
    const first = sequence.steps[0];
    await this.enrollments.create(ctx, { id: id('enr'), sequenceId: sequence.id, contactId: contact.id, status: 'active', stepsDone: 0, senderId, conversationId: null, problem: null, nextRunAt: sequence.status === 'active' && first ? dueAfter(first.waitDays) : null });
    return undefined;
  }

  async enroll(ctx: Context, input: { sequenceId: string; contactIds: string[] }): Promise<EnrollResult> {
    const sequence = await this.find(ctx, input.sequenceId);
    const contacts = new Map((await this.records.byIds(ctx, input.contactIds)).map((contact) => [contact.id, contact]));
    const result: EnrollResult = { enrolled: 0, skipped: [] };
    for (const contactId of input.contactIds) {
      const reason = await this.enrollOne(ctx, sequence, contacts.get(contactId), ctx.userId);
      if (reason) result.skipped.push({ contactId, reason });
      else result.enrolled += 1;
    }
    return result;
  }

  /** Enrols one contact for a workflow. Returns what happened, in words; throws when it cannot be done. */
  async enrollFromWorkflow(ctx: Context, sequenceId: string, contact: CrmRecord, senderId: string | null): Promise<string> {
    const sequence = await this.sequences.findById(ctx, sequenceId);
    if (!sequence) throw new ConflictError('The sequence no longer exists.');
    const name = String(contact.properties.name ?? 'The contact');
    const reason = await this.enrollOne(ctx, sequence, contact, senderId);
    if (reason?.includes('already')) return `${name} was already in "${sequence.name}"`;
    if (reason) throw new ConflictError(reason);
    return `Enrolled ${name} in "${sequence.name}"`;
  }

  async stop(ctx: Context, enrollmentId: string): Promise<void> {
    await this.enrollments.updateWhere(ctx, { id: enrollmentId }, { status: 'stopped', nextRunAt: null });
  }

  /** A contact who answers leaves every sequence they are in: nobody wants the next nudge after they have replied. */
  async contactReplied(ctx: Context, contactId: string): Promise<void> {
    await this.enrollments.updateWhere(ctx, { contactId, status: 'active' }, { status: 'replied', nextRunAt: null });
  }

  /** Carries out every step that is due. Run by the worker on a timer. Returns how many steps ran. */
  async runDue(ctx: Context): Promise<number> {
    let ran = 0;
    for (const enrollmentId of await this.enrollments.due(ctx, 200)) if (await this.step(ctx, enrollmentId)) ran += 1;
    return ran;
  }

  private async step(ctx: Context, enrollmentId: string): Promise<boolean> {
    try {
      return await this.transaction(ctx, async () => {
        if (!(await this.enrollments.lockDue(ctx, enrollmentId))) return false;
        const enrollment = await this.enrollments.getById(ctx, enrollmentId);
        const sequence = await this.find(ctx, enrollment.sequenceId);
        const step = sequence.steps[enrollment.stepsDone];
        if (!step) {
          await this.enrollments.update(ctx, enrollment.id, { status: 'finished', nextRunAt: null });
          return false;
        }
        const conversationId = await this.perform(ctx, sequence, enrollment, step);
        const next = sequence.steps[enrollment.stepsDone + 1];
        await this.enrollments.update(ctx, enrollment.id, { stepsDone: enrollment.stepsDone + 1, conversationId, status: next ? 'active' : 'finished', nextRunAt: next ? dueAfter(next.waitDays) : null });
        return true;
      });
    } catch (error) {
      // Too much email this week is a reason to wait, not to give up: the step is put off until there is room.
      if (error instanceof OverLimit) {
        await this.enrollments.update(ctx, enrollmentId, { nextRunAt: error.until });
        return false;
      }
      // A step that cannot be carried out stops that contact's run and says why, instead of failing again every few seconds.
      await this.enrollments.update(ctx, enrollmentId, { status: 'stopped', nextRunAt: null, problem: error instanceof Error ? error.message : String(error) });
      ctx.logger.warn({ enrollmentId, error }, 'A sequence step could not be carried out; the enrolment was stopped');
      return false;
    }
  }

  /** Does one step. Returns the email thread the sequence is using for this contact. */
  private async perform(ctx: Context, sequence: SequenceRow, enrollment: EnrollmentRow, step: SequenceStep): Promise<string | null> {
    const contact = await this.records.one(ctx, enrollment.contactId);
    if (!contact) throw new Error('The contact was deleted.');
    const users = await this.people.users(ctx);
    const owner = typeof contact.properties.owner === 'string' ? contact.properties.owner : null;
    const sender = users.find((user) => user.id === enrollment.senderId) ?? users.find((user) => user.id === owner);
    if (!sender) throw new Error('There is nobody to send this from: the person who enrolled the contact is no longer active, and the contact has no owner.');

    if (step.kind === 'email') {
      const template = step.templateId ? await this.templates.findById(ctx, step.templateId) : undefined;
      if (!template) throw new Error('The email template for this step no longer exists.');
      const fill = (text: string) => text.replace(/\{\{firstName\}\}/g, String(contact.properties.name ?? '').split(' ')[0] ?? '').replace(/\{\{myName\}\}/g, sender.name.split(' ')[0] ?? sender.name);
      // Later emails go out on the thread the first one started, so the contact sees one conversation.
      if (enrollment.conversationId) {
        await this.mail.queue(ctx, { conversationId: enrollment.conversationId, sender, toEmail: String(contact.properties.email ?? ''), subject: fill(template.subject || template.name), body: fill(template.body), purpose: 'automated' });
        return enrollment.conversationId;
      }
      return (await this.mail.compose(ctx, { contact, sender, subject: fill(template.subject || template.name), body: fill(template.body), purpose: 'automated' })).conversationId;
    }

    const tasks = (await this.workspace.definitions(ctx)).find((object) => object.completion);
    if (!tasks?.completion) throw new Error('There is no task object to create a task in.');
    const wanted: Record<string, PropertyValue> = {
      [tasks.primaryProperty]: step.title ?? (step.kind === 'call' ? 'Call' : 'Task'),
      type: step.kind === 'call' ? 'call' : 'todo',
      dueDate: new Date().toISOString().slice(0, 10),
      priority: 'medium',
      [tasks.completion.property]: tasks.completion.open,
      owner: sender.id,
      contact: contact.id,
      company: typeof contact.properties.company === 'string' ? contact.properties.company : null,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    const task = await this.records.insert(ctx, { id: id('tas'), objectId: tasks.id, properties: Object.fromEntries(Object.entries(wanted).filter(([key]) => tasks.properties.some((property) => property.id === key))) });
    await this.recordEvents.created(ctx, task, 'workflow');
    return enrollment.conversationId;
  }
}
