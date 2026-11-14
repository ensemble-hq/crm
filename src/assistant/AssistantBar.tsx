import { ArrowUp, Maximize2, RotateCcw, Sparkles, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWorkspace } from '../app/workspace';
import { ICON, small } from '../ui/styles';
import { Canvas } from './Canvas';
import { Thread } from './Thread';
import { useSharedAssistant } from './context';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/**
 * The assistant, floating at the bottom of every page. It knows which list or record is on
 * screen, so "summarize this" or "show only mine" needs no explanation. Its answers open in a
 * panel above the bar; the same conversation continues on the assistant's own page.
 */
export function AssistantBar({ offset }: { /** Width of the sidebar, so the bar centres on the page beside it. */ offset: number }) {
  const assistant = useSharedAssistant();
  const workspace = useWorkspace();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const object = workspace.object(assistant.page.objectId);

  // Cmd/Ctrl+J puts the cursor in the bar from anywhere; Escape closes the panel.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      } else if (event.key === 'Escape' && document.activeElement === input.current) {
        setOpen(false);
        input.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The assistant has its own page; the bar would only repeat it there.
  if (location.pathname === '/assistant') return null;

  const about = assistant.page.recordId && object ? `this ${object.singular.toLowerCase()}` : object ? `these ${object.plural.toLowerCase()}` : 'your CRM';
  const suggestions = assistant.page.recordId
    ? ['Summarize this', 'Draft a follow-up email', 'Remind me to call them tomorrow']
    : object?.id === 'deals'
      ? ['Show only mine closing this month', 'Show open deals over $100k', 'Which big deals have gone quiet?']
      : object?.id === 'contacts'
        ? ['Show only my leads', 'Show unassigned contacts', 'Import a spreadsheet of leads']
        : object
          ? [`Show only my ${object.plural.toLowerCase()}`, 'How is the pipeline looking?']
          : ['What should I do today?', 'How is the pipeline looking?', 'Which big deals have gone quiet?'];

  function send(message: string) {
    if (assistant.working || message.trim() === '') return;
    assistant.send(message);
    setText('');
    setOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send(text);
  }

  const empty = assistant.messages.length === 0;

  return (
    <div style={{ position: 'fixed', insetInlineStart: offset, insetInlineEnd: 0, insetBlockEnd: 'var(--m-space-5)', zIndex: 20, display: 'flex', justifyContent: 'center', padding: '0 var(--m-space-5)', pointerEvents: 'none' }}>
      <div className="m-stack" data-gap="2" style={{ inlineSize: 'min(640px, 100%)', pointerEvents: 'auto' }}>
        {open ? (
          <section
            className="m-card"
            aria-label="Assistant"
            style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--m-shadow-overlay, var(--m-shadow-lg))', display: 'flex', flexDirection: 'column', maxBlockSize: 'min(60vh, 560px)' }}
          >
            <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-2) var(--m-space-3)', borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
              <span className="m-cluster" data-gap="2">
                <Sparkles size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                <span style={{ fontWeight: 'var(--m-font-weight-medium)' }}>Assistant</span>
                <span className="m-badge">Looking at {about}</span>
              </span>
              <span className="m-cluster" data-gap="1">
                {empty ? null : (
                  <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="New conversation" disabled={assistant.working} onClick={assistant.reset}>
                    <RotateCcw size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </button>
                )}
                <Link to="/assistant" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Open the assistant's full page">
                  <Maximize2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                </Link>
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Close" onClick={() => setOpen(false)}>
                  <X size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                </button>
              </span>
            </div>
            <div style={{ overflowY: 'auto', padding: 'var(--m-space-3)' }}>
              {empty ? (
                <div className="m-stack" data-gap="2">
                  <span style={small}>Ask about {about}, or try:</span>
                  <div className="m-cluster" data-gap="2">
                    {suggestions.map((suggestion) => (
                      <button key={suggestion} type="button" className="m-button" data-size="sm" onClick={() => send(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="m-stack" data-gap="4">
                  <Thread messages={assistant.messages} userName={workspace.currentUser.name} working={assistant.working} activity={assistant.activity} onReply={send} />
                  {assistant.canvas.length > 0 ? <Canvas items={assistant.canvas} working={assistant.working} onRunPlan={assistant.runPlan} /> : null}
                </div>
              )}
            </div>
          </section>
        ) : null}
        <form
          onSubmit={submit}
          className="m-cluster"
          data-gap="2"
          style={{
            flexWrap: 'nowrap',
            padding: 'var(--m-space-2) var(--m-space-2) var(--m-space-2) var(--m-space-4)',
            borderRadius: 'var(--m-radius-full)',
            background: 'var(--m-color-bg-raised, var(--m-color-bg-surface))',
            boxShadow: 'var(--m-shadow-overlay, var(--m-shadow-lg))',
            border: 'var(--m-border-width-thin) solid var(--m-color-border-default)',
          }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-muted)' }}>
            <Sparkles size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
          </span>
          <label className="m-sr-only" htmlFor="assistant-bar">
            Ask the assistant
          </label>
          <input
            id="assistant-bar"
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={`Ask about ${about}, or tell it what to do…`}
            autoComplete="off"
            style={{ all: 'unset', flex: 1, minInlineSize: 0, font: 'inherit', color: 'var(--m-color-fg-default)' }}
          />
          <kbd className="m-kbd">{isMac ? '⌘J' : 'Ctrl J'}</kbd>
          <button type="submit" className="m-button" data-variant="primary" data-size="sm" data-icon-only aria-label="Send" disabled={assistant.working || text.trim() === ''} style={{ borderRadius: 'var(--m-radius-full)' }}>
            <ArrowUp size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
