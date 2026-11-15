import type { AIAdapter, AIMessage } from '@mariachi/ai';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AssistantReply } from '../../src/contracts/assistant';
import { registerModelProvider } from '../src/assistant/providers';
import { type Crm, MAYA, startCrm } from './harness';

let crm: Crm;
type Pushed = { topic: string; turnId: string; index: number; delta?: string; event?: { type: string; text?: string } };
const pushed: Array<{ to: string; data: Pushed }> = [];
const usage = { inputTokens: 100, outputTokens: 20 };
let generated = 0;

/** A model that writes its answer a few letters at a time, and reports its tool calls at the end of the stream. */
const streaming = {
  streamsToolCalls: true,
  async generate() {
    generated += 1;
    return { content: 'Not streamed.', usage: { ...usage, totalTokens: 120 }, model: 'streaming', latencyMs: 1 };
  },
  async *stream(messages: AIMessage[]) {
    const looked = messages.some((message) => message.role === 'tool');
    const words = looked ? 'There are open deals in every stage, and most of the value is early.' : 'Let me look at the pipeline for you now.';
    for (let at = 0; at < words.length; at += 7) yield { content: words.slice(at, at + 7), done: false };
    yield { content: '', done: true, usage, ...(looked ? {} : { toolCalls: [{ id: 'c1', name: 'records_summarize', arguments: { objectId: 'deals', groupBy: 'stage' } }] }) };
  },
} as unknown as AIAdapter;

/** A model whose adapter can stream text but would lose its tool calls doing so, like the ones that come with Mariachi today. */
const textOnly = {
  async generate() {
    generated += 1;
    return { content: 'All in one go.', usage: { ...usage, totalTokens: 120 }, model: 'text-only', latencyMs: 1 };
  },
  // biome-ignore lint/correctness/useYield: it must never be called
  async *stream() {
    throw new Error('This stream drops tool calls and must not be used.');
  },
} as unknown as AIAdapter;

beforeAll(async () => {
  crm = await startCrm({ push: async (_ctx, userId, data) => void pushed.push({ to: userId, data: data as Pushed }) });
  registerModelProvider({ id: 'streaming', label: 'Streaming', hint: '', needsKey: false, needsBaseUrl: false, defaultModel: 'streaming', create: () => streaming });
  registerModelProvider({ id: 'text-only', label: 'Text only', hint: '', needsKey: false, needsBaseUrl: false, defaultModel: 'text-only', create: () => textOnly });
});

describe('the assistant writing as the model writes', () => {
  it('sends the words as they come, then each whole event, in an order the browser can put together', async () => {
    await crm.call(MAYA, 'assistant.saveSettings', { provider: 'streaming', model: 'streaming' });
    const reply = await crm.call<AssistantReply>(MAYA, 'assistant.turn', { messages: [{ role: 'user', text: 'How is the pipeline?' }], page: { path: '/deals' }, turnId: 'stream-1' });
    expect(generated).toBe(0);
    expect(reply.events.map((event) => event.type)).toEqual(['say', 'tool', 'say']);
    expect(reply.tokens).toBe(240);

    const mine = pushed.filter((item) => item.data.turnId === 'stream-1');
    expect(mine.every((item) => item.to === MAYA)).toBe(true);
    // The words of each paragraph arrive in pieces before the paragraph itself, and add up to it.
    for (const index of [0, 2]) {
      const said = reply.events[index] as { type: 'say'; text: string };
      const pieces = mine.filter((item) => item.data.index === index && item.data.delta !== undefined);
      const whole = mine.findIndex((item) => item.data.index === index && item.data.event?.type === 'say');
      expect(pieces.length).toBeGreaterThan(1);
      expect(pieces.map((item) => item.data.delta).join('')).toBe(said.text);
      expect(mine.indexOf(pieces[pieces.length - 1] as (typeof mine)[number])).toBeLessThan(whole);
    }
    // The tool call the model made mid-stream was not lost.
    expect(mine.some((item) => item.data.index === 1 && item.data.event?.type === 'tool')).toBe(true);
  });

  it('streams nothing when nobody is watching the turn', async () => {
    pushed.length = 0;
    const reply = await crm.call<AssistantReply>(MAYA, 'assistant.turn', { messages: [{ role: 'user', text: 'How is the pipeline?' }], page: { path: '/deals' } });
    expect(pushed).toHaveLength(0);
    expect(generated).toBe(1);
    expect(reply.events.some((event) => event.type === 'say')).toBe(true);
  });

  it('asks in one go from a model whose stream would lose its tool calls', async () => {
    generated = 0;
    pushed.length = 0;
    await crm.call(MAYA, 'assistant.saveSettings', { provider: 'text-only', model: 'text-only' });
    const reply = await crm.call<AssistantReply>(MAYA, 'assistant.turn', { messages: [{ role: 'user', text: 'Hello' }], page: { path: '/' }, turnId: 'whole-1' });
    expect(generated).toBe(1);
    expect(reply.events).toEqual([{ type: 'say', text: 'All in one go.' }]);
    expect(pushed.some((item) => item.data.delta !== undefined)).toBe(false);
  });
});
