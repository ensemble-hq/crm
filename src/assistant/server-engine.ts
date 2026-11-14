import { api } from '../api';
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

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs one planned step: the operation it names, with the input the model gave, through the normal API. */
async function runStep(step: { operation: string; input?: unknown }): Promise<void> {
  const operation = operations.find((item) => item.name === step.operation);
  if (!operation) throw new Error(`The plan asked for something the CRM cannot do (${step.operation}).`);
  await (api[operation.method as keyof CrmApi] as (input: unknown) => Promise<unknown>)(step.input);
}

export async function respondFromServer(history: Array<{ role: 'user' | 'assistant'; text: string }>, ctx: EngineContext): Promise<void> {
  const reply = await api.assistantTurn({ messages: history.slice(-40), page: ctx.page });
  for (const event of reply.events as AssistantEvent[]) {
    switch (event.type) {
      case 'say':
        await ctx.say(event.text);
        break;
      case 'tool':
        // Already done on the server; shown as it would have looked while it ran.
        await ctx
          .tool(
            event.name,
            event.label,
            async () => {
              await pause(Math.min(event.ms, 400));
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
}
