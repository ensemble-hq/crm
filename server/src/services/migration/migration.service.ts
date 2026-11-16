import { ConflictError, type Context, NotFoundError, ValidationError } from '@mariachi/core';
import type { Encryption } from '@mariachi/encryption';
import type { AddStep, AssessmentAnswer, ChangeStep, CreateMigration, DecideProposal, MigrationIssue, MigrationRun, Peek, RunMode, RunStatus, StartMigration, StepSpec, SurveyItem } from '../../../../src/contracts/migration';
import { surveyHubSpot } from './hubspot/survey';
import type { MigrationRunRow, MigrationStepRow } from '../../schema';
import { actingContext, actorOf, assertAllowed } from '../people/access';
import type { PeopleService } from '../people/people.service';
import { type MigrationSource, explain } from './source';
import { type Crm, type IssuesRepository, type Links, type NewStep, type Registry, type RunsRepository, type StepIO, type StepsRepository, id, noCounts } from './steps';

/**
 * Moves an account in from another system, one stored step at a time. This class is the engine and
 * the operations around it; what each kind of step does lives in the registry it is given.
 *
 * The worker calls `advance` over and over. Each call takes a run that is under way, carries it
 * for a while, and lets go. Progress is saved after every page, in the same transaction as what
 * the page wrote, so stopping the worker at any moment loses nothing and repeats nothing.
 */

const AAD = { aad: 'migration:key' };
/** A run in one of these has been neither finished nor abandoned. */
const OPEN: RunStatus[] = ['draft', 'running', 'paused', 'checked', 'failed'];
/** How many issues are kept for one step. Beyond this they are counted, not stored. */
const ISSUES_KEPT = 200;
const ISSUES_SHOWN = 50;

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

/** The plan for a HubSpot account before anything is known about it. The custom objects step adds to it. */
function hubspotPlan(addPeople: boolean): NewStep[] {
  return [
    { title: 'People', spec: { kind: 'people', add: addPeople } },
    { title: 'Deal stages', spec: { kind: 'stages' } },
    { title: 'Company fields', spec: { kind: 'fields', from: 'companies', to: 'companies' } },
    { title: 'Contact fields', spec: { kind: 'fields', from: 'contacts', to: 'contacts' } },
    { title: 'Deal fields', spec: { kind: 'fields', from: 'deals', to: 'deals' } },
    { title: 'Companies', spec: { kind: 'records', from: 'companies', to: 'companies', match: 'domain' } },
    // Who has unsubscribed comes across in the same write as the contact, so this step cannot be left out.
    { title: 'Contacts', spec: { kind: 'records', from: 'contacts', to: 'contacts', match: 'email', emailStatus: true, links: [{ from: 'companies', to: 'company' }] }, required: true },
    { title: 'Deals', spec: { kind: 'records', from: 'deals', to: 'deals', links: [{ from: 'companies', to: 'company' }, { from: 'contacts', to: 'contact' }] } },
    { title: 'Tasks', spec: { kind: 'records', from: 'tasks', to: 'tasks', links: [{ from: 'contacts', to: 'contact' }, { from: 'companies', to: 'company' }, { from: 'deals', to: 'deal' }] } },
    { title: 'Custom objects', spec: { kind: 'objects' } },
    { title: 'Notes', spec: { kind: 'activities', from: 'notes', as: 'note' } },
    { title: 'Calls', spec: { kind: 'activities', from: 'calls', as: 'call' } },
    { title: 'Emails', spec: { kind: 'activities', from: 'emails', as: 'email' } },
    { title: 'Meetings', spec: { kind: 'activities', from: 'meetings', as: 'meeting' } },
  ];
}

export class MigrationService {
  constructor(
    private readonly runs: RunsRepository,
    private readonly steps: StepsRepository,
    private readonly issues: IssuesRepository,
    private readonly links: Links,
    private readonly crm: Crm,
    private readonly people: PeopleService,
    private readonly encryption: Encryption,
    private readonly transaction: <T>(ctx: Context, fn: () => Promise<T>) => Promise<T>,
    private readonly sourceFor: (key: string) => MigrationSource,
    private readonly registry: Registry,
  ) {}

  // What people and agents call

