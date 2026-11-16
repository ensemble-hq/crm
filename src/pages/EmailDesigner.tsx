import { AlignCenter, AlignLeft, ArrowDown, ArrowUp, Columns2, Copy, GripVertical, Heading, Image, Mail, Megaphone, Minus, Monitor, MousePointerClick, MoveVertical, PenLine, Quote, Redo2, Send, Smartphone, Text, Trash2, Type, Undo2 } from 'lucide-react';
import { Mark } from '../ui/Mark';
import { type CSSProperties, type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { EmailBlock, EmailBlockKind, EmailDesign, EmailTheme } from '../contracts/emailDesign';
import { BLOCK_NAMES, EMAIL_WIDTH, LOOKS, MERGE_FIELDS, STARTERS, blockId, designFromText, fontOf, newBlock, renderBlock, renderEmailHtml, renderEmailText, sampleFill, shades } from '../lib/emailDesign';
import { ICON, cardTitle, figure, medium, small } from '../ui/styles';

/**
 * The email designer. An email is a stack of blocks in a look; you click a block to change it, drag
 * it to move it, or tell the connected model what you want and let it write. The page shows the
 * same HTML that is sent, block by block, so there is no separate preview to trust.
 */

const BLOCK_ICONS: Record<EmailBlockKind, typeof Type> = { header: PenLine, hero: Megaphone, heading: Heading, text: Text, button: MousePointerClick, image: Image, columns: Columns2, callout: Quote, divider: Minus, spacer: MoveVertical, signature: Type };
const PALETTE: EmailBlockKind[] = ['text', 'heading', 'button', 'hero', 'columns', 'callout', 'image', 'header', 'signature', 'divider', 'spacer'];
const WHOLE_IDEAS = ['Make it shorter', 'Warmer and more personal', 'Add one clear call to action', 'Give it a bolder look'];
const BLOCK_IDEAS = ['Shorter', 'Friendlier', 'More formal', 'Punchier'];

type Draft = { name: string; subject: string; design: EmailDesign };
type View = 'design' | 'desktop' | 'phone' | 'text';

const label: CSSProperties = { fontSize: 'var(--m-font-size-xs)', fontWeight: 'var(--m-font-weight-medium)', color: 'var(--m-color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const panel: CSSProperties = { background: 'var(--m-color-bg-surface)', borderRadius: 'var(--m-radius-lg)', boxShadow: 'var(--m-shadow-sm)', padding: 'var(--m-space-4)' };

/** A small picture of an email: the real HTML, scaled down. */
export function EmailThumb({ design, subject, ratio = 1.2 }: { design: EmailDesign; subject?: string; ratio?: number }) {
  const html = useMemo(() => renderEmailHtml(design, { subject, fill: sampleFill }), [design, subject]);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const scale = width / (EMAIL_WIDTH + 24);
  return (
    <div ref={frame} aria-hidden style={{ inlineSize: '100%', blockSize: width * ratio, overflow: 'hidden', background: design.theme.background, pointerEvents: 'none' }}>
      {width > 0 ? <iframe title="" tabIndex={-1} sandbox="" srcDoc={html} style={{ inlineSize: EMAIL_WIDTH + 24, blockSize: (width * ratio) / scale, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} /> : null}
    </div>
  );
}

function Field({ name, children, hint }: { name: string; children: ReactNode; hint?: string }) {
  return (
    <label className="m-stack" data-gap="1">
      <span style={label}>{name}</span>
      {children}
      {hint ? <span style={small}>{hint}</span> : null}
    </label>
  );
}

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: Array<{ id: T; label: ReactNode; title?: string }>; onChange: (value: T) => void }) {
  return (
    <div className="m-stack" data-gap="1">
      <span style={label}>{name}</span>
      <div className="m-cluster" data-gap="1" role="group" aria-label={name}>
        {options.map((option) => (
          <button key={option.id} type="button" className="m-button" data-size="sm" data-variant={value === option.id ? 'secondary' : 'ghost'} aria-pressed={value === option.id} title={option.title} onClick={() => onChange(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A box for words that grows with them. */
function Words({ value, onChange, rows = 3, style, autoFocus, ariaLabel }: { value: string; onChange: (value: string) => void; rows?: number; style?: CSSProperties; autoFocus?: boolean; ariaLabel?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the words
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.blockSize = 'auto';
    element.style.blockSize = `${element.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} className={style ? undefined : 'm-input'} aria-label={ariaLabel} rows={rows} value={value} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} style={{ resize: 'none', overflow: 'hidden', ...style }} />;
}

const ALIGN = [
  { id: 'left' as const, label: <AlignLeft size={ICON.button} strokeWidth={ICON.strokeWidth} aria-label="Left" />, title: 'Left' },
  { id: 'center' as const, label: <AlignCenter size={ICON.button} strokeWidth={ICON.strokeWidth} aria-label="Centre" />, title: 'Centre' },
];

/** The settings of one block. */
function BlockSettings({ block, change }: { block: EmailBlock; change: (changes: Partial<EmailBlock>) => void }) {
  const set = (changes: Record<string, unknown>) => change(changes as Partial<EmailBlock>);
  const fields = (
    <div className="m-cluster" data-gap="1">
      {MERGE_FIELDS.map((field) => (
        <button key={field.token} type="button" className="m-button" data-variant="ghost" data-size="sm" title={`Filled in for each person, like "${field.sample}"`} onClick={() => 'text' in block && set({ text: `${block.text}${field.token}` })}>
          + {field.label}
        </button>
      ))}
    </div>
  );
  switch (block.kind) {
    case 'header':
      return (
        <>
          <Field name="Your name"><input className="m-input" value={block.text} onChange={(event) => set({ text: event.target.value })} /></Field>
          <Field name="Logo address" hint="A web address of a picture. Shown instead of the name."><input className="m-input" placeholder="https://" value={block.logoUrl ?? ''} onChange={(event) => set({ logoUrl: event.target.value || undefined })} /></Field>
        </>
      );
    case 'hero':
      return (
        <>
          <Field name="Headline"><Words rows={2} value={block.heading} onChange={(heading) => set({ heading })} /></Field>
          <Field name="Line under it"><Words rows={2} value={block.text} onChange={(text) => set({ text })} /></Field>
          <Field name="Button"><input className="m-input" placeholder="Leave empty for no button" value={block.buttonLabel ?? ''} onChange={(event) => set({ buttonLabel: event.target.value || undefined })} /></Field>
          {block.buttonLabel ? <Field name="Where the button goes"><input className="m-input" placeholder="https://" value={block.buttonUrl ?? ''} onChange={(event) => set({ buttonUrl: event.target.value })} /></Field> : null}
        </>
      );
    case 'heading':
      return (
        <>
          <Field name="Heading"><Words rows={2} value={block.text} onChange={(text) => set({ text })} /></Field>
          <Choice name="Size" value={block.size} options={[{ id: 'lg', label: 'Large' }, { id: 'md', label: 'Small' }]} onChange={(size) => set({ size })} />
          <Choice name="Lines up" value={block.align} options={ALIGN} onChange={(align) => set({ align })} />
        </>
      );
    case 'text':
      return (
        <>
          <Field name="Text" hint="**bold**, *italic*, [a link](https://…), and “- ” starts a list."><Words rows={6} value={block.text} onChange={(text) => set({ text })} /></Field>
          {fields}
          <Choice name="Lines up" value={block.align} options={ALIGN} onChange={(align) => set({ align })} />
        </>
      );
    case 'button':
      return (
        <>
          <Field name="What it says"><input className="m-input" value={block.label} onChange={(event) => set({ label: event.target.value })} /></Field>
          <Field name="Where it goes"><input className="m-input" placeholder="https://" value={block.url} onChange={(event) => set({ url: event.target.value })} /></Field>
          <Choice name="Lines up" value={block.align} options={ALIGN} onChange={(align) => set({ align })} />
        </>
      );
    case 'image':
      return (
        <>
          <Field name="Picture address" hint="The web address of a picture that is already online."><input className="m-input" placeholder="https://" value={block.url} onChange={(event) => set({ url: event.target.value })} /></Field>
          <Field name="What it shows" hint="Read out to people who cannot see it."><input className="m-input" value={block.alt} onChange={(event) => set({ alt: event.target.value })} /></Field>
          <Field name="Clicking it goes to"><input className="m-input" placeholder="Nowhere" value={block.link ?? ''} onChange={(event) => set({ link: event.target.value || undefined })} /></Field>
        </>
      );
    case 'columns': {
      const setItem = (index: number, changes: Partial<(typeof block.items)[number]>) => set({ items: block.items.map((item, at) => (at === index ? { ...item, ...changes } : item)) });
      return (
        <>
          <Choice name="How many" value={String(block.items.length) as '2' | '3'} options={[{ id: '2', label: 'Two' }, { id: '3', label: 'Three' }]} onChange={(count) => set({ items: count === '2' ? block.items.slice(0, 2) : [...block.items, { heading: 'Third point', text: 'A sentence or two about it.' }].slice(0, 3) })} />
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity beyond their place
            <div key={index} className="m-stack" data-gap="2" style={{ paddingBlockStart: 'var(--m-space-3)', borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
              <Field name={`Column ${index + 1}`}><input className="m-input" value={item.heading} onChange={(event) => setItem(index, { heading: event.target.value })} /></Field>
              <Words rows={2} ariaLabel={`Column ${index + 1} text`} value={item.text} onChange={(text) => setItem(index, { text })} />
              <input className="m-input" aria-label={`Column ${index + 1} link words`} placeholder="Link words (optional)" value={item.linkLabel ?? ''} onChange={(event) => setItem(index, { linkLabel: event.target.value || undefined })} />
              {item.linkLabel ? <input className="m-input" aria-label={`Column ${index + 1} link address`} placeholder="https://" value={item.linkUrl ?? ''} onChange={(event) => setItem(index, { linkUrl: event.target.value })} /> : null}
              <input className="m-input" aria-label={`Column ${index + 1} picture address`} placeholder="Picture address (optional)" value={item.imageUrl ?? ''} onChange={(event) => setItem(index, { imageUrl: event.target.value || undefined })} />
            </div>
          ))}
        </>
      );
    }
    case 'callout':
    case 'signature':
      return (
        <>
          <Field name={block.kind === 'callout' ? 'What stands out' : 'Sign-off'}><Words rows={3} value={block.text} onChange={(text) => set({ text })} /></Field>
          {fields}
        </>
      );
    case 'spacer':
      return <Choice name="How much space" value={block.size} options={[{ id: 'sm', label: 'A little' }, { id: 'md', label: 'Some' }, { id: 'lg', label: 'A lot' }]} onChange={(size) => set({ size })} />;
    case 'divider':
      return <p style={{ ...small, margin: 0 }}>A thin line across the email. There is nothing to set.</p>;
  }
}

function Colour({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} style={{ inlineSize: 28, blockSize: 28, padding: 0, border: 'var(--m-border-width-thin) solid var(--m-color-border-muted)', borderRadius: 'var(--m-radius-md)', background: 'none', cursor: 'pointer' }} />
      <span style={{ fontSize: 'var(--m-font-size-sm)' }}>{name}</span>
    </label>
  );
}

/** The look of the whole email. */
function LookSettings({ design, change }: { design: EmailDesign; change: (design: EmailDesign) => void }) {
  const setTheme = (changes: Partial<EmailTheme>) => change({ ...design, theme: { ...design.theme, ...changes } });
  return (
    <>
      <div className="m-stack" data-gap="2">
        <span style={label}>Looks</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--m-space-2)' }}>
          {LOOKS.map((item) => {
            const chosen = JSON.stringify(item.theme) === JSON.stringify(design.theme);
            return (
              <button key={item.id} type="button" title={item.name} aria-label={`${item.name} look`} aria-pressed={chosen} onClick={() => change({ ...design, theme: { ...item.theme } })} style={{ padding: 0, border: 0, cursor: 'pointer', borderRadius: 'var(--m-radius-md)', overflow: 'hidden', background: item.theme.background, boxShadow: chosen ? '0 0 0 2px var(--m-color-accent)' : '0 0 0 1px var(--m-color-border-muted)' }}>
                <span style={{ display: 'block', margin: '8px 8px 0', padding: '8px 6px 10px', background: item.theme.surface, borderRadius: '4px 4px 0 0' }}>
                  <span style={{ display: 'block', blockSize: 6, inlineSize: '70%', borderRadius: 3, background: item.theme.text }} />
                  <span style={{ display: 'block', blockSize: 8, inlineSize: '45%', marginBlockStart: 6, borderRadius: 4, background: item.theme.accent }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="m-stack" data-gap="2">
        <span style={label}>Colours</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--m-space-2)' }}>
          <Colour name="Buttons" value={design.theme.accent} onChange={(accent) => setTheme({ accent })} />
          <Colour name="Words" value={design.theme.text} onChange={(text) => setTheme({ text })} />
          <Colour name="Email" value={design.theme.surface} onChange={(surface) => setTheme({ surface })} />
          <Colour name="Behind it" value={design.theme.background} onChange={(background) => setTheme({ background })} />
        </div>
      </div>
      <Choice name="Lettering" value={design.theme.font} options={[{ id: 'sans', label: 'Modern' }, { id: 'serif', label: 'Classic' }, { id: 'mono', label: 'Typed' }]} onChange={(font) => setTheme({ font })} />
      <Choice name="Corners" value={design.theme.corners} options={[{ id: 'square', label: 'Square' }, { id: 'soft', label: 'Soft' }, { id: 'round', label: 'Round' }]} onChange={(corners) => setTheme({ corners })} />
      <Field name="Preview line" hint="Shown after the subject in the inbox, before the email is opened.">
        <input className="m-input" value={design.preheader ?? ''} onChange={(event) => change({ ...design, preheader: event.target.value || undefined })} />
      </Field>
    </>
  );
}

/** The box where the model is asked for something. */
function AskModel({ title, placeholder, ideas, busy, onAsk }: { title: string; placeholder: string; ideas: string[]; busy: boolean; onAsk: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const ask = (text: string) => {
    if (!text.trim() || busy) return;
    onAsk(text.trim());
    setPrompt('');
  };
  return (
    <div className="m-stack" data-gap="2">
      <span className="m-cluster" data-gap="1" style={{ ...medium, fontSize: 'var(--m-font-size-sm)' }}>
        <Mark size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden style={{ color: 'var(--m-color-accent-text)' }} /> {title}
      </span>
      <textarea
        className="m-input"
        rows={3}
        aria-label={title}
        placeholder={placeholder}
        value={prompt}
        disabled={busy}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) ask(prompt);
        }}
        style={{ resize: 'vertical' }}
      />
      <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy || !prompt.trim()} onClick={() => ask(prompt)}>
        <Mark size={ICON.button + 2} busy={busy} label={busy ? 'Writing' : undefined} /> {busy ? 'Writing…' : 'Write it'}
      </button>
      <div className="m-cluster" data-gap="1">
        {ideas.map((idea) => (
          <button key={idea} type="button" className="m-badge" disabled={busy} onClick={() => ask(idea)} style={{ cursor: busy ? 'default' : 'pointer', border: 0 }}>
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Where a new email starts: say what you want, or pick a layout. */
function StartScreen({ busy, problem, onAsk, onPick }: { busy: boolean; problem?: string; onAsk: (prompt: string) => void; onPick: (design: EmailDesign) => void }) {
  const [prompt, setPrompt] = useState('');
  const starters = useMemo(() => STARTERS.map((starter) => ({ ...starter, design: starter.build() })), []);
  return (
    <div className="m-stack" data-gap="6" style={{ maxInlineSize: 920, marginInline: 'auto', paddingBlock: 'var(--m-space-6)' }}>
      <div className="m-stack" data-gap="3" style={{ ...panel, padding: 'var(--m-space-6)' }}>
        <h1 style={{ ...figure, margin: 0, fontVariantNumeric: 'normal' }}>What is this email for?</h1>
        <p style={{ ...small, margin: 0 }}>Say it the way you would to a colleague. The model your workspace is connected to writes and lays out a first version, and you change anything you like.</p>
        <textarea className="m-input" rows={3} autoFocus aria-label="What is this email for?" placeholder="A friendly follow-up after a demo, offering a 20 minute call next week to answer questions" value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && prompt.trim()) onAsk(prompt.trim()); }} style={{ resize: 'vertical', fontSize: 'var(--m-font-size-md)' }} />
        {problem ? <ModelProblem problem={problem} /> : null}
        <div className="m-cluster" data-gap="2">
          <button type="button" className="m-button" data-variant="primary" disabled={busy || !prompt.trim()} onClick={() => onAsk(prompt.trim())}>
            <Mark size={ICON.button + 2} busy={busy} label={busy ? 'Writing' : undefined} /> {busy ? 'Writing your email…' : 'Write it for me'}
          </button>
          {['Welcome a new customer and tell them what happens next', 'Announce a new feature to existing customers', 'Win back a deal that has gone quiet'].map((idea) => (
            <button key={idea} type="button" className="m-badge" disabled={busy} onClick={() => setPrompt(idea)} style={{ cursor: 'pointer', border: 0 }}>
              {idea}
            </button>
          ))}
        </div>
      </div>
      <div className="m-stack" data-gap="3">
        <h2 style={{ ...cardTitle, margin: 0 }}>Or start from a layout</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(164px, 1fr))', gap: 'var(--m-space-4)' }}>
          {starters.map((starter) => (
            <button key={starter.id} type="button" disabled={busy} onClick={() => onPick(starter.build())} className="m-stack" data-gap="2" style={{ padding: 0, border: 0, background: 'none', textAlign: 'start', cursor: 'pointer' }}>
              <span style={{ display: 'block', borderRadius: 'var(--m-radius-lg)', overflow: 'hidden', boxShadow: 'var(--m-shadow-sm)' }}>
                <EmailThumb design={starter.design} />
              </span>
              <span style={medium}>{starter.name}</span>
              <span style={small}>{starter.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModelProblem({ problem }: { problem: string }) {
  const unconnected = /no model is connected/i.test(problem);
  return (
    <p role="alert" style={{ margin: 0, fontSize: 'var(--m-font-size-sm)', color: 'var(--m-color-danger-text, var(--m-color-fg-default))' }}>
      {problem} {unconnected ? <Link to="/settings">Open Settings</Link> : null}
    </p>
  );
}

export function EmailDesigner() {
  const { templateId = 'new' } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const isNew = templateId === 'new';
  const templates = useQuery(() => api.listEmailTemplates(), [templateId]);
  const saved = templates.data?.find((template) => template.id === templateId);

  const [draft, setDraft] = useState<Draft>();
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const lastEdit = useRef({ tag: '', at: 0 });
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<View>('design');
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [note, setNote] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string>();
  const [dragging, setDragging] = useState<{ id?: string; kind?: EmailBlockKind }>();
  const [dropAt, setDropAt] = useState<number>();

  // An email that was saved opens as it was; a plain one is laid out as a letter the first time.
  useEffect(() => {
    if (draft || isNew || !saved) return;
    setDraft({ name: saved.name, subject: saved.subject, design: saved.design ?? designFromText(saved.body) });
  }, [draft, isNew, saved]);

  /** Every change goes through here, so it can be undone. Typing in one place counts as one change. */
  function commit(next: Draft, tag = '') {
    if (!draft) return setDraft(next);
    const now = Date.now();
    const sameRun = tag !== '' && tag === lastEdit.current.tag && now - lastEdit.current.at < 1500;
    if (!sameRun) setPast((items) => [...items.slice(-60), draft]);
    lastEdit.current = { tag, at: now };
    setFuture([]);
    setDraft(next);
    setDirty(true);
    setMessage(undefined);
  }
  function undo() {
    const previous = past[past.length - 1];
    if (!previous || !draft) return;
    setPast(past.slice(0, -1));
    setFuture([draft, ...future]);
    setDraft(previous);
    setDirty(true);
    lastEdit.current = { tag: '', at: 0 };
  }
  function redo() {
    const [next, ...rest] = future;
    if (!next || !draft) return;
    setPast([...past, draft]);
    setFuture(rest);
    setDraft(next);
    setDirty(true);
  }

  async function ask(prompt: string, blockId?: string) {
    setAsking(true);
    setProblem(undefined);
    setNote(undefined);
    try {
      const reply = await api.designEmail({ prompt, ...(draft ? { subject: draft.subject, design: draft.design } : {}), ...(blockId ? { blockId } : {}) });
      commit({ name: draft?.name || reply.subject || 'New email', subject: reply.subject, design: reply.design });
      setDirty(true);
      setNote(reply.note);
      if (!blockId) setSelected(undefined);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'The model could not write the email.');
    } finally {
      setAsking(false);
    }
  }

  if (!isNew && templates.data && !saved) return <Navigate to="/sequences?tab=templates" replace />;
  const crumbs = [{ label: 'Sequences', to: '/sequences' }, { label: 'Emails', to: '/sequences?tab=templates' }, { label: draft?.name || (isNew ? 'New email' : 'Email') }];

  if (!draft) {
    return (
      <Page icon={Mail} crumbs={crumbs} wide>
        {isNew ? <StartScreen busy={asking} problem={problem} onAsk={(prompt) => void ask(prompt)} onPick={(design) => { setDraft({ name: '', subject: '', design }); setDirty(true); }} /> : <span className="m-spinner" role="status" aria-label="Loading the email" />}
      </Page>
    );
  }

  const { design } = draft;
  const tone = shades(design.theme);
  const chosen = design.blocks.find((block) => block.id === selected);
  const setDesign = (next: EmailDesign, tag?: string) => commit({ ...draft, design: next }, tag);
  const setBlocks = (blocks: EmailBlock[], tag?: string) => setDesign({ ...design, blocks }, tag);
  const changeBlock = (id: string, changes: Partial<EmailBlock>) => setBlocks(design.blocks.map((block) => (block.id === id ? ({ ...block, ...changes } as EmailBlock) : block)), `block:${id}`);

  function insert(kind: EmailBlockKind, at?: number) {
    const block = newBlock(kind);
    const index = at ?? (chosen ? design.blocks.indexOf(chosen) + 1 : design.blocks.length);
    setBlocks([...design.blocks.slice(0, index), block, ...design.blocks.slice(index)]);
    setSelected(block.id);
  }
  function move(id: string, to: number) {
    const from = design.blocks.findIndex((block) => block.id === id);
    const block = design.blocks[from];
    if (!block) return;
    const rest = design.blocks.filter((item) => item.id !== id);
    const index = Math.max(0, Math.min(rest.length, from < to ? to - 1 : to));
    setBlocks([...rest.slice(0, index), block, ...rest.slice(index)]);
  }
  function duplicate(block: EmailBlock) {
    const copy = { ...structuredClone(block), id: blockId() };
    const index = design.blocks.indexOf(block) + 1;
    setBlocks([...design.blocks.slice(0, index), copy, ...design.blocks.slice(index)]);
    setSelected(copy.id);
  }
  function remove(block: EmailBlock) {
    setBlocks(design.blocks.filter((item) => item.id !== block.id));
    setSelected(undefined);
  }

  function over(event: DragEvent, index: number) {
    if (!dragging) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    const at = dropAt ?? design.blocks.length;
    if (dragging?.id) move(dragging.id, at);
    else if (dragging?.kind) insert(dragging.kind, at);
    setDragging(undefined);
    setDropAt(undefined);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const name = draft.name.trim() || draft.subject.trim() || 'Untitled email';
      const result = await api.saveEmailTemplate({ ...(isNew ? {} : { id: templateId }), name, subject: draft.subject, body: renderEmailText(design), design });
      setDraft({ ...draft, name });
      setDirty(false);
      setMessage('Saved');
      if (isNew) navigate(`/sequences/emails/${result.id}`, { replace: true });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The email could not be saved.');
    } finally {
      setSaving(false);
    }
  }
  async function sendTest() {
    setMessage(undefined);
    try {
      const { to } = await api.sendTestEmail({ subject: draft?.subject ?? '', body: renderEmailText(design), design });
      setMessage(`Test sent to ${to}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The test could not be sent.');
    }
  }

  const views: Array<{ id: View; label: string; icon: typeof Type }> = [
    { id: 'design', label: 'Design', icon: PenLine },
    { id: 'desktop', label: 'Computer', icon: Monitor },
    { id: 'phone', label: 'Phone', icon: Smartphone },
    { id: 'text', label: 'Plain text', icon: Text },
  ];
  const inlineEdit = chosen && (chosen.kind === 'text' || chosen.kind === 'heading' || chosen.kind === 'signature') ? chosen : undefined;
  const footer = { organization: workspace.name, unsubscribeUrl: 'https://example.com/unsubscribe' };

  return (
    <Page
      icon={Mail}
      crumbs={crumbs}
      wide
      actions={
        <>
          {message ? <span role="status" style={small}>{message}</span> : dirty ? <span style={small}>Not saved yet</span> : null}
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Undo" disabled={past.length === 0} onClick={undo}>
            <Undo2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Redo" disabled={future.length === 0} onClick={redo}>
            <Redo2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <button type="button" className="m-button" data-size="sm" onClick={() => void sendTest()}>
            <Send size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Send me a test
          </button>
          <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={saving || (!dirty && !isNew)} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0, 1fr) 296px', gap: 'var(--m-space-4)', alignItems: 'start', padding: 'var(--m-space-3)' }}>
        {/* Left: ask the model, or add a block. */}
        <div className="m-stack" data-gap="4" style={{ position: 'sticky', insetBlockStart: 'var(--m-space-3)' }}>
          <div style={panel}>
            <AskModel title="Ask for changes" placeholder="Make it about our spring offer, and end with a link to book a call" ideas={WHOLE_IDEAS} busy={asking} onAsk={(prompt) => void ask(prompt)} />
            {problem ? <div style={{ marginBlockStart: 'var(--m-space-2)' }}><ModelProblem problem={problem} /></div> : null}
            {note && !problem ? <p style={{ ...small, margin: 'var(--m-space-2) 0 0' }}>{note}</p> : null}
          </div>
          <div className="m-stack" data-gap="2" style={panel}>
            <span style={label}>Add</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--m-space-1)' }}>
              {PALETTE.map((kind) => {
                const Icon = BLOCK_ICONS[kind];
                return (
                  <button key={kind} type="button" className="m-button" data-variant="ghost" data-size="sm" draggable onDragStart={() => setDragging({ kind })} onDragEnd={() => { setDragging(undefined); setDropAt(undefined); }} onClick={() => insert(kind)} title={`Add ${BLOCK_NAMES[kind].toLowerCase()}`} style={{ justifyContent: 'flex-start' }}>
                    <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {BLOCK_NAMES[kind]}
                  </button>
                );
              })}
            </div>
            <span style={small}>Click to add under what is selected, or drag into place.</span>
          </div>
        </div>

        {/* Middle: the email. */}
        <div className="m-stack" data-gap="3" style={{ minInlineSize: 0 }}>
          <div className="m-stack" data-gap="2" style={panel}>
            <input className="m-input" aria-label="Subject" placeholder="Subject" value={draft.subject} onChange={(event) => commit({ ...draft, subject: event.target.value }, 'subject')} style={{ fontSize: 'var(--m-font-size-md)', fontWeight: 'var(--m-font-weight-medium)' }} />
            <div className="m-cluster" data-justify="between" data-gap="2">
              <input className="m-input" data-size="sm" aria-label="Name" placeholder="A name for your team to find it by" value={draft.name} onChange={(event) => commit({ ...draft, name: event.target.value }, 'name')} style={{ flex: '1 1 220px' }} />
              <div className="m-cluster" data-gap="1" role="group" aria-label="How to look at it">
                {views.map((item) => (
                  <button key={item.id} type="button" className="m-button" data-size="sm" data-variant={view === item.id ? 'secondary' : 'ghost'} aria-pressed={view === item.id} onClick={() => setView(item.id)}>
                    <item.icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {view === 'text' ? (
            <pre style={{ ...panel, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--m-font-family-mono, monospace)', fontSize: 'var(--m-font-size-sm)', lineHeight: 1.6 }}>{renderEmailText(design, sampleFill) || 'Nothing yet.'}</pre>
          ) : view !== 'design' ? (
            <div style={{ display: 'grid', placeItems: 'start center', borderRadius: 'var(--m-radius-lg)', background: 'var(--m-color-bg-sunken)', padding: view === 'phone' ? 'var(--m-space-5)' : 0, overflow: 'hidden' }}>
              <iframe title="The email as it arrives" sandbox="" srcDoc={renderEmailHtml(design, { subject: draft.subject, fill: sampleFill, footer })} style={{ inlineSize: view === 'phone' ? 390 : '100%', blockSize: 720, border: 0, borderRadius: view === 'phone' ? 28 : 0, boxShadow: view === 'phone' ? 'var(--m-shadow-lg, var(--m-shadow-sm))' : undefined, background: design.theme.background }} />
            </div>
          ) : (
            // biome-ignore lint/a11y/useKeyWithClickEvents: clicking the empty area only clears the selection
            <div onClick={() => setSelected(undefined)} onDragOver={(event) => dragging && event.preventDefault()} onDrop={drop} style={{ position: 'relative', borderRadius: 'var(--m-radius-lg)', background: design.theme.background, padding: '32px 16px 40px', boxShadow: 'inset 0 0 0 1px var(--m-color-border-muted)', opacity: asking ? 0.55 : 1, transition: 'opacity 200ms' }}>
              <div style={{ maxInlineSize: EMAIL_WIDTH, marginInline: 'auto', background: design.theme.surface, borderRadius: { square: 0, soft: 10, round: 20 }[design.theme.corners], boxShadow: '0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px rgb(0 0 0 / 0.08)' }}>
                {design.blocks.length === 0 ? (
                  <p style={{ margin: 0, padding: '56px 36px', textAlign: 'center', fontFamily: fontOf(design.theme), color: tone.muted }}>Nothing here yet. Add a block from the left, or ask for an email.</p>
                ) : null}
                {design.blocks.map((block, index) => {
                  const isChosen = block.id === selected;
                  const first = index === 0;
                  const last = index === design.blocks.length - 1;
                  const radius = { square: 0, soft: 10, round: 20 }[design.theme.corners];
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: blocks are also reachable through the settings beside them
                    <div
                      key={block.id}
                      data-block={block.id}
                      draggable={!isChosen || !inlineEdit}
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDragging({ id: block.id }); }}
                      onDragEnd={() => { setDragging(undefined); setDropAt(undefined); }}
                      onDragOver={(event) => over(event, index)}
                      onClick={(event) => { event.stopPropagation(); event.preventDefault(); setSelected(block.id); }}
                      style={{ position: 'relative', cursor: isChosen ? 'default' : 'pointer', outline: isChosen ? '2px solid var(--m-color-accent)' : undefined, outlineOffset: -2, borderRadius: first || last ? `${first ? radius : 0}px ${first ? radius : 0}px ${last ? radius : 0}px ${last ? radius : 0}px` : 0, overflow: isChosen ? 'visible' : 'hidden', opacity: dragging?.id === block.id ? 0.4 : 1 }}
                    >
                      {dropAt === index ? <DropLine top /> : null}
                      {dropAt === index + 1 && last ? <DropLine /> : null}
                      {inlineEdit && isChosen ? (
                        <div style={{ padding: inlineEdit.kind === 'heading' ? `${first ? 36 : 16}px 36px ${last ? 36 : 4}px` : `${(first ? 36 : 12) + (inlineEdit.kind === 'signature' ? 4 : 0)}px 36px ${last ? 36 : 12}px` }}>
                          <Words
                            autoFocus
                            rows={1}
                            ariaLabel={BLOCK_NAMES[inlineEdit.kind]}
                            value={inlineEdit.text}
                            onChange={(text) => changeBlock(inlineEdit.id, { text } as Partial<EmailBlock>)}
                            style={{ display: 'block', inlineSize: '100%', margin: 0, padding: 0, border: 0, outline: 'none', background: 'transparent', fontFamily: fontOf(design.theme), color: inlineEdit.kind === 'signature' ? tone.muted : design.theme.text, textAlign: 'align' in inlineEdit ? inlineEdit.align : 'left', ...(inlineEdit.kind === 'heading' ? { fontSize: inlineEdit.size === 'lg' ? 26 : 19, lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.015em' } : { fontSize: inlineEdit.kind === 'signature' ? 15 : 16, lineHeight: inlineEdit.kind === 'signature' ? 1.5 : 1.6 }) }}
                          />
                        </div>
                      ) : (
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', inlineSize: '100%', pointerEvents: 'none' }}>
                          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: produced by renderBlock, which escapes everything typed */}
                          <tbody dangerouslySetInnerHTML={{ __html: renderBlock(block, design.theme, { fill: sampleFill, first, last }) }} />
                        </table>
                      )}
                      {isChosen ? (
                        <div className="m-cluster" data-gap="1" style={{ position: 'absolute', insetBlockStart: -34, insetInlineEnd: 0, zIndex: 2, flexWrap: 'nowrap', padding: 2, borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-surface)', boxShadow: 'var(--m-shadow-md, var(--m-shadow-sm))' }}>
                          <span className="m-cluster" data-gap="1" style={{ ...small, paddingInline: 'var(--m-space-2)', flexWrap: 'nowrap', cursor: 'grab' }}>
                            <GripVertical size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden /> {BLOCK_NAMES[block.kind]}
                          </span>
                          <ToolButton name="Move up" disabled={first} onClick={() => move(block.id, index - 1)}><ArrowUp size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /></ToolButton>
                          <ToolButton name="Move down" disabled={last} onClick={() => move(block.id, index + 2)}><ArrowDown size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /></ToolButton>
                          <ToolButton name="Make a copy" onClick={() => duplicate(block)}><Copy size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /></ToolButton>
                          <ToolButton name="Remove" onClick={() => remove(block)}><Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /></ToolButton>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p style={{ margin: '20px auto 0', maxInlineSize: EMAIL_WIDTH, textAlign: 'center', fontFamily: fontOf(design.theme), fontSize: 12, lineHeight: 1.6, color: tone.outside }}>
                {workspace.name} · your address · Stop getting these emails
                <br />
                <span style={{ opacity: 0.75 }}>Added for you to emails sent by sequences and workflows.</span>
              </p>
              {asking ? (
                <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                  <span className="m-cluster" data-gap="2" style={{ ...panel, padding: 'var(--m-space-3) var(--m-space-4)' }}>
                    <span className="m-spinner" data-size="sm" aria-hidden /> Writing…
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Right: the selected block, or the look. */}
        <div className="m-stack" data-gap="4" style={{ ...panel, position: 'sticky', insetBlockStart: 'var(--m-space-3)', maxBlockSize: 'calc(100vh - 96px)', overflowY: 'auto' }}>
          {chosen ? (
            <>
              <div className="m-cluster" data-justify="between">
                <h2 style={{ ...cardTitle, margin: 0 }}>{BLOCK_NAMES[chosen.kind]}</h2>
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setSelected(undefined)}>
                  The look
                </button>
              </div>
              <BlockSettings block={chosen} change={(changes) => changeBlock(chosen.id, changes)} />
              {chosen.kind !== 'divider' && chosen.kind !== 'spacer' && chosen.kind !== 'image' ? (
                <div style={{ paddingBlockStart: 'var(--m-space-3)', borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
                  <AskModel title="Rewrite this part" placeholder="Mention that onboarding is free" ideas={BLOCK_IDEAS} busy={asking} onAsk={(prompt) => void ask(prompt, chosen.id)} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h2 style={{ ...cardTitle, margin: 0 }}>The look</h2>
              <LookSettings design={design} change={(next) => setDesign(next, 'look')} />
              <p style={{ ...small, margin: 0 }}>Click any part of the email to change it.</p>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

function DropLine({ top = false }: { top?: boolean }) {
  return <div aria-hidden style={{ position: 'absolute', insetInline: 8, [top ? 'insetBlockStart' : 'insetBlockEnd']: -2, blockSize: 4, borderRadius: 2, background: 'var(--m-color-accent)', zIndex: 3, pointerEvents: 'none' }} />;
}

function ToolButton({ name, disabled, onClick, children }: { name: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={name} title={name} disabled={disabled} onClick={(event) => { event.stopPropagation(); onClick(); }}>
      {children}
    </button>
  );
}
