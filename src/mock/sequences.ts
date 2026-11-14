import type { EmailTemplate } from '../contracts/inbox';
import type { CrmRecord, Reference } from '../contracts/records';
import type { Enrollment, Sequence, SequenceStats, SequenceStep, SequencesApi } from '../contracts/sequences';
import { MOCK_NOW } from './definitions';
import { dataset, mulberry32 } from './generate';
import { emailTemplates } from './inbox';

/** Sequences and their enrolments, in memory. Nothing is sent and no time passes: the schedule is shown, not run. */

const DAY = 86_400_000;
const NOW = Date.parse(MOCK_NOW);
const RECENT = 40;

type Stored = { id: string; name: string; status: 'active' | 'paused'; steps: SequenceStep[] };

const sequences: Stored[] = [
  {
    id: 'seq_new_lead',
    name: 'New lead follow-up',
    status: 'active',
    steps: [
      { id: 's1', kind: 'email', waitDays: 0, templateId: 'tpl_intro' },
      { id: 's2', kind: 'call', waitDays: 2, title: 'Call to introduce yourself' },
      { id: 's3', kind: 'email', waitDays: 2, templateId: 'tpl_meeting' },
      { id: 's4', kind: 'email', waitDays: 4, templateId: 'tpl_nudge' },
      { id: 's5', kind: 'task', waitDays: 5, title: 'Decide: keep trying, or mark as unqualified' },
    ],
  },
  {
    id: 'seq_post_demo',
    name: 'After a demo',
    status: 'active',
    steps: [
      { id: 's1', kind: 'email', waitDays: 0, templateId: 'tpl_thanks' },
      { id: 's2', kind: 'email', waitDays: 3, templateId: 'tpl_pricing' },
      { id: 's3', kind: 'call', waitDays: 4, title: 'Call to answer questions' },
    ],
  },
  {
    id: 'seq_renewal',
    name: 'Renewal reminder',
    status: 'active',
    steps: [
      { id: 's1', kind: 'email', waitDays: 0, templateId: 'tpl_meeting' },
      { id: 's2', kind: 'task', waitDays: 7, title: 'Prepare the renewal quote' },
      { id: 's3', kind: 'email', waitDays: 7, templateId: 'tpl_nudge' },
    ],
  },
  {
    id: 'seq_reengage',
    name: 'Re-engage quiet leads',
    status: 'paused',
    steps: [
      { id: 's1', kind: 'email', waitDays: 0, templateId: 'tpl_nudge' },
      { id: 's2', kind: 'email', waitDays: 10, templateId: 'tpl_intro' },
    ],
  },
];

let enrollments: Enrollment[] | undefined;
let counter = 0;

function nextRun(sequence: Stored, stepsDone: number, from: number): string | null {
  const step = sequence.steps[stepsDone];
  return step ? new Date(from + Math.max(step.waitDays, 0) * DAY).toISOString() : null;
}

function allEnrollments(): Enrollment[] {
  if (enrollments) return enrollments;
  const random = mulberry32(9_2026);
  const contacts = dataset().byObject.get('contacts') ?? [];
  const sizes: Record<string, number> = { seq_new_lead: 140, seq_post_demo: 64, seq_renewal: 38, seq_reengage: 52 };
  const built: Enrollment[] = [];
  let offset = 17;
  for (const sequence of sequences) {
    for (let index = 0; index < (sizes[sequence.id] ?? 0); index += 1) {
      // A stride through the contacts gives each sequence a different, stable set.
      const contact = contacts[(offset + index * 331) % contacts.length] as CrmRecord;
      const roll = random();
      const status: Enrollment['status'] = roll < 0.48 ? 'active' : roll < 0.68 ? 'replied' : roll < 0.95 ? 'finished' : 'stopped';
      const stepsDone = status === 'finished' ? sequence.steps.length : 1 + Math.floor(random() * Math.max(1, sequence.steps.length - 1));
      const enrolledAt = NOW - Math.floor(2 + random() * (status === 'active' ? 12 : 70)) * DAY;
      counter += 1;
      built.push({
        id: `enr_${String(counter).padStart(4, '0')}`,
        sequenceId: sequence.id,
        contactId: contact.id,
        status,
        stepsDone,
        enrolledAt: new Date(enrolledAt).toISOString(),
        nextRunAt: status === 'active' && sequence.status === 'active' ? nextRun(sequence, stepsDone, NOW + Math.floor(random() * 3) * DAY) : null,
      });
    }
    offset += 5_003;
  }
  enrollments = built;
  return built;
}

function stats(sequenceId: string): SequenceStats {
  const mine = allEnrollments().filter((enrollment) => enrollment.sequenceId === sequenceId);
  const count = (status: Enrollment['status']) => mine.filter((enrollment) => enrollment.status === status).length;
  return { enrolled: mine.length, active: count('active'), replied: count('replied'), finished: count('finished'), stopped: count('stopped') };
}

