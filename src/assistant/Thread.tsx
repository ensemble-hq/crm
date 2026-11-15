import { ArrowUp, AudioLines, Paperclip, X } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { parseCsv } from '../lib/csv';
import { ICON, initials, small } from '../ui/styles';
import type { Attachment, ChatMessage } from './types';

export async function readAttachment(file: File): Promise<Attachment> {
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  return { name: file.name, size: file.size, rows: isCsv ? parseCsv(await file.text()) : undefined, ...(isCsv ? {} : { file }) };
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  return (
    <span className="m-badge" style={{ gap: 'var(--m-space-1)' }}>
      <Paperclip size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
      {attachment.name}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${attachment.name}`} onClick={onRemove} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}>
          <X size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** The message box: text, a file, the microphone for voice mode, and send. */
export function Composer({
  placeholder,
  working,
  autoFocus = false,
  onSend,
  onVoice,
}: {
  placeholder: string;
  working: boolean;
  autoFocus?: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onVoice: () => void;
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (working || (text.trim() === '' && attachments.length === 0)) return;
    onSend(text, attachments);
    setText('');
    setAttachments([]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="m-composer" data-state={working ? 'streaming' : undefined} onSubmit={submit}>
      {attachments.length > 0 ? (
        <div className="m-cluster" data-gap="1">
          {attachments.map((attachment) => (
            <AttachmentChip key={attachment.name} attachment={attachment} onRemove={() => setAttachments((previous) => previous.filter((item) => item !== attachment))} />
          ))}
        </div>
      ) : null}
      <label className="m-sr-only" htmlFor="assistant-message">
        Message the assistant
      </label>
      <textarea className="m-composer-input" id="assistant-message" ref={input} rows={1} placeholder={placeholder} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
      <div className="m-composer-actions">
        <input
          ref={file}
          type="file"
          accept={import.meta.env.VITE_API_URL ? undefined : '.csv,text/csv'}
          hidden
          onChange={async (event) => {
            const picked = event.target.files?.[0];
            event.target.value = '';
            if (picked) setAttachments([await readAttachment(picked)]);
          }}
        />
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Attach a file" onClick={() => file.current?.click()}>
          <Paperclip size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
        <span className="m-composer-spacer" />
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={onVoice}>
          <AudioLines size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Talk
        </button>
        <button type="submit" className="m-button" data-variant="primary" data-size="sm" data-icon-only aria-label="Send" disabled={working || (text.trim() === '' && attachments.length === 0)}>
          <ArrowUp size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
      </div>
    </form>
  );
}

function ToolRows({ message }: { message: ChatMessage }) {
  if (!message.tools?.length) return null;
  return (
    <div className="m-stack" data-gap="1">
      {message.tools.map((tool) => (
        <details key={tool.id} className="m-tool-call" data-status={tool.status}>
          <summary>
            <span className="m-tool-call-name">{tool.name}</span>
            <span className="m-tool-call-status">{tool.status === 'running' ? tool.label : (tool.result ?? 'Done')}</span>
            {tool.durationMs !== undefined ? <span className="m-tool-call-duration">{(tool.durationMs / 1000).toFixed(1)}s</span> : null}
          </summary>
          <div className="m-tool-call-body">
            <div>
              <div className="m-tool-call-label">What it did</div>
              <p style={{ margin: 0 }}>{tool.label}</p>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

/** The conversation: what was asked, what the assistant did (its tool rows), and what it said. */
export function Thread({
  messages,
  userName,
  onReply,
  working,
  activity,
}: {
  messages: ChatMessage[];
  userName: string;
  onReply: (text: string) => void;
  working: boolean;
  /** What the assistant is doing right now, shown while it has not started writing. */
  activity: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];

  // Keep the newest words in view as they arrive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any change to the last message
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, last?.text, last?.tools?.length, last?.replies?.length]);

  return (
    <div className="m-chat" role="log" aria-live="polite" aria-label="Conversation with the assistant">
      {messages.map((message) =>
        message.role === 'user' ? (
          <article key={message.id} className="m-message" data-role="user">
            <div className="m-message-avatar" aria-hidden="true">
              {initials(userName)}
            </div>
            <div className="m-message-body">
              <div className="m-stack" data-gap="2">
                {message.text}
                {message.attachments?.length ? (
                  <div className="m-cluster" data-gap="1">
                    {message.attachments.map((attachment) => (
                      <AttachmentChip key={attachment.name} attachment={attachment} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ) : (
          <article key={message.id} className="m-message" data-role="assistant" aria-busy={message.streaming ? true : undefined}>
            <div className="m-message-avatar" aria-hidden="true">
              AI
            </div>
            <div className="m-message-body" data-streaming={message.streaming && message.text ? '' : undefined}>
              <div className="m-stack" data-gap="3">
                <ToolRows message={message} />
                {message.text === '' && message.streaming && !message.tools?.some((tool) => tool.status === 'running') ? <span style={small}>{activity || 'Thinking'}…</span> : null}
                {message.text.split('\n\n').map((paragraph, index) =>
                  paragraph ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs only ever append
                    <p key={index} style={{ margin: 0 }}>
                      {paragraph}
                    </p>
                  ) : null,
                )}
                {message.replies?.length && !working ? (
                  <div className="m-cluster" data-gap="2">
                    {message.replies.map((reply) => (
                      <button key={reply} type="button" className="m-button" data-size="sm" onClick={() => onReply(reply)}>
                        {reply}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ),
      )}
      <div ref={end} />
    </div>
  );
}
