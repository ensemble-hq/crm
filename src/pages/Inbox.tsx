import { Archive, Building2, Handshake, Inbox as InboxIcon, MailOpen, RotateCcw, Search, Send, Sparkles, User } from 'lucide-react';
import { type CSSProperties, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import { draftReply } from '../assistant/mock-engine';
import type { Conversation, InboxFolder, Message } from '../contracts/inbox';
import type { Reference } from '../contracts/records';
import { ICON, initials, medium, small } from '../ui/styles';

const FOLDERS: Array<{ id: InboxFolder; label: string; count?: 'mine' | 'unassigned' | 'open' }> = [
  { id: 'mine', label: 'Mine', count: 'mine' },
  { id: 'unassigned', label: 'Unassigned', count: 'unassigned' },
  { id: 'open', label: 'All open', count: 'open' },
  { id: 'closed', label: 'Closed' },
];

const PAGE_SIZE = 40;

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const fullFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Today's messages show a time, older ones a date. */
function when(iso: string): string {
  const date = new Date(iso);
  return Date.now() - date.getTime() < 20 * 3_600_000 ? timeFormat.format(date) : dayFormat.format(date);
}

function ConversationRow({ conversation, references, selected, folder }: { conversation: Conversation; references: Record<string, Reference>; selected: boolean; folder: InboxFolder }) {
  const contact = references[conversation.contactId]?.label ?? 'Unknown contact';
  return (
    <li>
      <Link
        to={`/inbox/${conversation.id}?folder=${folder}`}
        aria-current={selected ? 'true' : undefined}
        className="m-stack"
        data-gap="0"
        style={{
          padding: 'var(--m-space-2) var(--m-space-3)',
          color: 'inherit',
          textDecoration: 'none',
          background: selected ? 'var(--m-color-bg-sunken)' : undefined,
          borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)',
        }}
      >
        <span className="m-cluster" data-justify="between" style={{ flexWrap: 'nowrap', gap: 'var(--m-space-2)' }}>
          <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', minInlineSize: 0 }}>
            {conversation.unread ? <span aria-label="Unread" style={{ inlineSize: 8, blockSize: 8, flexShrink: 0, borderRadius: 'var(--m-radius-full)', background: 'var(--m-color-info-border)' }} /> : null}
            <span style={{ fontWeight: conversation.unread ? 'var(--m-font-weight-semibold)' : 'var(--m-font-weight-medium)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact}</span>
          </span>
          <span style={{ ...small, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{when(conversation.lastMessageAt)}</span>
        </span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: conversation.unread ? 'var(--m-font-weight-medium)' : undefined }}>{conversation.subject}</span>
        <span style={{ ...small, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conversation.preview}</span>
      </Link>
    </li>
  );
}

/** A moment as the value a date-and-time picker takes: local time, to the minute. */
function localInput(moment: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}T${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

/** Nine tomorrow morning, where the person is: the usual reason to send later. */
function tomorrowMorning(): string {
  const moment = new Date();
  moment.setDate(moment.getDate() + 1);
  moment.setHours(9, 0, 0, 0);
  return localInput(moment);
}

function MessageBubble({ message, onCancel }: { message: Message; onCancel: () => void }) {
  const mine = message.direction === 'out';
  return (
    <article className="m-stack" data-gap="1" style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <span className="m-cluster" data-gap="2" style={small}>
        <span className="m-avatar" data-size="sm" aria-hidden style={{ '--m-avatar-size-sm': '20px', fontSize: 'var(--m-font-size-xs)' } as CSSProperties}>
          {initials(message.fromName)}
        </span>
        <span style={medium}>{message.fromName}</span>
        <span>{fullFormat.format(new Date(message.sentAt))}</span>
      </span>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          maxInlineSize: 'min(640px, 88%)',
          padding: 'var(--m-space-3) var(--m-space-4)',
          borderRadius: 'var(--m-radius-lg)',
          background: mine ? 'var(--m-color-bg-sunken)' : 'var(--m-color-bg-surface)',
          boxShadow: mine ? undefined : 'var(--m-shadow-sm)',
        }}
      >
        {message.body}
      </div>
      {/* An outgoing message that has not gone yet says so; one that could not go says why. */}
      {message.scheduledFor ? (
        <span className="m-cluster" data-gap="2" style={small}>
          Will be sent {fullFormat.format(new Date(message.scheduledFor))}
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={onCancel}>
            Cancel it
          </button>
        </span>
      ) : message.status === 'queued' ? (
        <span style={small}>{message.problem ? `Not sent yet, trying again: ${message.problem}` : 'Sending…'}</span>
      ) : null}
      {message.status === 'failed' ? (
        <span className="m-field-error" role="alert">
          Not sent{message.problem ? `: ${message.problem}` : '.'}
        </span>
      ) : null}
    </article>
  );
}

/** One thread: who it is with, what it is about, the messages, and the reply box. */
function Thread({ conversationId, onChanged }: { conversationId: string; onChanged: () => void }) {
  const workspace = useWorkspace();
  const { data, error, reload } = useQuery(() => api.getConversation(conversationId), [conversationId, workspace.revision]);
  const templates = useQuery(() => api.listEmailTemplates(), []);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  // Empty until the person asks to send later; then the local date and time they picked.
  const [later, setLater] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  const conversation = data?.conversation.id === conversationId ? data.conversation : undefined;
  const messages = conversation ? (data?.messages ?? []) : [];

  // A different thread starts with an empty reply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the thread changes
  useEffect(() => {
    setReply('');
    setSendError(undefined);
  }, [conversationId]);

  // Opening an unread thread marks it read.
  const unread = conversation?.unread;
  useEffect(() => {
    if (!unread) return;
    void api.updateConversation({ id: conversationId, unread: false }).then(onChanged);
  }, [conversationId, unread, onChanged]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread or its length changes
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [conversationId, messages.length]);

  if (error) {
    return (
      <p className="m-field-error" role="alert" style={{ padding: 'var(--m-space-4)' }}>
        This conversation didn't load: {error.message}
      </p>
    );
  }
  if (!conversation || !data) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', blockSize: '100%' }}>
        <span className="m-spinner" role="status" aria-label="Loading the conversation" />
      </div>
    );
  }

  const contact = data.references[conversation.contactId];
  const company = conversation.companyId ? data.references[conversation.companyId] : undefined;
  const deal = conversation.dealId ? data.references[conversation.dealId] : undefined;
  const contactName = contact?.label ?? 'there';
  const lastInbound = [...messages].reverse().find((message) => message.direction === 'in');

  async function change(changes: { status?: 'open' | 'closed'; assigneeId?: string | null; unread?: boolean }) {
    await api.updateConversation({ id: conversationId, ...changes });
    reload();
    onChanged();
  }

  async function cancel(messageId: string) {
    setSendError(undefined);
    try {
      await api.cancelScheduledReply(messageId);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : 'That email could not be cancelled.');
    }
    reload();
    onChanged();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (reply.trim() === '') return;
    setSending(true);
    setSendError(undefined);
    try {
      // The picker gives a local date and time; it is sent on as the moment that is everywhere.
      await api.sendReply({ conversationId, body: reply, ...(later ? { sendAt: new Date(later).toISOString() } : {}) });
      setReply('');
      setLater(undefined);
      reload();
      onChanged();
      workspace.touch();
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : 'The reply could not be sent.');
    } finally {
      setSending(false);
    }
  }

  function applyTemplate(templateId: string) {
    const template = templates.data?.find((item) => item.id === templateId);
    if (!template) return;
    setReply(template.body.replaceAll('{{firstName}}', contactName.split(' ')[0] ?? contactName).replaceAll('{{myName}}', workspace.currentUser.name.split(' ')[0] ?? workspace.currentUser.name));
  }

  return (
    <div className="m-stack" data-gap="0" style={{ blockSize: '100%', minBlockSize: 0 }}>
      <header className="m-stack" data-gap="2" style={{ padding: 'var(--m-space-3) var(--m-space-4)', borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
        <div className="m-cluster" data-justify="between" data-gap="2">
          <h2 style={{ fontSize: 'var(--m-font-size-lg)', fontWeight: 'var(--m-font-weight-medium)', margin: 0 }}>{conversation.subject}</h2>
          <div className="m-cluster" data-gap="2">
            <label className="m-sr-only" htmlFor="conversation-assignee">
              Assigned to
            </label>
            <select className="m-select" data-size="sm" id="conversation-assignee" value={conversation.assigneeId ?? ''} onChange={(event) => void change({ assigneeId: event.target.value || null })} style={{ inlineSize: 168 }}>
              <option value="">Unassigned</option>
              {workspace.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.id === workspace.currentUser.id ? `${user.name} (you)` : user.name}
                </option>
              ))}
            </select>
            <button type="button" className="m-button" data-size="sm" onClick={() => void change({ unread: true })}>
              <MailOpen size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Mark unread
            </button>
            {conversation.status === 'open' ? (
              <button type="button" className="m-button" data-size="sm" onClick={() => void change({ status: 'closed' })}>
                <Archive size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Close
              </button>
            ) : (
              <button type="button" className="m-button" data-size="sm" onClick={() => void change({ status: 'open' })}>
                <RotateCcw size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Reopen
              </button>
            )}
          </div>
        </div>
        <div className="m-cluster" data-gap="3" style={small}>
          {contact ? (
            <Link to={`/${contact.objectId}/${conversation.contactId}`} className="m-cluster" data-gap="1" style={{ color: 'inherit' }}>
              <User size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden /> {contact.label}
            </Link>
          ) : null}
          {company && conversation.companyId ? (
            <Link to={`/${company.objectId}/${conversation.companyId}`} className="m-cluster" data-gap="1" style={{ color: 'inherit' }}>
              <Building2 size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden /> {company.label}
            </Link>
          ) : null}
          {deal && conversation.dealId ? (
            <Link to={`/${deal.objectId}/${conversation.dealId}`} className="m-cluster" data-gap="1" style={{ color: 'inherit' }}>
              <Handshake size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden /> {deal.label}
            </Link>
          ) : null}
          {conversation.status === 'closed' ? <span className="m-badge">Closed</span> : null}
        </div>
      </header>

      <div style={{ flex: 1, minBlockSize: 0, overflowY: 'auto', padding: 'var(--m-space-4)', background: 'var(--m-color-bg-canvas)' }}>
        <div className="m-stack" data-gap="4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onCancel={() => void cancel(message.id)} />
          ))}
          <div ref={end} />
        </div>
      </div>

      <form onSubmit={send} className="m-stack" data-gap="2" style={{ padding: 'var(--m-space-3) var(--m-space-4)', borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
        <label className="m-sr-only" htmlFor="conversation-reply">
          Reply to {contactName}
        </label>
        <textarea className="m-input" id="conversation-reply" rows={reply ? 7 : 3} placeholder={`Reply to ${contactName}…`} value={reply} onChange={(event) => setReply(event.target.value)} />
        {sendError ? (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {sendError}
          </p>
        ) : null}
        <div className="m-cluster" data-justify="between" data-gap="2">
          <div className="m-cluster" data-gap="2">
            <button
              type="button"
              className="m-button"
              data-size="sm"
              onClick={() =>
                setReply(
                  draftReply({
                    subject: conversation.subject,
                    lastInbound: lastInbound?.body,
                    contactName,
                    myName: workspace.currentUser.name,
                    // When the last word was ours, the useful draft is a nudge, not another answer.
                    awaitingThem: messages[messages.length - 1]?.direction === 'out',
                  }),
                )
              }
            >
              <Sparkles size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Draft a reply
            </button>
            <label className="m-sr-only" htmlFor="conversation-template">
              Use a template
            </label>
            <select
              className="m-select"
              data-size="sm"
              id="conversation-template"
              value=""
              onChange={(event) => applyTemplate(event.target.value)}
              style={{ inlineSize: 168 }}
            >
              <option value="">Use a template…</option>
              {(templates.data ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <div className="m-cluster" data-gap="2">
            {/* Only true on mock data; against the server, Send really sends. */}
            {import.meta.env.VITE_API_URL ? null : <span style={small}>Mock: nothing leaves this browser.</span>}
            {later === undefined ? (
              <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setLater(tomorrowMorning())}>
                Send later
              </button>
            ) : (
              <>
                <label className="m-sr-only" htmlFor="conversation-send-at">
                  When to send it
                </label>
                <input className="m-input" data-size="sm" type="datetime-local" id="conversation-send-at" value={later} min={localInput(new Date())} onChange={(event) => setLater(event.target.value)} style={{ inlineSize: 210 }} />
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setLater(undefined)}>
                  Send now instead
                </button>
              </>
            )}
            <button type="submit" className="m-button" data-variant="primary" data-size="sm" disabled={sending || reply.trim() === '' || later === ''}>
              <Send size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {sending ? 'Sending…' : later === undefined ? 'Send' : 'Schedule'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * The inbox: email threads with contacts, each linked to its contact, company and deal. "Mine" is
 * what is assigned to you; "Unassigned" is the shared queue; replying to an unassigned thread
 * takes it. A sent reply is logged on the contact and the deal.
 */
export function Inbox() {
  const { conversationId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const folder = (FOLDERS.find((item) => item.id === params.get('folder'))?.id ?? 'mine') as InboxFolder;
  // `revision` goes up when the server says something changed, so a new email shows by itself.
  const { touch, revision } = useWorkspace();
  const list = useQuery(() => api.listConversations({ folder, search, page: 1, pageSize: PAGE_SIZE }), [folder, search, version, revision]);
  const counts = useQuery(() => api.inboxCounts(), [version, revision]);

  // Other parts of the page (the sidebar count) re-read when the inbox changes.
  const onChanged = useCallback(() => {
    setVersion((value) => value + 1);
    touch();
  }, [touch]);

  const conversations = list.data?.conversations ?? [];
  const first = conversations[0]?.id;

  // With nothing chosen, open the newest thread in the folder.
  useEffect(() => {
    if (!conversationId && first) navigate(`/inbox/${first}?folder=${folder}`, { replace: true });
  }, [conversationId, first, folder, navigate]);

  return (
    <Page icon={InboxIcon} crumbs={[{ label: 'Inbox' }]} wide>
      <section
        className="m-card"
        aria-label="Inbox"
        style={{ padding: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)', blockSize: 'calc(100vh - 148px)', minBlockSize: 420 }}
      >
        <div className="m-stack" data-gap="0" style={{ minBlockSize: 0, borderInlineEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
          <div className="m-stack" data-gap="2" style={{ padding: 'var(--m-space-2)', borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
            <div className="m-cluster" data-gap="1" role="group" aria-label="Folders">
              {FOLDERS.map((item) => {
                const selected = item.id === folder;
                const count = item.count ? counts.data?.[item.count] : undefined;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="m-button"
                    data-variant="ghost"
                    data-size="sm"
                    aria-pressed={selected}
                    style={selected ? ({ '--m-button-ghost-bg': 'var(--m-button-secondary-bg)' } as CSSProperties) : undefined}
                    onClick={() => navigate(`/inbox?folder=${item.id}`, { replace: true })}
                  >
                    {item.label}
                    {count !== undefined ? <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{count}</span> : null}
                  </button>
                );
              })}
            </div>
            <label className="m-cluster" style={{ flexWrap: 'nowrap', position: 'relative' }}>
              <span className="m-sr-only">Search conversations</span>
              <span aria-hidden style={{ position: 'absolute', insetInlineStart: 'var(--m-space-2)', display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
                <Search size={ICON.button} strokeWidth={ICON.strokeWidth} />
              </span>
              <input className="m-input" data-size="sm" type="search" placeholder="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} style={{ paddingInlineStart: 'calc(var(--m-space-2) * 2 + 14px)', inlineSize: '100%' }} />
            </label>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, minBlockSize: 0, overflowY: 'auto', opacity: list.loading && list.data ? 0.6 : 1 }}>
            {conversations.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} references={list.data?.references ?? {}} selected={conversation.id === conversationId} folder={folder} />
            ))}
            {list.data && conversations.length === 0 ? <li style={{ ...small, padding: 'var(--m-space-6) var(--m-space-3)', textAlign: 'center' }}>{search ? `Nothing here matches "${search}".` : 'Nothing here. You are caught up.'}</li> : null}
            {list.data && list.data.total > conversations.length ? <li style={{ ...small, padding: 'var(--m-space-3)', textAlign: 'center' }}>Showing the newest {conversations.length} of {list.data.total}</li> : null}
          </ul>
        </div>
        <div style={{ minInlineSize: 0, minBlockSize: 0 }}>
          {conversationId ? (
            <Thread conversationId={conversationId} onChanged={onChanged} />
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', blockSize: '100%', ...small }}>{list.data && conversations.length === 0 ? 'No conversation to show.' : 'Choose a conversation.'}</div>
          )}
        </div>
      </section>
    </Page>
  );
}
