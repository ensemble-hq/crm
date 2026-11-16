import { z } from 'zod';

/**
 * Moving in from another system (today: HubSpot). A move is a **run** made of ordered **steps**.
 * Each step reads one kind of thing from the other system and writes it here, a page at a time, and
 * keeps what it has done so far: how many it read, added, changed and could not bring, where it got
 * to, and anything a person should know. A run can be paused, picked up after a restart, and run
 * again without making anything twice, because every thing brought across is remembered by the id
 * it had in the other system.
 *
 * Steps are data, so the plan can be changed before or while it runs: a step can be skipped, and
 * new steps added for whatever is particular to one account (a custom object, an unusual field, an
 * activity type). The assistant or an agent adds those with `migrations.addStep` after looking at
 * the account with `migrations.peek`.
 */

export const runStatusSchema = z.enum(['draft', 'running', 'paused', 'checked', 'done', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof runStatusSchema>;

/** `check` reads everything and reports what would happen without writing; `import` writes. */
export const runModeSchema = z.enum(['check', 'import']);
export type RunMode = z.infer<typeof runModeSchema>;

export const stepStatusSchema = z.enum(['waiting', 'running', 'done', 'failed', 'skipped']);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const stepCountsSchema = z.object({
  /** Things read from the other system. */
  read: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  /** Left out on purpose, with nothing wrong (archived, already here and unchanged). */
  skipped: z.number().int(),
  /** Could not be brought across. Each has an issue saying why. */
  failed: z.number().int(),
  /** Brought across, with something a person should look at. */
  warnings: z.number().int(),
});
export type StepCounts = z.infer<typeof stepCountsSchema>;

/** One field of the other system and the CRM property it fills. The value is turned into whatever the property holds. */
export const fieldMapSchema = z.object({
  /** The field's internal name in the other system, such as `jobtitle`. */
  from: z.string().min(1),
  /** The CRM property id. */
  to: z.string().min(1),
});
export type FieldMap = z.infer<typeof fieldMapSchema>;

/** An association in the other system and the CRM link property it fills (with the first associated record). */
export const linkMapSchema = z.object({
  /** The associated object type in the other system, such as `companies`. */
  from: z.string().min(1),
  /** The CRM property id of a link to another record. Added to the object if it does not exist yet. */
  to: z.string().min(1),
});
export type LinkMap = z.infer<typeof linkMapSchema>;

/**
 * What a step does. `kind` picks the work, the rest says on what.
 *
 * - `people`: the other system's users. Matched to members here by email; with `add`, the rest are added as invited members.
 * - `stages`: deal pipelines and their stages, as choices of the deal stage.
 * - `fields`: an object's custom fields, as properties on a CRM object, with their choices. Standard fields are mapped to the properties the CRM already has.
 * - `objects`: custom objects. Each becomes an object here, and a `fields` and a `records` step are added for it.
 * - `records`: every record of one object type. `fields` and `links` add to, or override, what the `fields` step and the built-in mapping worked out.
 * - `activities`: notes, calls, emails or meetings, logged on every record they are associated with.
 */
export const stepSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('people'), add: z.boolean() }),
  z.object({ kind: z.literal('stages') }),
  z.object({
    kind: z.literal('fields'),
    /** Object type in the other system: `contacts`, `companies`, `deals`, or a custom object's type id such as `2-12345`. */
    from: z.string().min(1),
    /** CRM object id. */
    to: z.string().min(1),
  }),
  z.object({ kind: z.literal('objects') }),
  z.object({
    kind: z.literal('records'),
    from: z.string().min(1),
    to: z.string().min(1),
    fields: z.array(fieldMapSchema).max(500).optional(),
    links: z.array(linkMapSchema).max(20).optional(),
    /** A CRM property that says a record is already here (email for contacts). A match is filled in, not duplicated. */
    match: z.string().optional(),
    /** For contacts: carry over who has unsubscribed or bounced, in the same write as the contact. */
    emailStatus: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('activities'),
    /** Object type in the other system: `notes`, `calls`, `emails`, `meetings`, or another engagement type. */
    from: z.string().min(1),
    as: z.enum(['note', 'email', 'call', 'meeting']),
    /** Fields holding the title, the text and the time, when they are not the usual ones for the type. */
    titleField: z.string().optional(),
    bodyField: z.string().optional(),
    timeField: z.string().optional(),
  }),
]);
export type StepSpec = z.infer<typeof stepSpecSchema>;
export type StepKind = StepSpec['kind'];

