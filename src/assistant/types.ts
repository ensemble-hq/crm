import type { CrmRecord, Reference } from '../contracts/records';

/** One action the assistant took while answering, shown as a row in the conversation. */
export type ToolCall = {
  id: string;
  /** The tool's name in the tool layer, e.g. `search_records`. */
  name: string;
  /** What it is doing, in plain words. */
  label: string;
  status: 'running' | 'done' | 'error';
  /** A one-line result, e.g. "23 deals". */
  result?: string;
  durationMs?: number;
};

export type Attachment = {
  name: string;
  size: number;
  /** Parsed rows when the file is a CSV; the first row is the header. */
  rows?: string[][];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The assistant is still writing this message. */
  streaming?: boolean;
  tools?: ToolCall[];
  attachments?: Attachment[];
  /** Suggested next messages, offered as buttons under the answer. */
  replies?: string[];
};

export type PlanStep = { id: string; label: string; detail?: string; status: 'pending' | 'running' | 'done' | 'error' };

/** Something the assistant puts beside the conversation: its work, not its words. */
export type CanvasItem =
  | { kind: 'chart'; id: string; title: string; subtitle?: string; bars: Array<{ label: string; value: number; display: string; note?: string }> }
  | { kind: 'table'; id: string; title: string; subtitle?: string; objectId: string; columns: string[]; records: CrmRecord[]; references: Record<string, Reference>; total: number }
  | { kind: 'mapping'; id: string; title: string; subtitle?: string; rows: Array<{ column: string; property: string | null; sample: string }> }
  | { kind: 'plan'; id: string; title: string; summary: string; steps: PlanStep[]; state: 'proposed' | 'running' | 'done' | 'failed'; doneLink?: { to: string; label: string } }
  | { kind: 'handoff'; id: string; title: string; request: string; steps: string[] };

export type CanvasItemInput = CanvasItem extends infer Item ? (Item extends { id: string } ? Omit<Item, 'id'> : never) : never;
