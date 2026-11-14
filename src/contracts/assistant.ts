import { z } from 'zod';
import { recordSchema, referenceSchema } from './records';

/**
 * The assistant on a real model. The model is the customer's choice: a provider from the list the
 * server offers, a model name, and their own key or endpoint. The key is write-only: it can be set
 * and replaced, never read back.
 */

export const modelProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** What to tell the person choosing: where the key comes from, what the endpoint must speak. */
  hint: z.string(),
  needsKey: z.boolean(),
  needsBaseUrl: z.boolean(),
  defaultModel: z.string(),
});
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const assistantSettingsSchema = z.object({
  /** True when a model is connected and the assistant runs on it. */
  configured: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  /** Whether a key is stored. The key itself is never returned. */
  hasKey: z.boolean(),
  providers: z.array(modelProviderSchema),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

export const saveAssistantSettingsSchema = z.object({
  /** Null disconnects the model; the assistant goes back to its built-in demo. */
  provider: z.string().nullable(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  /** Leave out to keep the stored key. */
  apiKey: z.string().optional(),
});
export type SaveAssistantSettings = z.infer<typeof saveAssistantSettingsSchema>;

export const assistantTurnSchema = z.object({
  /** The conversation so far, oldest first, ending with what the person just said. */
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).min(1).max(60),
  /** Where the person is, so "this" and "these" mean something. */
  page: z.object({ path: z.string(), objectId: z.string().optional(), recordId: z.string().optional() }),
  /** A name for this turn chosen by the app. With it, each event is also pushed over the live connection as it happens, so the answer builds up on screen. */
  turnId: z.string().max(64).optional(),
});
export type AssistantTurn = z.infer<typeof assistantTurnSchema>;

const chartSchema = z.object({ kind: z.literal('chart'), title: z.string(), subtitle: z.string().optional(), bars: z.array(z.object({ label: z.string(), value: z.number(), display: z.string(), note: z.string().optional() })) });
const tableSchema = z.object({ kind: z.literal('table'), title: z.string(), subtitle: z.string().optional(), objectId: z.string(), columns: z.array(z.string()), records: z.array(recordSchema), references: z.record(referenceSchema), total: z.number().int() });
const draftSchema = z.object({ kind: z.literal('draft'), title: z.string(), to: z.string(), toName: z.string(), subject: z.string(), body: z.string() });

/** One thing that happened in the assistant's turn, in order. The app plays them back as they would have unfolded. */
export const assistantEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('say'), text: z.string() }),
  /** Something it looked up. */
  z.object({ type: z.literal('tool'), name: z.string(), label: z.string(), result: z.string(), ok: z.boolean(), ms: z.number() }),
  /** Something it put beside the conversation. */
  z.object({ type: z.literal('show'), item: z.discriminatedUnion('kind', [chartSchema, tableSchema, draftSchema]) }),
  /** Changes it wants to make. None has been made: the person approves the plan, and the app then runs each step as that person. */
  z.object({ type: z.literal('plan'), title: z.string(), summary: z.string(), steps: z.array(z.object({ label: z.string(), operation: z.string(), input: z.unknown() })) }),
  z.object({ type: z.literal('suggest'), replies: z.array(z.string()) }),
]);
export type AssistantEvent = z.infer<typeof assistantEventSchema>;

export const assistantReplySchema = z.object({ events: z.array(assistantEventSchema), model: z.string(), tokens: z.number().int() });
export type AssistantReply = z.infer<typeof assistantReplySchema>;

/** What the assistant has been asked and what it used, so the people paying for the model can see where it goes. */
export const assistantUsageSchema = z.object({
  /** The last 30 days. */
  from: z.string(),
  turns: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  failed: z.number().int(),
  byPerson: z.array(z.object({ userId: z.string(), turns: z.number().int(), tokens: z.number().int() })),
  recent: z.array(z.object({ id: z.string(), userId: z.string(), question: z.string(), model: z.string(), tokens: z.number().int(), lookups: z.number().int(), plannedSteps: z.number().int(), seconds: z.number(), failed: z.boolean(), at: z.string() })),
});
export type AssistantUsage = z.infer<typeof assistantUsageSchema>;

export interface AssistantApi {
  getAssistantSettings(): Promise<AssistantSettings>;
  saveAssistantSettings(input: SaveAssistantSettings): Promise<AssistantSettings>;
  /** One turn of the conversation, on the connected model. */
  assistantTurn(input: AssistantTurn): Promise<AssistantReply>;
  /** Admins see everyone's; anyone else sees their own. */
  getAssistantUsage(): Promise<AssistantUsage>;
}