export const migrationIssueSchema = z.object({
  id: z.string(),
  level: z.enum(['note', 'warning', 'problem']),
  /** The id the thing has in the other system, when the issue is about one thing. */
  sourceId: z.string().nullable(),
  message: z.string(),
});
export type MigrationIssue = z.infer<typeof migrationIssueSchema>;

export const migrationStepSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  title: z.string(),
  spec: stepSpecSchema,
  status: stepStatusSchema,
  /** A step that must succeed: it cannot be skipped. */
  required: z.boolean(),
  counts: stepCountsSchema,
  /** One line about how it went. */
  note: z.string().nullable(),
  error: z.string().nullable(),
  /** `plan` for a step the importer planned, `step` for one another step added, otherwise the id of whoever added it. */
  addedBy: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** The first issues the step raised. */
  issues: z.array(migrationIssueSchema),
});
export type MigrationStep = z.infer<typeof migrationStepSchema>;

/** One thing the survey of the other system found that the fixed plan does not bring. */
export const surveyItemSchema = z.object({
  /** What it is, such as `tickets` or `workflows`. */
  area: z.string(),
  label: z.string(),
  /** How many were seen. Null when it could not be read. `more` says there are others beyond these. */
  count: z.number().int().nullable(),
  more: z.boolean(),
  /** A few names, to show what kind of thing they are. */
  examples: z.array(z.string()),
  /** Field names, for things made of records. */
  fields: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type SurveyItem = z.infer<typeof surveyItemSchema>;

const proposalBase = {
  title: z.string().min(1).max(120).describe('A few words naming the thing, as the team would.'),
  why: z.string().min(1).max(600).describe('One or two plain sentences: what in the account calls for this.'),
};

/**
 * What the model puts forward after looking at an account. It never changes the fixed plan for
 * HubSpot's own things; these are additions, and nothing happens until a person accepts one.
 *
 * - `step`: something to bring across that the plan does not cover. Accepting it adds the steps.
 * - `setup`: something this CRM can already do that should be set up to match (a report, a workflow, a view). Accepting it hands `prompt` to the assistant.
 * - `build`: something the account relies on that this CRM does not have. `brief` says what to build and where it should show.
 */
export const proposedSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step'),
    ...proposalBase,
    /** A `records` or `activities` step. For `records`, `to` is an existing object id, or the id the new `object` will get. */
    spec: stepSpecSchema,
    /** A new kind of record to create first, when nothing here fits. */
    object: z.object({ singular: z.string().min(1).max(60), plural: z.string().min(1).max(60) }).optional(),
  }),
  z.object({ kind: z.literal('setup'), ...proposalBase, prompt: z.string().min(1).max(2000).describe('What to ask the assistant to set up, written as the request itself.') }),
  z.object({ kind: z.literal('build'), ...proposalBase, brief: z.string().min(1).max(3000).describe('What to build: what it does, what data it holds or shows, and where in the CRM it belongs.') }),
]);
export type Proposed = z.infer<typeof proposedSchema>;

/** What the model answers with. */
export const assessmentAnswerSchema = z.object({
  summary: z.string().min(1).max(1500).describe('Three or four plain sentences for the person moving in: what stands out about this account beyond the standard things.'),
  proposals: z.array(proposedSchema).max(30),
});
export type AssessmentAnswer = z.infer<typeof assessmentAnswerSchema>;