function withStats(sequence: Stored): Sequence {
  return { ...sequence, stats: stats(sequence.id) };
}

function find(id: string): Stored {
  const sequence = sequences.find((item) => item.id === id);
  if (!sequence) throw new Error('That sequence no longer exists.');
  return sequence;
}

/** The sequences half of the mock API. `respond` adds latency. */
export function createSequencesApi(respond: <T>(compute: () => T) => Promise<T>): SequencesApi {
  return {
    listSequences: () => respond(() => sequences.map(withStats)),

    getSequence: (id) =>
      respond(() => {
        const sequence = find(id);
        const mine = allEnrollments()
          .filter((enrollment) => enrollment.sequenceId === id)
          .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
        const shown = mine.slice(0, RECENT);
        const references: Record<string, Reference> = {};
        for (const enrollment of shown) {
          const contact = dataset().byId.get(enrollment.contactId);
          if (contact) references[enrollment.contactId] = { objectId: contact.objectId, label: String(contact.properties.name ?? enrollment.contactId) };
        }
        return { sequence: withStats(sequence), enrollments: shown, total: mine.length, references };
      }),

    saveSequence: (input) =>
      respond(() => {
        if (input.steps.length === 0) throw new Error('A sequence needs at least one step.');
        const missing = input.steps.find((step) => (step.kind === 'email' ? !emailTemplates.some((template) => template.id === step.templateId) : !step.title?.trim()));
        if (missing) throw new Error(missing.kind === 'email' ? 'Choose a template for every email step.' : 'Say what each call or task is.');
        if (input.id) {
          const existing = find(input.id);
          existing.name = input.name.trim();
          existing.status = input.status;
          existing.steps = input.steps;
          return withStats(existing);
        }
        counter += 1;
        const created: Stored = { id: `seq_new_${counter}`, name: input.name.trim(), status: input.status, steps: input.steps };
        sequences.push(created);
        return withStats(created);
      }),

    deleteSequence: (id) =>
      respond(() => {
        const index = sequences.findIndex((sequence) => sequence.id === id);
        if (index >= 0) sequences.splice(index, 1);
        enrollments = allEnrollments().filter((enrollment) => enrollment.sequenceId !== id);
      }),

    enrollContacts: (input) =>
      respond(() => {
        const sequence = find(input.sequenceId);
        const result = { enrolled: 0, skipped: [] as Array<{ contactId: string; reason: string }> };
        for (const contactId of input.contactIds) {
          const contact = dataset().byId.get(contactId);
          const name = String(contact?.properties.name ?? 'This contact');
          if (!contact || typeof contact.properties.email !== 'string' || contact.properties.email === '') {
            result.skipped.push({ contactId, reason: `${name} has no email address.` });
            continue;
          }
          if (allEnrollments().some((enrollment) => enrollment.sequenceId === sequence.id && enrollment.contactId === contactId && enrollment.status === 'active')) {
            result.skipped.push({ contactId, reason: `${name} is already in this sequence.` });
            continue;
          }
          counter += 1;
          const now = Date.now();
          allEnrollments().push({ id: `enr_new_${counter}`, sequenceId: sequence.id, contactId, status: 'active', stepsDone: 0, enrolledAt: new Date(now).toISOString(), nextRunAt: sequence.status === 'active' ? nextRun(sequence, 0, now) : null });
          result.enrolled += 1;
        }
        return result;
      }),

    stopEnrollment: (id) =>
      respond(() => {
        const enrollment = allEnrollments().find((item) => item.id === id);
        if (!enrollment) return;
        enrollment.status = 'stopped';
        enrollment.nextRunAt = null;
      }),

    saveEmailTemplate: (input) =>
      respond(() => {
        const fields = { name: input.name.trim(), subject: input.subject.trim(), body: input.body };
        if (!fields.name) throw new Error('Give the template a name.');
        if (input.id) {
          const existing = emailTemplates.find((template) => template.id === input.id);
          if (!existing) throw new Error('That template no longer exists.');
          Object.assign(existing, fields);
          return existing;
        }
        counter += 1;
        const created: EmailTemplate = { id: `tpl_new_${counter}`, ...fields };
        emailTemplates.push(created);
        return created;
      }),

    deleteEmailTemplate: (id) =>
      respond(() => {
        const used = sequences.find((sequence) => sequence.steps.some((step) => step.templateId === id));
        if (used) throw new Error(`"${used.name}" uses this template. Change that step first.`);
        const index = emailTemplates.findIndex((template) => template.id === id);
        if (index >= 0) emailTemplates.splice(index, 1);
      }),
  };
}
