/**
 * Live updates from the server. The server says which part of the CRM changed (never what is in
 * it); the app reads that part again through the normal operations. If the connection drops it is
 * opened again, and the app reads everything once in case it missed something meanwhile.
 */

export type Notice = { topic: 'records' | 'inbox' | 'notifications' | 'settings'; objectId?: string };

const CHANGES = 'changes';

/** Listens for changes for as long as the page is open. Returns a function that stops listening. Does nothing on mock data. */
export function listenForChanges(onNotice: (notice: Notice) => void): () => void {
  const base = import.meta.env.VITE_API_URL as string | undefined;
  if (!base) return () => {};
  const url = new URL(`${base}/live`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  let socket: WebSocket | undefined;
  let stopped = false;
  let wait = 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connectedBefore = false;

  function open(): void {
    socket = new WebSocket(url);
    socket.onmessage = (event) => {
      let message: { type?: string; data?: Notice };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        socket?.send(JSON.stringify({ type: 'subscribe', channel: CHANGES }));
        wait = 1_000;
        // Anything that happened while the connection was down was missed, so read once to catch up.
        if (connectedBefore) onNotice({ topic: 'settings' });
        connectedBefore = true;
      } else if (message.type === 'message' && message.data) onNotice(message.data);
    };
    socket.onclose = () => {
      if (stopped) return;
      // Try again, waiting a little longer each time, up to half a minute.
      timer = setTimeout(open, wait);
      wait = Math.min(wait * 2, 30_000);
    };
  }
  open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
