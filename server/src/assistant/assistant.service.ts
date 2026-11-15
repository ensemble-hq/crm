import type { AIAdapter, AIMessage } from '@mariachi/ai';
import { ConflictError, type Context, ValidationError } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import type { Encryption } from '@mariachi/encryption';
import { z } from 'zod';
import type { AssistantEvent, AssistantReply, AssistantSettings, AssistantTurn, AssistantUsage, SaveAssistantSettings } from '../../../src/contracts/assistant';
import type { DesignReply, DesignRequest } from '../../../src/contracts/emailDesign';
import type { ObjectDefinition } from '../../../src/contracts/metadata';
import { designEmail } from './email-designer';
import type { Operation } from '../../../src/contracts/operations';
import type { ListResult, RecordDetail, Workspace } from '../../../src/contracts/records';
import { and, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AssistantSettingsRow, type AssistantTurnRow, assistantSettingsTable, assistantTurnsTable } from '../schema';
import { actorOf, assertAllowed } from '../services/people/access';
import { modelProvider, modelProviders } from './providers';

/**
 * The assistant: a model given the CRM's operations as tools, acting as the person who asked.
 *
 * - It reads freely: anything the person could look up, it can look up, with their access.
 * - It never writes by itself. When it calls an operation that changes, deletes or sends, the call
 *   is not carried out; it becomes a step in a plan. The person sees the plan and approves it, and
 *   their own browser then runs each step as them. So nothing changes that they did not agree to.
 * - It shows its work beside the conversation (a chart, a list of records, a draft email).
 */

const SETTINGS_ID = 'assistant';
/** How many times the model may go back and forth with its tools in one turn. */
const MAX_ROUNDS = 8;
/** A tool result longer than this is cut, and the model is told so, so one large list cannot fill its context. */
const MAX_RESULT_CHARS = 14_000;

export class AssistantSettingsRepository extends DrizzleRepository<AssistantSettingsRow> {
  constructor(db: DrizzleDb) {
    super(assistantSettingsTable, db);
  }
}

export class AssistantTurnsRepository extends DrizzleRepository<AssistantTurnRow> {
  constructor(db: DrizzleDb) {
    super(assistantTurnsTable, db);
  }

  async totals(ctx: Context, since: Date, userId: string | undefined): Promise<Array<{ userId: string; turns: number; inputTokens: number; outputTokens: number; failed: number }>> {
    const who = userId ? sql`assistant_turns.user_id = ${userId}` : sql`true`;
    return (await this.db.execute(sql`
      select user_id as "userId", count(*)::int as turns, coalesce(sum(input_tokens), 0)::int as "inputTokens", coalesce(sum(output_tokens), 0)::int as "outputTokens", count(*) filter (where error is not null)::int as failed
      from assistant_turns where ${and(this.buildWhere(ctx), sql`assistant_turns.created_at >= ${since.toISOString()}::timestamptz`, who)} group by user_id order by 2 desc`)) as unknown as Array<{ userId: string; turns: number; inputTokens: number; outputTokens: number; failed: number }>;
  }
}

/** Sends one event of a turn to the browser that asked, as it happens. */
export type Push = (ctx: Context, userId: string, data: unknown) => Promise<void>;

type Call = (ctx: Context, operation: string, input: unknown) => Promise<unknown>;
type Tool = { name: string; description: string; schema: z.ZodTypeAny; handler: (input: unknown) => Promise<unknown> };
const never = async () => undefined;

const toolName = (operation: string) => operation.replace(/\./g, '_');

/** The objects and their fields, compactly, so the model knows the ids every operation takes without a first lookup. */
function describeShape(objects: ObjectDefinition[]): string {
  return objects
    .map((object) => {
      const fields = object.properties.map((property) => {
        const options = property.options?.length ? ` [${property.options.map((option) => option.id).join('|')}]` : '';
        const target = property.referenceObjectId ? ` -> ${property.referenceObjectId}` : '';
        return `${property.id}:${property.type}${target}${options}`;
      });
      return `- ${object.id} (${object.singular}; name field "${object.primaryProperty}"; views: ${object.views.map((view) => view.id).join(', ')})\n  ${fields.join(', ')}`;
    })
    .join('\n');
}

export class AssistantService {
  constructor(
    private readonly settings: AssistantSettingsRepository,
    private readonly encryption: Encryption,
    private readonly operations: Operation[],
    private readonly call: Call,
    private readonly turns: AssistantTurnsRepository,
    private readonly push?: Push,
  ) {}