export const proposalSchema = z.object({ id: z.string(), status: z.enum(['proposed', 'accepted', 'dismissed']), proposal: proposedSchema });
export type Proposal = z.infer<typeof proposalSchema>;

export const assessmentSchema = z.object({
  at: z.string(),
  model: z.string(),
  summary: z.string(),
  found: z.array(surveyItemSchema),
  proposals: z.array(proposalSchema),
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const decideProposalSchema = z.object({ runId: z.string(), proposalId: z.string(), accept: z.boolean() });
export type DecideProposal = z.infer<typeof decideProposalSchema>;

export const migrationRunSchema = z.object({
  id: z.string(),
  source: z.literal('hubspot'),
  status: runStatusSchema,
  mode: runModeSchema,
  /** Whether a key for the other system is stored. The key itself is never returned. */
  hasKey: z.boolean(),
  error: z.string().nullable(),
  startedBy: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  steps: z.array(migrationStepSchema),
  /** What the connected model made of the account, when it has been asked. */
  assessment: assessmentSchema.nullable(),
});
export type MigrationRun = z.infer<typeof migrationRunSchema>;

export const createMigrationSchema = z.object({
  source: z.literal('hubspot'),
  /** A HubSpot private app access token. Stored encrypted, and forgotten when the import finishes. */
  key: z.string().min(8).max(500),
  /** Add HubSpot users who are not members here as invited members. Otherwise their records come across with no owner. */
  addPeople: z.boolean(),
});
export type CreateMigration = z.infer<typeof createMigrationSchema>;

export const startMigrationSchema = z.object({ runId: z.string(), mode: runModeSchema });
export type StartMigration = z.infer<typeof startMigrationSchema>;

export const addStepSchema = z.object({
  runId: z.string(),
  /** Shown in the plan. */
  title: z.string().min(1).max(120),
  spec: stepSpecSchema,
  /** The step this one comes after. Left out, it goes last. */
  afterStepId: z.string().optional(),
});
export type AddStep = z.infer<typeof addStepSchema>;

export const changeStepSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  /** `skip` leaves a step out, `restore` puts it back, `retry` runs a failed step again from where it stopped, `remove` takes out a step that has not run. */
  action: z.enum(['skip', 'restore', 'retry', 'remove']),
});
export type ChangeStep = z.infer<typeof changeStepSchema>;

export const peekSchema = z.object({
  runId: z.string(),
  /** A path of HubSpot's API to read, such as `/crm/v3/schemas` or `/crm/v3/properties/contacts`. Reading only. */
  path: z.string().regex(/^\/[a-zA-Z0-9/_\-.]+$/, 'A path starts with / and has no query.'),
  query: z.record(z.string()).optional(),
});
export type Peek = z.infer<typeof peekSchema>;

export interface MigrationApi {
  /** Every move into this CRM, newest first. */
  listMigrations(): Promise<MigrationRun[]>;
  getMigration(runId: string): Promise<MigrationRun>;
  /** Plans a move: stores the key and lays out the steps. Nothing is read or written until it is started. */
  createMigration(input: CreateMigration): Promise<MigrationRun>;
  /** Starts or resumes a run, as a check or for real. */
  startMigration(input: StartMigration): Promise<MigrationRun>;
  pauseMigration(runId: string): Promise<MigrationRun>;
  cancelMigration(runId: string): Promise<MigrationRun>;
  addMigrationStep(input: AddStep): Promise<MigrationRun>;
  changeMigrationStep(input: ChangeStep): Promise<MigrationRun>;
  /** Has the connected model look at the account and put forward what the fixed plan does not cover. */
  assessMigration(runId: string): Promise<MigrationRun>;
  /** Accepts or dismisses one thing the model put forward. */
  decideMigrationProposal(input: DecideProposal): Promise<MigrationRun>;
  /** Reads from the other system, to see what an account has before adding steps for it. */
  peekMigrationSource(input: Peek): Promise<unknown>;
}
