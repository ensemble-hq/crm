/**
 * Live updates from the server, over one connection shared by the whole app. Two kinds of message
 * arrive on it:
 *
 * - A notice that part of the CRM changed. It says where to look, never what is there; the app
 *   reads that part again through the normal operations.
 * - The events of an assistant turn this person started, as they happen, so the answer builds up
 *   on screen instead of appearing all at once.
 *
 * If the connection drops it is opened again, and the app reads everything once in case it missed
 * something meanwhile. On mock data there is no server, so nothing is opened.
 */

export type Notice = { topic: 'records' | 'inbox' | 'notifications' | 'settings'; objectId?: string };
/** Either a whole event of the turn, or `delta`: more words of the event that will have this index once the model has finished writing it. */
export type TurnEvent = { topic: 'assistant'; turnId: string; index: number; event?: unknown; delta?: string };

const CHANGES = 'changes';

const noticeListeners = new Set<(notice: Notice) => void>();
const turnListeners = new Map<string, (message: TurnEvent) => void>();
let socket: WebSocket | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let wait = 1_000;
let connectedBefore = false;
let ready = false;

function open(base: string): void {
  const url = new URL(`${base}/live`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(url);
  socket.onmessage = (event) => {
    let message: { type?: string; data?: Notice | TurnEvent };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      socket?.send(JSON.stringify({ type: 'subscribe', channel: CHANGES }));
      wait = 1_000;
      ready = true;
      // Anything that happened while the connection was down was missed, so read once to catch up.
      if (connectedBefore) for (const listener of noticeListeners) listener({ topic: 'settings' });
      connectedBefore = true;
    } else if (message.type === 'message' && message.data) {
      const data = message.data;
      if (data.topic === 'assistant') turnListeners.get(data.turnId)?.(data);
      else for (const listener of noticeListeners) listener(data);
    }
  };
  socket.onclose = () => {
    ready = false;
    socket = undefined;
    if (noticeListeners.size === 0 && turnListeners.size === 0) return;
    // Try again, waiting a little longer each time, up to half a minute.
    timer = setTimeout(() => open(base), wait);
    wait = Math.min(wait * 2, 30_000);
  };
}

function ensureOpen(): boolean {
  const base = import.meta.env.VITE_API_URL as string | undefined;
  if (!base) return false;
  if (!socket) {
    clearTimeout(timer);
    open(base);
  }
  return true;
}

/** Listens for changes for as long as the page is open. Returns a function that stops listening. Does nothing on mock data. */
export function listenForChanges(onNotice: (notice: Notice) => void): () => void {
  if (!ensureOpen()) return () => {};
  noticeListeners.add(onNotice);
  return () => {
    noticeListeners.delete(onNotice);
  };
}

/**
 * Listens for the events of one assistant turn. Returns whether the connection is up (so events
 * can be expected) and a function that stops listening.
 */
export function listenToTurn(turnId: string, onEvent: (message: TurnEvent) => void): { live: boolean; stop: () => void } {
  if (!ensureOpen()) return { live: false, stop: () => {} };
  turnListeners.set(turnId, onEvent);
  return { live: ready, stop: () => void turnListeners.delete(turnId) };
}
