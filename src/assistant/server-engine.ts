import { api } from '../api';
import { listenToTurn } from '../api/live';
import type { AssistantEvent } from '../contracts/assistant';
import { operations } from '../contracts/operations';
import type { CrmApi } from '../contracts/records';
import type { EngineContext } from './mock-engine';

/**
 * The assistant on the server's model. The server runs the turn (the model, with the CRM's
 * operations as its tools) and sends back what happened in order; this plays it into the
 * conversation. A plan's steps are operations, and when the person approves the plan they run
 * here, in their own browser, as them: the server never changes anything on the model's say-so.
 */

/** Runs one planned step: the operation it names, with the input the model gave, through the normal API. */
async function runStep(step: { operation: string; input?: unknown }): Promise<void> {
  const operation = operations.find((item) => item.name === step.operation);
  if (!operation) throw new Error(`The plan asked for something the CRM cannot do (${step.operation}).`);
  await (api[operation.method as keyof CrmApi] as (input: unknown) => Promise<unknown>)(step.input);
}

async function play(event: AssistantEvent, ctx: EngineContext): Promise<void> {
  switch (event.type) {
    case 'say':
      await ctx.say(event.text);
      break;
    case 'tool':
      // Already done on the server; shown as a finished row.
      await ctx
        .tool(
          event.name,
          event.label,
          async () => {
            if (!event.ok) throw new Error(event.result);
          },
          () => event.result,
        )
        .catch(() => undefined);
      break;
    case 'show':
      ctx.show(event.item);
      break;
    case 'plan':
      ctx.propose({
        title: event.title,
        summary: event.summary,
        steps: event.steps.map((step) => ({ label: step.label, run: () => runStep(step) })),
        doneText: event.steps.length === 1 ? 'Done.' : `Done. All ${event.steps.length} steps ran.`,
      });
      break;
    case 'suggest':
      ctx.suggest(event.replies);
      break;
  }
}

/**
 * Runs one turn on the server. Events are played as they arrive over the live connection, so the
 * person watches the answer take shape; the reply at the end carries all of them, and whatever was
 * not played yet (or everything, if the connection was down) is played from it. Each event is
 * played once, in order.
 */
export async function respondFromServer(history: Array<{ role: 'user' | 'assistant'; text: string }>, ctx: EngineContext): Promise<void> {
  const turnId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const arrived = new Map<number, AssistantEvent>();
  let played = 0;
  let playing = Promise.resolve();
  // Plays every event that is next in line. Chained, so two arrivals never play at once or out of order.
  const advance = () => {
    playing = playing.then(async () => {
      for (let next = arrived.get(played); next; next = arrived.get(played)) {
        played += 1;
        await play(next, ctx);
      }
    });
    return playing;
  };
  const listening = listenToTurn(turnId, (message) => {
    arrived.set(message.index, message.event as AssistantEvent);
    void advance();
  });
  try {
    const reply = await api.assistantTurn({ messages: history.slice(-40), page: ctx.page, turnId });
    (reply.events as AssistantEvent[]).forEach((event, index) => {
      if (!arrived.has(index)) arrived.set(index, event);
    });
    await advance();
  } finally {
    listening.stop();
    await playing;
  }
}
