import { RotateCcw } from 'lucide-react';
import { Mark } from '../ui/Mark';
import { useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { Canvas } from '../assistant/Canvas';
import { Composer, Thread } from '../assistant/Thread';
import { VoiceMode } from '../assistant/VoiceMode';
import { useSharedAssistant } from '../assistant/context';
import { ICON, small } from '../ui/styles';

const SUGGESTIONS = ['What should I do today?', 'How is the pipeline looking?', 'Chart won deals by source', 'Which big deals have gone quiet?', 'Who has closed the most this year?', 'Import a spreadsheet of leads', 'Add a renewal date to deals', 'Build a customer portal'];

/**
 * The assistant's own page. Empty, it is one question and one message box. Once you ask, the
 * conversation takes the left and the assistant's work (charts, tables, plans) builds up on the
 * right. Voice mode replaces the conversation with the assistant's voice; the work stays beside it.
 */
export function AssistantPage() {
  const { currentUser } = useWorkspace();
  const assistant = useSharedAssistant();
  const [voice, setVoice] = useState(false);
  const empty = assistant.messages.length === 0;
  const hasCanvas = assistant.canvas.length > 0;
  const firstName = currentUser.name.split(' ')[0] ?? currentUser.name;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: hasCanvas ? 'minmax(0, 1fr) minmax(360px, 44%)' : 'minmax(0, 1fr)', blockSize: 'calc(100vh - var(--m-space-2) * 2)', minBlockSize: 480 }}>
      <section aria-label="Assistant" className="m-stack" data-gap="0" style={{ minInlineSize: 0, minBlockSize: 0, blockSize: '100%' }}>
        {voice ? (
          <VoiceMode assistant={assistant} onLeave={() => setVoice(false)} />
        ) : empty ? (
          <div className="m-stack" data-gap="5" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 'var(--m-space-6) var(--m-space-5)' }}>
            <div className="m-stack" data-gap="2" style={{ alignItems: 'center', textAlign: 'center' }}>
              <span
                aria-hidden
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--m-color-fg-default)',
                }}
              >
                <Mark size={72} busy={assistant.working} />
              </span>
              <h1 style={{ fontSize: 'var(--m-font-size-3xl)', fontWeight: 'var(--m-font-weight-medium)', letterSpacing: 'var(--m-font-tracking-tight)', lineHeight: 'var(--m-font-leading-tight)' }}>
                What do you want to do, {firstName}?
              </h1>
              <p style={{ color: 'var(--m-color-fg-muted)', maxInlineSize: 460 }}>Ask about your data, hand it a file, or tell it what needs doing. It shows its work beside the conversation and asks before it changes anything.</p>
            </div>
            <div style={{ inlineSize: '100%', maxInlineSize: 640 }}>
              <Composer placeholder="Ask anything, or describe what needs doing…" working={assistant.working} autoFocus onSend={assistant.send} onVoice={() => setVoice(true)} />
            </div>
            <div className="m-cluster" data-gap="2" data-justify="center" style={{ maxInlineSize: 640 }}>
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="m-button" data-size="sm" onClick={() => assistant.send(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
            <p style={{ ...small, margin: 0 }}>A scripted preview: it understands the requests above and answers from this workspace's data.</p>
          </div>
        ) : (
          <>
            <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-2) var(--m-space-3)' }}>
              <span className="m-cluster" data-gap="2" style={{ fontWeight: 'var(--m-font-weight-medium)' }}>
                <Mark size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Assistant
              </span>
              <button type="button" className="m-button" data-variant="ghost" data-size="sm" disabled={assistant.working} onClick={assistant.reset}>
                <RotateCcw size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> New conversation
              </button>
            </div>
            <div style={{ flex: 1, minBlockSize: 0, overflowY: 'auto', padding: 'var(--m-space-3) var(--m-space-5)' }}>
              <div style={{ maxInlineSize: 680, marginInline: 'auto' }}>
                <Thread messages={assistant.messages} userName={currentUser.name} working={assistant.working} activity={assistant.activity} onReply={assistant.send} />
              </div>
            </div>
            <div style={{ padding: 'var(--m-space-3) var(--m-space-5) var(--m-space-5)' }}>
              <div style={{ maxInlineSize: 680, marginInline: 'auto' }}>
                <Composer placeholder="Reply, or ask for something else…" working={assistant.working} autoFocus onSend={assistant.send} onVoice={() => setVoice(true)} />
              </div>
            </div>
          </>
        )}
      </section>
      {hasCanvas ? (
        <aside
          aria-label="The assistant's work"
          style={{
            minInlineSize: 0,
            blockSize: '100%',
            overflowY: 'auto',
            padding: 'var(--m-space-4)',
            background: 'var(--m-color-bg-sunken)',
            borderInlineStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)',
          }}
        >
          <Canvas items={assistant.canvas} working={assistant.working} onRunPlan={assistant.runPlan} />
        </aside>
      ) : null}
    </div>
  );
}