  private describe(row: AssistantSettingsRow | null): AssistantSettings {
    return { configured: row !== null, provider: row?.provider ?? null, model: row?.model ?? null, baseUrl: row?.baseUrl ?? null, hasKey: Boolean(row?.apiKeyEncrypted), providers: modelProviders() };
  }

  async getSettings(ctx: Context): Promise<AssistantSettings> {
    return this.describe(await this.settings.findById(ctx, SETTINGS_ID));
  }

  /** Connects, changes or disconnects the model. The key is stored encrypted; leaving it out keeps the one already stored. */
  async saveSettings(ctx: Context, input: SaveAssistantSettings): Promise<AssistantSettings> {
    assertAllowed(actorOf(ctx), 'manageSettings', "change the assistant's model");
    const existing = await this.settings.findById(ctx, SETTINGS_ID);
    if (input.provider === null) {
      if (existing) await this.settings.hardDelete(ctx, SETTINGS_ID);
      return this.describe(null);
    }
    const provider = modelProvider(input.provider);
    const model = input.model?.trim() || provider.defaultModel;
    if (!model) throw new ValidationError('Say which model to use.');
    const baseUrl = provider.needsBaseUrl ? input.baseUrl?.trim() : undefined;
    if (provider.needsBaseUrl && !/^https?:\/\//.test(baseUrl ?? '')) throw new ValidationError('Give the address of your endpoint, starting with https://.');
    // A key belongs to one provider: changing provider without a new key drops the old one.
    const kept = existing?.provider === provider.id ? existing.apiKeyEncrypted : null;
    const apiKeyEncrypted = input.apiKey?.trim() ? await this.encryption.encrypt(input.apiKey.trim(), { aad: 'assistant:apiKey' }) : kept;
    if (provider.needsKey && !apiKeyEncrypted) throw new ValidationError(`${provider.label} needs an API key.`);
    const values = { provider: provider.id, model, baseUrl: baseUrl ?? null, apiKeyEncrypted };
    return this.describe(existing ? await this.settings.update(ctx, SETTINGS_ID, values) : await this.settings.create(ctx, { id: SETTINGS_ID, ...values }));
  }

  private async adapter(ctx: Context): Promise<{ adapter: AIAdapter; model: string; provider: string }> {
    const row = await this.settings.findById(ctx, SETTINGS_ID);
    if (!row) throw new ConflictError('No model is connected to the assistant yet. An admin can connect one in Settings.');
    const apiKey = row.apiKeyEncrypted ? await this.encryption.decrypt(row.apiKeyEncrypted, { aad: 'assistant:apiKey' }) : undefined;
    return { adapter: modelProvider(row.provider).create({ model: row.model, apiKey, baseUrl: row.baseUrl ?? undefined }), model: row.model, provider: row.provider };
  }

  /** One turn: runs it, sends each event to the asker as it happens when they gave the turn a name, and records what it used whether it worked or not. */
  async turn(ctx: Context, input: AssistantTurn): Promise<AssistantReply> {
    const started = Date.now();
    const asker = actorOf(ctx).signedInId;
    const question = [...input.messages].reverse().find((message) => message.role === 'user')?.text ?? '';
    const used = { provider: '', model: '', inputTokens: 0, outputTokens: 0, rounds: 0 };
    const events: AssistantEvent[] = [];
    let sent = 0;
    // Events reach the browser in order; a push that fails is skipped, because the full answer follows in the reply anyway.
    const flush = async () => {
      if (!input.turnId || !this.push) return;
      for (; sent < events.length; sent += 1) await this.push(ctx, asker, { topic: 'assistant', turnId: input.turnId, index: sent, event: events[sent] }).catch(() => undefined);
    };
    let failure: string | undefined;
    try {
      return await this.run(ctx, input, events, used, flush);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await this.turns
        .create(ctx, {
          id: `turn_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          userId: ctx.userId ?? asker,
          question: question.slice(0, 500),
          provider: used.provider,
          model: used.model,
          inputTokens: used.inputTokens,
          outputTokens: used.outputTokens,
          rounds: used.rounds,
          lookups: events.filter((event) => event.type === 'tool').length,
          plannedSteps: events.reduce((count, event) => count + (event.type === 'plan' ? event.steps.length : 0), 0),
          durationMs: Date.now() - started,
          error: failure ?? null,
        })
        .catch((error: unknown) => ctx.logger.error({ error }, 'An assistant turn could not be recorded'));
    }
  }

  /** Designs an email on the connected model, or changes one. Counted with the assistant's use. */
  async designEmail(ctx: Context, input: DesignRequest): Promise<DesignReply> {
    const started = Date.now();
    const used = { provider: '', model: '', inputTokens: 0, outputTokens: 0, rounds: 0 };
    let failure: string | undefined;
    try {
      const { adapter, model, provider } = await this.adapter(ctx);
      Object.assign(used, { provider, model });
      const workspace = (await this.call(ctx, 'workspace.get', undefined)) as Workspace;
      const me = workspace.users.find((user) => user.id === workspace.currentUserId);
      const result = await designEmail({ adapter, model }, input, { organization: workspace.name, sender: me?.name ?? 'a member of the team' }).catch((error: unknown) => {
        throw error instanceof ValidationError || error instanceof ConflictError ? error : new ConflictError(`The model could not be reached: ${error instanceof Error ? error.message : String(error)}`);
      });
      Object.assign(used, { inputTokens: result.inputTokens, outputTokens: result.outputTokens, rounds: result.rounds });
      return result.reply;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await this.turns
        .create(ctx, { id: `turn_${randomUUID().replace(/-/g, '').slice(0, 12)}`, userId: ctx.userId ?? actorOf(ctx).signedInId, question: `Design an email: ${input.prompt}`.slice(0, 500), ...used, lookups: 0, plannedSteps: 0, durationMs: Date.now() - started, error: failure ?? null })
        .catch((error: unknown) => ctx.logger.error({ error }, 'An email design could not be recorded'));
    }
  }

  async usage(ctx: Context): Promise<AssistantUsage> {
    const actor = actorOf(ctx);
    // People who run the workspace see everyone's use; anyone else sees their own.
    const only = actor.role.manageSettings ? undefined : actor.userId;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [totals, recent] = await Promise.all([this.turns.totals(ctx, since, only), this.turns.findMany(ctx, only ? { userId: only } : {}, { sort: { field: 'createdAt', direction: 'desc' }, limit: 20 })]);
    const sum = (key: 'turns' | 'inputTokens' | 'outputTokens' | 'failed') => totals.reduce((total, row) => total + row[key], 0);
    return {
      from: since.toISOString().slice(0, 10),
      turns: sum('turns'),
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      failed: sum('failed'),
      byPerson: totals.map((row) => ({ userId: row.userId, turns: row.turns, tokens: row.inputTokens + row.outputTokens })),
      recent: recent.map((row) => ({ id: row.id, userId: row.userId, question: row.question, model: row.model, tokens: row.inputTokens + row.outputTokens, lookups: row.lookups, plannedSteps: row.plannedSteps, seconds: Math.round(row.durationMs / 100) / 10, failed: row.error !== null, at: row.createdAt.toISOString() })),
    };
  }

  private async run(ctx: Context, input: AssistantTurn, events: AssistantEvent[], used: { provider: string; model: string; inputTokens: number; outputTokens: number; rounds: number }, flush: () => Promise<void>): Promise<AssistantReply> {
    const { adapter, model, provider } = await this.adapter(ctx);
    used.provider = provider;
    used.model = model;
    const workspace = (await this.call(ctx, 'workspace.get', undefined)) as Workspace;
    const me = workspace.users.find((user) => user.id === workspace.currentUserId);
    const steps: Array<{ label: string; operation: string; input: unknown }> = [];

    // Every operation is a tool, apart from the assistant's own and the ones a public page calls.
    const offered = this.operations.filter((operation) => !operation.internal && !operation.public);
    const byTool = new Map(offered.map((operation) => [toolName(operation.name), operation]));
    const tools: Tool[] = offered.map((operation) => {
      const reads = operation.effect === 'read';
      const bare = operation.input instanceof z.ZodUndefined ? z.object({}) : operation.input instanceof z.ZodObject ? operation.input : z.object({ input: operation.input });
      return {
        name: toolName(operation.name),
        description: reads ? operation.description : `${operation.description} NOT RUN when you call it: it is added to a plan the person must approve.`,
        // A change carries a line saying what it does, which is what the person reads in the plan.
        schema: reads ? bare : z.object({ step: z.string().describe('What this step does, in a few plain words, for the person approving it.'), input: operation.input instanceof z.ZodUndefined ? z.object({}).optional() : operation.input }),
        handler: never,
      };
    });
    tools.push(
      { name: 'show_chart', description: 'Puts a bar chart beside the conversation. Use it for any comparison of numbers across groups, then say what it shows in a sentence.', schema: z.object({ title: z.string(), subtitle: z.string().optional(), bars: z.array(z.object({ label: z.string(), value: z.number(), display: z.string().describe('The value as a person reads it, such as $1.2M or 42.') })).min(1).max(24) }), handler: never },
      {
        name: 'show_records',
        description: 'Puts a list of records beside the conversation, from the same query records_list takes. Use it instead of writing records out in your answer.',
        schema: z.object({ title: z.string(), objectId: z.string(), viewId: z.string().optional(), filters: z.array(z.object({ property: z.string(), operator: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'lt', 'between', 'empty', 'notEmpty']), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]).optional() })).optional(), search: z.string().optional(), sort: z.object({ property: z.string(), direction: z.enum(['asc', 'desc']) }).optional(), columns: z.array(z.string()).optional() }),
        handler: never,
      },
      { name: 'draft_email', description: 'Puts a draft email to a contact beside the conversation for the person to edit and send themselves. Nothing is sent.', schema: z.object({ contactId: z.string(), subject: z.string(), body: z.string() }), handler: never },
      { name: 'suggest_replies', description: 'Offers up to three short things the person might say next, as buttons. Call it once, at the end, when there are natural follow-ups.', schema: z.object({ replies: z.array(z.string()).min(1).max(3) }), handler: never },
    );

    const system = [
      `You are the assistant inside a CRM. You are working for ${me?.name ?? 'a member of the team'} (user id ${workspace.currentUserId}, role ${workspace.access.roleName}) and act with exactly their access. Today is ${new Date().toISOString().slice(0, 10)}.`,
      `They are looking at ${input.page.path}${input.page.objectId ? ` (object ${input.page.objectId}${input.page.recordId ? `, record ${input.page.recordId}` : ''})` : ''}. "This" and "these" mean what is on that page.`,
      'Look things up with the tools before you answer; never guess a number or a name. Use ids from the tools, not from memory.',
      'Tools that change, delete or send are not carried out when you call them. Each becomes a step in a plan shown to the person, who approves it. Call every change the request needs, then tell them the plan is ready and what it will do. Never say a change has been made.',
      'Write plainly and briefly, for someone who is not technical. Put lists and comparisons beside the conversation with show_records and show_chart, and keep your words to what they mean.',
      `The CRM's objects and fields (id:type, options in brackets):\n${describeShape(workspace.objects)}`,
    ].join('\n\n');

    const messages: AIMessage[] = [{ role: 'system', content: system }, ...input.messages.map((message) => ({ role: message.role, content: message.text }))];
    let tokens = 0;

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const response = await adapter.generate(messages, { model, tools });
      tokens += response.usage.totalTokens;
      used.inputTokens += response.usage.inputTokens;
      used.outputTokens += response.usage.outputTokens;
      used.rounds += 1;
      if (response.content.trim()) events.push({ type: 'say', text: response.content.trim() });
      await flush();
      const calls = response.toolCalls ?? [];
      if (calls.length === 0) break;
      messages.push({ role: 'assistant', content: response.content, toolCalls: calls });

      for (const call of calls) {
        const started = Date.now();
        let result: unknown;
        let failed = false;
        try {
          const tool = tools.find((item) => item.name === call.name);
          if (!tool) throw new ValidationError(`There is no tool called ${call.name}.`);
          const given = tool.schema.parse(call.arguments) as Record<string, unknown>;
          const operation = byTool.get(call.name);
          if (operation && operation.effect !== 'read') {
            steps.push({ label: String(given.step), operation: operation.name, input: operation.input instanceof z.ZodUndefined ? undefined : given.input });
            result = { planned: true, note: 'Not run. It is now a step in the plan the person will be asked to approve.' };
          } else if (operation) {
            const value = operation.input instanceof z.ZodUndefined ? undefined : operation.input instanceof z.ZodObject ? given : given.input;
            result = await this.call(ctx, operation.name, value);
            events.push({ type: 'tool', name: call.name, label: operation.title, result: summarize(result), ok: true, ms: Date.now() - started });
          } else result = await this.display(ctx, call.name, given, workspace, events);
        } catch (error) {
          failed = true;
          result = error instanceof Error ? error.message : 'The tool failed.';
          events.push({ type: 'tool', name: call.name, label: byTool.get(call.name)?.title ?? call.name, result: String(result), ok: false, ms: Date.now() - started });
        }
        let text = JSON.stringify(result ?? null);
        if (text.length > MAX_RESULT_CHARS) text = JSON.stringify({ cut: true, note: `The result was too long and was cut at ${MAX_RESULT_CHARS} characters. Narrow the query, or ask for a smaller page.`, start: text.slice(0, MAX_RESULT_CHARS) });
        messages.push({ role: 'tool', content: JSON.stringify({ callId: call.id, toolName: call.name, result: JSON.parse(text), isError: failed }) });
        await flush();
      }
    }

    if (steps.length > 0) {
      const last = [...events].reverse().find((event) => event.type === 'say');
      events.push({ type: 'plan', title: steps.length === 1 ? (steps[0]?.label ?? 'Proposed change') : `${steps.length} proposed changes`, summary: last?.type === 'say' ? last.text.split('\n')[0] ?? '' : 'Nothing has been changed yet.', steps });
    }
    if (!events.some((event) => event.type === 'say')) events.push({ type: 'say', text: steps.length > 0 ? 'I have put a plan beside this conversation. Nothing has been changed yet; run it when you are happy with it.' : 'I looked into it but have nothing to add.' });
    await flush();
    return { events, model, tokens };
  }

  /** The tools that put something beside the conversation. Each returns to the model a short note of what the person now sees. */
  private async display(ctx: Context, name: string, given: Record<string, unknown>, workspace: Workspace, events: AssistantEvent[]): Promise<unknown> {
    switch (name) {
      case 'show_chart': {
        const chart = given as { title: string; subtitle?: string; bars: Array<{ label: string; value: number; display: string }> };
        events.push({ type: 'show', item: { kind: 'chart', title: chart.title, subtitle: chart.subtitle, bars: chart.bars } });
        return { shown: true };
      }
      case 'show_records': {
        const { title, columns, ...query } = given as { title: string; objectId: string; columns?: string[] } & Record<string, unknown>;
        const object = workspace.objects.find((item) => item.id === query.objectId);
        if (!object) throw new ValidationError(`There is no object called ${query.objectId}.`);
        const list = (await this.call(ctx, 'records.list', { ...query, page: 1, pageSize: 8 })) as ListResult;
        const shown = (columns?.length ? columns : (object.views[0]?.columns ?? [object.primaryProperty])).filter((column) => object.properties.some((property) => property.id === column)).slice(0, 5);
        events.push({ type: 'show', item: { kind: 'table', title, subtitle: `${list.total.toLocaleString('en-US')} ${list.total === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase()}`, objectId: object.id, columns: shown, records: list.records, references: list.references, total: list.total } });
        return { shown: Math.min(list.total, 8), total: list.total };
      }
      case 'draft_email': {
        const draft = given as { contactId: string; subject: string; body: string };
        const { record } = (await this.call(ctx, 'records.get', draft.contactId)) as RecordDetail;
        const email = typeof record.properties.email === 'string' ? record.properties.email : '';
        if (!email) throw new ValidationError('That contact has no email address.');
        const toName = String(record.properties.name ?? email);
        events.push({ type: 'show', item: { kind: 'draft', title: `Email to ${toName}`, to: email, toName, subject: draft.subject, body: draft.body } });
        return { shown: true, note: 'The person will edit and send it themselves.' };
      }
      case 'suggest_replies':
        events.push({ type: 'suggest', replies: (given as { replies: string[] }).replies });
        return { shown: true };
      default:
        throw new ValidationError(`There is no tool called ${name}.`);
    }
  }
}

/** A one-line account of a lookup, for the row the person sees in the conversation. */
function summarize(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} ${result.length === 1 ? 'row' : 'rows'}`;
  if (result && typeof result === 'object') {
    const value = result as Record<string, unknown>;
    if (typeof value.total === 'number') return `${value.total.toLocaleString('en-US')} found`;
    if (Array.isArray(value.rows)) return `${value.rows.length} groups`;
    if (value.record) return 'Found';
  }
  return 'Done';
}
