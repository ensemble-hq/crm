import { useCallback, useRef, useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { type EngineContext, respond } from './mock-engine';
import type { Attachment, CanvasItem, CanvasItemInput, ChatMessage, PlanStep } from './types';

type PlanRun = { steps: Array<() => Promise<void>>; doneText: string };

export type Assistant = {
  messages: ChatMessage[];
  /** What the assistant has put beside the conversation, newest first. */
  canvas: CanvasItem[];
  working: boolean;
  /** What it is doing right now, in plain words; empty when idle or writing. */
  activity: string;
  send(text: string, attachments?: Attachment[]): void;
  runPlan(planId: string): void;
  reset(): void;
};

const WORDS_PER_TICK = 3;
const TICK_MS = 28;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One conversation with the assistant: its messages, its canvas, and the plans waiting for approval. */
export function useAssistant(): Assistant {
  const workspace = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canvas, setCanvas] = useState<CanvasItem[]>([]);
  const [working, setWorking] = useState(false);
  const [activity, setActivity] = useState('');
  const busy = useRef(false);
  const sequence = useRef(0);
  const plans = useRef(new Map<string, PlanRun>());
  const pendingPlan = useRef<string>();
  /** What has been written into each assistant message so far, so a second paragraph appends. */
  const written = useRef(new Map<string, string>());

  const nextId = useCallback((prefix: string) => {
    sequence.current += 1;
    return `${prefix}_${sequence.current}`;
  }, []);

  const patchMessage = useCallback((id: string, change: (message: ChatMessage) => ChatMessage) => {
    setMessages((previous) => previous.map((message) => (message.id === id ? change(message) : message)));
  }, []);

  const patchPlan = useCallback((planId: string, change: (plan: Extract<CanvasItem, { kind: 'plan' }>) => CanvasItem) => {
    setCanvas((previous) => previous.map((item) => (item.id === planId && item.kind === 'plan' ? change(item) : item)));
  }, []);

  /** Streams a paragraph into a message a few words at a time. */
  const write = useCallback(
    async (messageId: string, text: string) => {
      const words = text.split(' ');
      const existing = written.current.get(messageId);
      const prefix = existing ? `${existing}\n\n` : '';
      for (let index = WORDS_PER_TICK; index < words.length + WORDS_PER_TICK; index += WORDS_PER_TICK) {
        const shown = `${prefix}${words.slice(0, index).join(' ')}`;
        written.current.set(messageId, shown);
        patchMessage(messageId, (message) => ({ ...message, text: shown, streaming: true }));
        await pause(TICK_MS);
      }
    },
    [patchMessage],
  );

  const executePlan = useCallback(
    async (planId: string, messageId: string): Promise<void> => {
      const run = plans.current.get(planId);
      if (!run) return;
      if (pendingPlan.current === planId) pendingPlan.current = undefined;
      plans.current.delete(planId);
      patchPlan(planId, (plan) => ({ ...plan, state: 'running' }));
      const setStep = (index: number, status: PlanStep['status']) =>
        patchPlan(planId, (plan) => ({ ...plan, steps: plan.steps.map((step, position) => (position === index ? { ...step, status } : step)) }));
      try {
        for (let index = 0; index < run.steps.length; index += 1) {
          setStep(index, 'running');
          setActivity('Running the plan');
          await Promise.all([run.steps[index]?.(), pause(500)]);
          setStep(index, 'done');
        }
        patchPlan(planId, (plan) => ({ ...plan, state: 'done' }));
        setActivity('');
        await write(messageId, run.doneText);
      } catch (error) {
        patchPlan(planId, (plan) => ({ ...plan, state: 'failed', steps: plan.steps.map((step): PlanStep => (step.status === 'running' ? { ...step, status: 'error' } : step)) }));
        setActivity('');
        await write(messageId, `The plan stopped: ${error instanceof Error ? error.message : 'something went wrong'}. Steps already done were not undone.`);
      }
    },
    [patchPlan, write],
  );

  /** Starts an assistant turn: adds its (empty) message, runs `work`, then marks it finished. */
  const turn = useCallback(
    async (work: (messageId: string) => Promise<void>) => {
      const messageId = nextId('msg');
      busy.current = true;
      setWorking(true);
      setActivity('Thinking');
      setMessages((previous) => [...previous.map((message) => ({ ...message, replies: undefined })), { id: messageId, role: 'assistant', text: '', streaming: true, tools: [] }]);
      try {
        await work(messageId);
      } catch (error) {
        await write(messageId, `Something went wrong: ${error instanceof Error ? error.message : 'unknown error'}.`);
      } finally {
        patchMessage(messageId, (message) => ({ ...message, streaming: false }));
        busy.current = false;
        setWorking(false);
        setActivity('');
      }
    },
    [nextId, patchMessage, write],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      const trimmed = text.trim();
      if (busy.current || (!trimmed && attachments.length === 0)) return;
      const shown = trimmed || `Import ${attachments[0]?.name ?? 'this file'}`;
      setMessages((previous) => [...previous, { id: nextId('msg'), role: 'user', text: shown, attachments }]);

      void turn(async (messageId) => {
        const context: EngineContext = {
          objects: workspace.objects,
          users: workspace.users,
          currentUser: workspace.currentUser,
          say: async (paragraph) => {
            setActivity('');
            await write(messageId, paragraph);
          },
          suggest: (replies) => patchMessage(messageId, (message) => ({ ...message, replies })),
          tool: async (name, label, run, describe) => {
            const id = nextId('tool');
            const started = performance.now();
            setActivity(label);
            patchMessage(messageId, (message) => ({ ...message, tools: [...(message.tools ?? []), { id, name, label, status: 'running' }] }));
            const finish = (status: 'done' | 'error', result?: string) =>
              patchMessage(messageId, (message) => ({
                ...message,
                tools: message.tools?.map((tool) => (tool.id === id ? { ...tool, status, result, durationMs: performance.now() - started } : tool)),
              }));
            try {
              // A short floor so each step is readable as it happens.
              const [result] = await Promise.all([run(), pause(600)]);
              finish('done', describe(result));
              return result;
            } catch (error) {
              finish('error', error instanceof Error ? error.message : 'Failed');
              throw error;
            }
          },
          show: (item: CanvasItemInput) => {
            const id = nextId('canvas');
            setCanvas((previous) => [{ ...item, id } as CanvasItem, ...previous]);
            return id;
          },
          propose: (plan) => {
            const id = nextId('plan');
            plans.current.set(id, { steps: plan.steps.map((step) => step.run), doneText: plan.doneText });
            pendingPlan.current = id;
            const steps: PlanStep[] = plan.steps.map((step, index) => ({ id: `${id}_${index}`, label: step.label, detail: step.detail, status: 'pending' }));
            setCanvas((previous) => [{ kind: 'plan', id, title: plan.title, summary: plan.summary, steps, state: 'proposed', doneLink: plan.doneLink }, ...previous]);
            return id;
          },
          refreshWorkspace: () => workspace.reload(),
          runPendingPlan: async () => {
            const planId = pendingPlan.current;
            if (!planId) return false;
            await executePlan(planId, messageId);
            return true;
          },
        };
        await respond({ text: trimmed, attachments }, context);
      });
    },
    [executePlan, nextId, patchMessage, turn, workspace, write],
  );

  const runPlan = useCallback(
    (planId: string) => {
      if (busy.current || !plans.current.has(planId)) return;
      setMessages((previous) => [...previous, { id: nextId('msg'), role: 'user', text: 'Run the plan' }]);
      void turn((messageId) => executePlan(planId, messageId));
    },
    [executePlan, nextId, turn],
  );

  const reset = useCallback(() => {
    if (busy.current) return;
    plans.current.clear();
    written.current.clear();
    pendingPlan.current = undefined;
    setMessages([]);
    setCanvas([]);
  }, []);

  return { messages, canvas, working, activity, send, runPlan, reset };
}