  async list(ctx: Context): Promise<MigrationRun[]> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'see moves from other systems');
    const rows = await this.runs.findMany(ctx, {}, { sort: { field: 'createdAt', direction: 'desc' }, limit: 50 });
    return Promise.all(rows.map((row) => this.describe(ctx, row)));
  }

  async get(ctx: Context, runId: string): Promise<MigrationRun> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'see moves from other systems');
    return this.describe(ctx, await this.run(ctx, runId));
  }

  async create(ctx: Context, input: CreateMigration): Promise<MigrationRun> {
    const actor = actorOf(ctx);
    assertAllowed(actor, 'manageSettings', 'move data in from another system');
    const open = (await this.runs.findMany(ctx, {}, { limit: 200 })).find((row) => OPEN.includes(row.status as RunStatus));
    if (open) throw new ConflictError('A move from HubSpot is already planned or under way. Finish or cancel it before planning another.');
    const keyEncrypted = await this.encryption.encrypt(input.key.trim(), AAD);
    const run = await this.transaction(ctx, async () => {
      const created = await this.runs.create(ctx, { id: id('mig'), source: input.source, status: 'draft', mode: 'check', keyEncrypted, startedBy: actor.userId });
      await this.insertSteps(ctx, created.id, -1, hubspotPlan(input.addPeople), 'plan');
      return created;
    });
    return this.describe(ctx, run);
  }

  async start(ctx: Context, input: StartMigration): Promise<MigrationRun> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'move data in from another system');
    const run = await this.run(ctx, input.runId);
    if (run.status === 'cancelled') throw new ConflictError('This move was cancelled. Plan a new one.');
    if (run.status === 'done') throw new ConflictError('This move is finished. Plan a new one to bring across what has changed since.');
    if (run.status === 'running') return this.describe(ctx, run);
    if (!run.keyEncrypted) throw new ValidationError('The key for HubSpot is no longer stored. Plan a new move and enter it again.');
    await this.transaction(ctx, async () => {
      // A check that has finished, or a change from checking to importing, starts every step from the beginning.
      if (run.status === 'checked' || (run.status !== 'draft' && run.mode !== input.mode)) await this.reset(ctx, run.id);
      else for (const step of await this.steps.ofRun(ctx, run.id)) if (step.status === 'failed') await this.steps.update(ctx, step.id, { status: 'waiting', error: null });
      await this.runs.update(ctx, run.id, { status: 'running', mode: input.mode, error: null, startedAt: run.startedAt ?? new Date(), finishedAt: null });
    });
    return this.get(ctx, run.id);
  }

  async pause(ctx: Context, runId: string): Promise<MigrationRun> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'pause a move');
    const run = await this.run(ctx, runId);
    if (run.status === 'running') await this.runs.update(ctx, run.id, { status: 'paused' });
    return this.get(ctx, runId);
  }

  async cancel(ctx: Context, runId: string): Promise<MigrationRun> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'cancel a move');
    const run = await this.run(ctx, runId);
    if (OPEN.includes(run.status as RunStatus)) await this.runs.update(ctx, run.id, { status: 'cancelled', keyEncrypted: null, finishedAt: new Date() });
    return this.get(ctx, runId);
  }

  async addStep(ctx: Context, input: AddStep): Promise<MigrationRun> {
    const actor = actorOf(ctx);
    assertAllowed(actor, 'manageSettings', 'change the plan of a move');
    const run = await this.run(ctx, input.runId);
    if (!OPEN.includes(run.status as RunStatus)) throw new ConflictError('This move is over. Plan a new one to add steps.');
    await this.checkSpec(ctx, input.spec);
    const steps = await this.steps.ofRun(ctx, run.id);
    const after = input.afterStepId ? steps.find((step) => step.id === input.afterStepId) : steps.at(-1);
    if (input.afterStepId && !after) throw new NotFoundError('step', input.afterStepId);
    await this.transaction(ctx, () => this.insertSteps(ctx, run.id, after?.position ?? -1, [{ title: input.title.trim(), spec: input.spec }], actor.userId));
    return this.get(ctx, run.id);
  }

  async changeStep(ctx: Context, input: ChangeStep): Promise<MigrationRun> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'change the plan of a move');
    const run = await this.run(ctx, input.runId);
    if (!OPEN.includes(run.status as RunStatus)) throw new ConflictError('This move is over, so its steps can no longer be changed.');
    const step = (await this.steps.ofRun(ctx, run.id)).find((item) => item.id === input.stepId);
    if (!step) throw new NotFoundError('step', input.stepId);
    // A run stopped by a failed step carries on once that step is dealt with.
    const resume = async () => void (run.status === 'failed' && (await this.runs.update(ctx, run.id, { status: 'running', error: null })));
    await this.transaction(ctx, async () => {
      if (input.action === 'retry') {
        if (step.status !== 'failed') throw new ConflictError('Only a step that failed can be tried again.');
        await this.steps.update(ctx, step.id, { status: 'waiting', error: null });
        await resume();
      } else if (input.action === 'skip') {
        if (step.required) throw new ConflictError(`"${step.title}" must run: it carries across who has asked not to be emailed.`);
        if (step.status !== 'waiting' && step.status !== 'failed') throw new ConflictError('Only a step that has not finished can be skipped.');
        const failed = step.status === 'failed';
        await this.steps.update(ctx, step.id, { status: 'skipped', error: null });
        if (failed) await resume();
      } else if (input.action === 'restore') {
        if (step.status !== 'skipped') throw new ConflictError('Only a skipped step can be put back.');
        await this.steps.update(ctx, step.id, { status: 'waiting' });
      } else {
        if (step.required) throw new ConflictError(`"${step.title}" must run, so it cannot be removed.`);
        if (step.status !== 'waiting' && step.status !== 'skipped') throw new ConflictError('A step that has started cannot be removed. Skip it instead.');
        await this.steps.hardDelete(ctx, step.id);
        await this.steps.shift(ctx, run.id, step.position, -1);
      }
    });
    return this.get(ctx, run.id);
  }

  /** Reads from the other system, so whoever is shaping the plan can see what the account has. */
  async peek(ctx: Context, input: Peek): Promise<unknown> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'look at the account being moved');
    const run = await this.run(ctx, input.runId);
    if (!run.keyEncrypted) throw new ValidationError('The key for HubSpot is no longer stored.');
    try {
      return await this.sourceFor(await this.encryption.decrypt(run.keyEncrypted, AAD)).get(input.path, input.query);
    } catch (error) {
      throw new ValidationError(explain(error));
    }
  }

  // The layer on top: what a connected model makes of the account

  /** Reads what the account has beyond what the plan brings. */
  async survey(ctx: Context, runId: string): Promise<SurveyItem[]> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'look at the account being moved');
    const run = await this.run(ctx, runId);
    if (!OPEN.includes(run.status as RunStatus)) throw new ConflictError('This move is over. Plan a new one to have the account looked at.');
    if (!run.keyEncrypted) throw new ValidationError('The key for HubSpot is no longer stored.');
    try {
      return await surveyHubSpot(this.sourceFor(await this.encryption.decrypt(run.keyEncrypted, AAD)));
    } catch (error) {
      throw new ValidationError(explain(error));
    }
  }

  /** Keeps what the model put forward. Asking again replaces what was not yet decided and keeps what was. */
  async keepAssessment(ctx: Context, runId: string, found: SurveyItem[], answer: AssessmentAnswer, model: string): Promise<MigrationRun> {
    const run = await this.run(ctx, runId);
    const decided = (run.assessment?.proposals ?? []).filter((item) => item.status !== 'proposed');
    const fresh = answer.proposals.filter((proposal) => !decided.some((item) => item.proposal.kind === proposal.kind && item.proposal.title.toLowerCase() === proposal.title.toLowerCase()));
    await this.runs.update(ctx, run.id, { assessment: { at: new Date().toISOString(), model, summary: answer.summary, found, proposals: [...decided, ...fresh.map((proposal) => ({ id: id('prp'), status: 'proposed' as const, proposal }))] } });
    return this.get(ctx, run.id);
  }

  async decide(ctx: Context, input: DecideProposal): Promise<MigrationRun> {
    const actor = actorOf(ctx);
    assertAllowed(actor, 'manageSettings', 'change the plan of a move');
    const run = await this.run(ctx, input.runId);
    const assessment = run.assessment;
    const entry = assessment?.proposals.find((item) => item.id === input.proposalId);
    if (!assessment || !entry) throw new NotFoundError('proposal', input.proposalId);
    if (entry.status === 'accepted') throw new ConflictError('That was already accepted.');
    // Steps can only join a move that is still open. What to set up or build can be decided at any time.
    if (input.accept && entry.proposal.kind === 'step' && !OPEN.includes(run.status as RunStatus)) throw new ConflictError('This move is over, so no more steps can be added to it. Plan another move to bring this across.');
    await this.transaction(ctx, async () => {
      const { proposal } = entry;
      if (input.accept && proposal.kind === 'step') {
        const steps: NewStep[] = [];
        const wanted = proposal.spec;
        if (wanted.kind === 'records') {
          const objects = await this.crm.workspace.definitions(ctx);
          let object = objects.find((item) => item.id === wanted.to);
          if (!object && proposal.object) object = await this.crm.settings.createObject(ctx, { ...proposal.object, icon: 'box' });
          if (!object) throw new ValidationError(`There is no object "${wanted.to}" to bring these into.`);
          const spec = { ...wanted, to: object.id };
          await this.checkSpec(ctx, spec);
          // Their custom fields first, then the records.
          steps.push({ title: `${object.singular} fields`, spec: { kind: 'fields', from: spec.from, to: object.id } }, { title: proposal.title, spec });
        } else steps.push({ title: proposal.title, spec: proposal.spec });
        const last = (await this.steps.ofRun(ctx, run.id)).at(-1);
        await this.insertSteps(ctx, run.id, last?.position ?? -1, steps, actor.userId);
      }
      await this.runs.update(ctx, run.id, { assessment: { ...assessment, proposals: assessment.proposals.map((item) => (item.id === entry.id ? { ...item, status: input.accept ? ('accepted' as const) : ('dismissed' as const) } : item)) } });
    });
    return this.get(ctx, run.id);
  }

  // What the worker calls

  /**
   * Carries one run that is under way: page after page, step after step, until it finishes, stops,
   * or `ms` (or `pages`) is used up. Returns false when there was no run to carry.
   */
  async advance(ctx: Context, options: { ms?: number; pages?: number } = {}): Promise<boolean> {
    const run = await this.runs.claim(ctx, 120);
    if (!run) return false;
    const deadline = Date.now() + (options.ms ?? 20_000);
    let pages = options.pages ?? Number.POSITIVE_INFINITY;
    try {
      // Steps run as the person who started the run: what they may not do, the import may not do.
      const acting = actingContext(ctx, await this.people.actor({ ...ctx, userId: run.startedBy, identityType: 'session' }));
      if (!run.keyEncrypted) throw new Error('The key for HubSpot is no longer stored.');
      const source = this.sourceFor(await this.encryption.decrypt(run.keyEncrypted, AAD));
      while (pages > 0 && Date.now() < deadline) {
        pages -= 1;
        if ((await this.runs.findById(ctx, run.id))?.status !== 'running') break;
        const step = (await this.steps.ofRun(ctx, run.id)).find((item) => item.status === 'waiting' || item.status === 'running');
        if (!step) {
          // An import that is finished has no more use for the key. A check keeps it for the import that follows.
          const dry = run.mode === 'check';
          await this.runs.update(ctx, run.id, { status: dry ? 'checked' : 'done', finishedAt: new Date(), ...(dry ? {} : { keyEncrypted: null }) });
          break;
        }
        if (!(await this.page(acting, run, step, source))) break;
      }
    } catch (error) {
      await this.runs.update(ctx, run.id, { status: 'failed', error: explain(error) });
    } finally {
      await this.runs.release(ctx, run.id);
    }
    return true;
  }

  /** One page of one step. False when the step failed, which stops the run. */
  private async page(ctx: Context, run: MigrationRunRow, step: MigrationStepRow, source: MigrationSource): Promise<boolean> {
    const dry = run.mode === 'check';
    const counts = { ...noCounts(), ...step.counts };
    const raised: Array<Omit<MigrationIssue, 'id'>> = [];
    const io: StepIO = {
      ctx,
      source,
      dry,
      counts,
      issue: (level, message, sourceId) => {
        raised.push({ level, message, sourceId: sourceId ?? null });
        if (level === 'warning') counts.warnings += 1;
      },
      links: this.links,
      crm: this.crm,
    };
    try {
      if (step.status === 'waiting') await this.steps.update(ctx, step.id, { status: 'running', startedAt: step.startedAt ?? new Date() });
      const handler = this.registry[step.spec.kind];
      const result = await handler.page(io, step.spec as never, step.cursor ?? null);
      await this.transaction(ctx, async () => {
        if (!dry) await result.write?.();
        const room = ISSUES_KEPT - (raised.length > 0 ? await this.issues.count(ctx, { stepId: step.id }) : 0);
        for (const issue of raised.slice(0, Math.max(room, 0))) await this.issues.create(ctx, { id: id('iss'), runId: run.id, stepId: step.id, ...issue });
        if (result.steps?.length) await this.insertSteps(ctx, run.id, step.position, result.steps, 'step');
        const finished = result.next === null;
        await this.steps.update(ctx, step.id, { cursor: result.next, counts, status: finished ? 'done' : 'running', ...(result.note ? { note: result.note } : {}), ...(finished ? { finishedAt: new Date() } : {}) });
      });
      return true;
    } catch (error) {
      const message = explain(error);
      await this.steps.update(ctx, step.id, { status: 'failed', error: message });
      await this.runs.update(ctx, run.id, { status: 'failed', error: `"${step.title}" stopped: ${message}` });
      return false;
    }
  }

  // Helpers

  private async run(ctx: Context, runId: string): Promise<MigrationRunRow> {
    const run = await this.runs.findById(ctx, runId);
    if (!run) throw new NotFoundError('migration', runId);
    return run;
  }

  /** Adds steps after a position, moving later ones down. */
  private async insertSteps(ctx: Context, runId: string, after: number, steps: NewStep[], addedBy: string): Promise<void> {
    await this.steps.shift(ctx, runId, after, steps.length);
    for (const [index, step] of steps.entries()) await this.steps.create(ctx, { id: id('stp'), runId, position: after + 1 + index, title: step.title, spec: step.spec, status: 'waiting', required: step.required ?? false, counts: noCounts(), addedBy });
  }

  /** Puts every step back to the beginning. Steps that other steps added go; they will be added again. */
  private async reset(ctx: Context, runId: string): Promise<void> {
    await this.issues.clear(ctx, runId);
    let position = 0;
    for (const step of await this.steps.ofRun(ctx, runId)) {
      if (step.addedBy === 'step') await this.steps.hardDelete(ctx, step.id);
      else await this.steps.update(ctx, step.id, { position: position++, status: step.status === 'skipped' ? 'skipped' : 'waiting', cursor: null, counts: noCounts(), note: null, error: null, startedAt: null, finishedAt: null });
    }
  }

  /** A step someone adds has to point at things that exist. */
  private async checkSpec(ctx: Context, spec: StepSpec): Promise<void> {
    if (spec.kind !== 'records' && spec.kind !== 'fields') return;
    const object = (await this.crm.workspace.definitions(ctx)).find((item) => item.id === spec.to);
    if (!object) throw new ValidationError(`There is no object "${spec.to}" in this CRM. Create it first (objects.create), then add the step.`);
    if (spec.kind !== 'records') return;
    for (const field of spec.fields ?? []) if (!object.properties.some((property) => property.id === field.to)) throw new ValidationError(`${object.plural} have no property "${field.to}". Add it first (properties.create), or leave the field to a "fields" step.`);
    if (spec.match && !object.properties.some((property) => property.id === spec.match)) throw new ValidationError(`${object.plural} have no property "${spec.match}" to match on.`);
  }

  private async describe(ctx: Context, run: MigrationRunRow): Promise<MigrationRun> {
    const steps = await this.steps.ofRun(ctx, run.id);
    const issues = await this.issues.findMany(ctx, { runId: run.id }, { sort: { field: 'createdAt', direction: 'asc' }, limit: 5000 });
    return {
      id: run.id,
      source: 'hubspot',
      status: run.status as RunStatus,
      mode: run.mode as RunMode,
      hasKey: Boolean(run.keyEncrypted),
      error: run.error,
      startedBy: run.startedBy,
      createdAt: new Date(run.createdAt).toISOString(),
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
      assessment: run.assessment ?? null,
      steps: steps.map((step) => ({
        id: step.id,
        position: step.position,
        title: step.title,
        spec: step.spec,
        status: step.status as MigrationRun['steps'][number]['status'],
        required: step.required,
        counts: { ...noCounts(), ...step.counts },
        note: step.note,
        error: step.error,
        addedBy: step.addedBy,
        startedAt: iso(step.startedAt),
        finishedAt: iso(step.finishedAt),
        issues: issues.filter((issue) => issue.stepId === step.id).slice(0, ISSUES_SHOWN).map((issue) => ({ id: issue.id, level: issue.level as MigrationIssue['level'], sourceId: issue.sourceId, message: issue.message })),
      })),
    };
  }
}
