import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useQuery } from '../api';
import { ICON, medium, small } from '../ui/styles';
import { useWorkspace } from './workspace';

const timeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The bell: what happened that involves you. Workflows that "notify the owner" land here when you
 * own the record. Clicking one opens the record and marks it read.
 */
export function Notifications({ offset }: { /** Width of the sidebar, so the panel opens beside it. */ offset: number }) {
  const { revision } = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { data } = useQuery(() => api.listNotifications(), [revision, version]);
  const unread = data?.notifications.filter((item) => !item.read).length ?? 0;

  // Click outside, or Escape, closes the panel.
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markAll() {
    await api.markNotificationsRead();
    setVersion((value) => value + 1);
  }

  async function openOne(id: string, recordId: string | null) {
    await api.markNotificationsRead(id);
    setVersion((value) => value + 1);
    const reference = recordId ? data?.references[recordId] : undefined;
    if (recordId && reference) navigate(`/${reference.objectId}/${recordId}`);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="m-button"
        data-variant="ghost"
        data-size="sm"
        data-icon-only
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
        style={{ color: 'var(--m-color-fg-muted)', position: 'relative' }}
      >
        <Bell size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
        {unread > 0 ? <span aria-hidden style={{ position: 'absolute', insetBlockStart: 4, insetInlineEnd: 4, inlineSize: 7, blockSize: 7, borderRadius: 'var(--m-radius-full)', background: 'var(--m-color-danger-solid, var(--m-color-danger-fg))' }} /> : null}
      </button>
      {open ? (
        // Outside the dark sidebar's own theme scope, so the panel takes the page's colours.
        <div
          ref={panel}
          role="dialog"
          aria-label="Notifications"
          data-theme="keel"
          data-mode={document.documentElement.dataset.mode}
          className="m-card"
          style={{ position: 'fixed', insetInlineStart: offset + 8, insetBlockEnd: 'var(--m-space-3)', inlineSize: 360, maxBlockSize: '70vh', zIndex: 30, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--m-shadow-overlay, var(--m-shadow-lg))' }}
        >
          <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-2) var(--m-space-3)', borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
            <span style={medium}>Notifications</span>
            <button type="button" className="m-button" data-variant="ghost" data-size="sm" disabled={unread === 0} onClick={() => void markAll()}>
              <CheckCheck size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Mark all read
            </button>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto' }}>
            {(data?.notifications ?? []).map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => void openOne(item.id, item.recordId)} className="m-cluster" data-gap="2" data-align="start" style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', gap: 'var(--m-space-2)', inlineSize: '100%', padding: 'var(--m-space-2) var(--m-space-3)', borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
                  <span aria-hidden style={{ flexShrink: 0, inlineSize: 8, blockSize: 8, marginBlockStart: 6, borderRadius: 'var(--m-radius-full)', background: item.read ? 'transparent' : 'var(--m-color-info-border)' }} />
                  <span className="m-stack" data-gap="0" style={{ minInlineSize: 0 }}>
                    <span style={item.read ? { color: 'var(--m-color-fg-muted)' } : undefined}>{item.message}</span>
                    <span style={small}>
                      {item.recordId && data?.references[item.recordId] ? `${data.references[item.recordId]?.label} · ` : ''}
                      {timeFormat.format(new Date(item.createdAt))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {data && data.notifications.length === 0 ? <li style={{ ...small, padding: 'var(--m-space-4)' }}>Nothing yet.</li> : null}
          </ul>
        </div>
      ) : null}
    </>
  );
}
