import { ArrowRightLeft, Check, Circle, CircleSlash, Pause, Play, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import { useSharedAssistant } from '../assistant/context';
import type { MigrationRun, MigrationStep, Proposal, StepSpec } from '../contracts/migration';
import { ICON, figure, medium, plainList, rowDivider, small, tabular } from '../ui/styles';

/**
 * Moving in from HubSpot. A move is a list of steps; this page shows the plan, lets it be checked
 * before anything is written, and then shows each step's progress as the worker carries it.
 */

const OPEN = ['draft', 'running', 'paused', 'checked', 'failed'];
const number = (value: number) => value.toLocaleString();

/** What a step has done, in words. */
function tally(step: MigrationStep, checking: boolean): string {
  const { read, created, updated, skipped, failed, warnings } = step.counts;
  if (step.status === 'waiting') return 'Not started';
  if (step.status === 'skipped') return 'Left out';
  const parts = [`${number(read)} read`];
  if (created > 0) parts.push(`${number(created)} ${checking ? 'to add' : 'added'}`);
  if (updated > 0) parts.push(`${number(updated)} ${checking ? 'to bring up to date' : 'brought up to date'}`);
  if (skipped > 0) parts.push(`${number(skipped)} already here or not needed`);
  if (failed > 0) parts.push(`${number(failed)} could not come across`);
  if (warnings > 0) parts.push(`${number(warnings)} to look at`);
  return parts.join(' · ');
}

function StepIcon({ status }: { status: MigrationStep['status'] }) {
  const size = { size: ICON.nav, strokeWidth: ICON.strokeWidth, 'aria-hidden': true } as const;
  if (status === 'running') return <span className="m-spinner" role="status" aria-label="Running" style={{ inlineSize: 16, blockSize: 16 }} />;
  if (status === 'done') return <Check {...size} color="var(--m-color-success-fg)" />;
  if (status === 'failed') return <X {...size} color="var(--m-color-danger-fg)" />;
  if (status === 'skipped') return <CircleSlash {...size} color="var(--m-color-fg-subtle)" />;
  return <Circle {...size} color="var(--m-color-fg-subtle)" />;
}

const STATUS_WORDS: Record<MigrationRun['status'], string> = {
  draft: 'Planned. Nothing has been read or written yet.',
  running: 'Under way.',
  paused: 'Paused. Everything done so far is kept.',
  checked: 'Checked. Nothing has been written. This is what an import would do.',
  done: 'Finished.',
  failed: 'Stopped at a step that failed.',
  cancelled: 'Cancelled.',
};

export function MoveIn() {
  const workspace = useWorkspace();
  const runs = useQuery(() => api.listMigrations(), []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [key, setKey] = useState('');
  const [addPeople, setAddPeople] = useState(true);
  const [adding, setAdding] = useState(false);

  const run = runs.data?.[0];
  const open = run && OPEN.includes(run.status) ? run : undefined;
  const { reload } = runs;
  const running = open?.status === 'running';
  // While a move is under way, read it again every couple of seconds.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, 2_000);
    return () => clearInterval(timer);
  }, [running, reload]);

  if (!workspace.access.manageSettings) return <Navigate to="/settings" replace />;

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setProblem(undefined);
    try {
      await work();
      reload();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  function plan(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      await api.createMigration({ source: 'hubspot', key: key.trim(), addPeople });
      setKey('');
    });
  }

  const shown = open ?? run;
  const checking = shown?.mode === 'check';
  const failedStep = shown?.steps.find((step) => step.status === 'failed');
  const current = shown?.steps.find((step) => step.status === 'running') ?? shown?.steps.find((step) => step.status === 'waiting');
  const finished = shown?.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length ?? 0;

  return (
    <Page icon={ArrowRightLeft} crumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Move in from HubSpot' }]}>
      <div className="m-stack" data-gap="4" style={{ maxInlineSize: 760, marginInline: 'auto', padding: 'var(--m-space-4)' }}>
        <div className="m-stack" data-gap="1">
          <h1 style={{ ...figure, margin: 0, fontVariantNumeric: 'normal' }}>Move in from HubSpot</h1>
          <p style={{ ...small, margin: 0 }}>Brings your people, fields, pipelines, companies, contacts, deals, custom objects and activity history across, one step at a time. You can check what will happen before anything is written, pause at any point, and run it again later without making anything twice.</p>
        </div>

        {problem ? <p role="alert" style={{ ...small, margin: 0, color: 'var(--m-color-danger-fg)' }}>{problem}</p> : null}

        {runs.loading && !runs.data ? <span className="m-spinner" role="status" aria-label="Loading" /> : null}

        {shown ? (
          <>
            <section className="m-card m-stack" data-gap="3" aria-label="Where the move stands" style={{ padding: 'var(--m-space-4)' }}>
              <div className="m-stack" data-gap="1">
                <span style={medium}>{STATUS_WORDS[shown.status]}</span>
                {shown.status === 'running' && current ? <span style={small}>{checking ? 'Checking' : 'Importing'}: step {Math.min(finished + 1, shown.steps.length)} of {shown.steps.length}, {current.title}. You can leave this page; it carries on.</span> : null}
                {shown.status === 'failed' && shown.error ? <span style={{ ...small, color: 'var(--m-color-danger-fg)' }}>{shown.error}</span> : null}
                {shown.status === 'done' ? <span style={small}>The HubSpot key has been forgotten. To bring across what changes in HubSpot after today, plan another move: what is already here is brought up to date, not added again.</span> : null}
              </div>
              {open ? (
                <div className="m-cluster" data-gap="2">
                  {open.status === 'draft' || open.status === 'checked' ? (
                    <>
                      {open.status === 'draft' ? <button type="button" className="m-button" data-variant="primary" disabled={busy} onClick={() => void act(() => api.startMigration({ runId: open.id, mode: 'check' }))}>Check first</button> : null}
                      <button type="button" className="m-button" data-variant={open.status === 'checked' ? 'primary' : undefined} disabled={busy} onClick={() => void act(() => api.startMigration({ runId: open.id, mode: 'import' }))}>
                        <Play size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Import
                      </button>
                    </>
                  ) : null}
                  {open.status === 'running' ? (
                    <button type="button" className="m-button" disabled={busy} onClick={() => void act(() => api.pauseMigration(open.id))}>
                      <Pause size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Pause
                    </button>
                  ) : null}
                  {open.status === 'paused' ? (
                    <button type="button" className="m-button" data-variant="primary" disabled={busy} onClick={() => void act(() => api.startMigration({ runId: open.id, mode: open.mode }))}>
                      <Play size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Carry on
                    </button>
                  ) : null}
                  {open.status === 'failed' && failedStep ? (
                    <>
                      <button type="button" className="m-button" data-variant="primary" disabled={busy} onClick={() => void act(() => api.changeMigrationStep({ runId: open.id, stepId: failedStep.id, action: 'retry' }))}>
                        <RotateCcw size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Try “{failedStep.title}” again
                      </button>
                      {failedStep.required ? null : <button type="button" className="m-button" disabled={busy} onClick={() => void act(() => api.changeMigrationStep({ runId: open.id, stepId: failedStep.id, action: 'skip' }))}>Skip it and carry on</button>}
                    </>
                  ) : null}
                  {open.status === 'failed' && !failedStep ? <button type="button" className="m-button" data-variant="primary" disabled={busy} onClick={() => void act(() => api.startMigration({ runId: open.id, mode: open.mode }))}>Try again</button> : null}
                  <button type="button" className="m-button" data-variant="ghost" disabled={busy} onClick={() => void act(() => api.cancelMigration(open.id))}>Cancel the move</button>
                </div>
              ) : null}
            </section>

            <section className="m-card" aria-label="Steps" style={{ padding: 0, overflow: 'hidden' }}>
              <ol style={plainList}>
                {shown.steps.map((step, index) => (
                  <li key={step.id} style={{ padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : rowDivider) }}>
                    <div className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                      <span style={{ display: 'grid', placeItems: 'center', inlineSize: 20, blockSize: 22, flexShrink: 0 }}><StepIcon status={step.status} /></span>
                      <span className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                        <span className="m-cluster" data-gap="2">
                          <span style={{ ...medium, ...(step.status === 'skipped' ? { color: 'var(--m-color-fg-muted)' } : {}) }}>{step.title}</span>
                          {step.addedBy !== 'plan' ? <span className="m-badge">{step.addedBy === 'step' ? 'Found in your account' : 'Added'}</span> : null}
                        </span>
                        <span style={{ ...small, ...tabular }}>{tally(step, checking)}{step.note && step.status === 'done' ? ` · ${step.note}` : ''}</span>
                        {step.error ? <span style={{ ...small, color: 'var(--m-color-danger-fg)' }}>{step.error}</span> : null}
                        {step.issues.length > 0 ? (
                          <details style={{ marginBlockStart: 'var(--m-space-1)' }}>
                            <summary style={{ ...small, cursor: 'pointer' }}>{step.issues.length === 50 ? 'The first 50 things to know' : `${step.issues.length} ${step.issues.length === 1 ? 'thing' : 'things'} to know`}</summary>
                            <ul style={{ ...small, margin: 'var(--m-space-1) 0 0', paddingInlineStart: 'var(--m-space-4)' }}>
                              {step.issues.map((issue) => (
                                <li key={issue.id}>{issue.message}{issue.sourceId ? ` (HubSpot id ${issue.sourceId})` : ''}</li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </span>
                      {open && !step.required && open.status !== 'running' ? (
                        <span className="m-cluster" data-gap="1" style={{ flexShrink: 0 }}>
                          {step.status === 'waiting' ? <button type="button" className="m-button" data-size="sm" data-variant="ghost" disabled={busy} onClick={() => void act(() => api.changeMigrationStep({ runId: open.id, stepId: step.id, action: 'skip' }))}>Skip</button> : null}
                          {step.status === 'skipped' ? <button type="button" className="m-button" data-size="sm" data-variant="ghost" disabled={busy} onClick={() => void act(() => api.changeMigrationStep({ runId: open.id, stepId: step.id, action: 'restore' }))}>Put back</button> : null}
                          {(step.status === 'waiting' || step.status === 'skipped') && step.addedBy !== 'plan' ? <button type="button" className="m-button" data-size="sm" data-variant="ghost" disabled={busy} onClick={() => void act(() => api.changeMigrationStep({ runId: open.id, stepId: step.id, action: 'remove' }))}>Remove</button> : null}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {open || shown.assessment ? <Assessment run={shown} busy={busy} act={act} /> : null}

            {open ? (
              <section className="m-card m-stack" data-gap="3" aria-label="Something particular to your account" style={{ padding: 'var(--m-space-4)' }}>
                <div className="m-stack" data-gap="1">
                  <span style={medium}>Something particular to your account?</span>
                  <span style={small}>Custom fields and custom objects are found on their own. For anything else, such as tickets, products or an unusual activity type, add a step. The assistant can do this for you: ask it to look at your HubSpot account and add what is missing.</span>
                </div>
                {adding ? <AddStep runId={open.id} busy={busy} onDone={() => setAdding(false)} act={act} /> : (
                  <div>
                    <button type="button" className="m-button" data-size="sm" onClick={() => setAdding(true)}>
                      <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Add a step
                    </button>
                  </div>
                )}
              </section>
            ) : null}
          </>
        ) : null}

        {runs.data && !open ? (
          <form className="m-card m-stack" data-gap="3" onSubmit={plan} style={{ padding: 'var(--m-space-4)' }}>
            {run ? <span style={medium}>Plan another move</span> : null}
            <div className="m-field">
              <label className="m-field-label" htmlFor="hubspot-key">HubSpot private app access token</label>
              <input className="m-input" id="hubspot-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="pat-…" />
              <p style={{ ...small, margin: 0 }}>In HubSpot: Settings, Integrations, Private Apps, Create a private app. Give it read access to contacts, companies, deals, owners, custom objects and schemas, then copy its access token here. It is stored encrypted, only used to read, and forgotten when the import finishes.</p>
            </div>
            <label className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={addPeople} onChange={(event) => setAddPeople(event.target.checked)} style={{ marginBlockStart: 3 }} />
              <span className="m-stack" data-gap="0">
                <span>Add HubSpot users who are not members here</span>
                <span style={small}>They are added as invited members, so the records they own keep their owner. Otherwise those records come across with no owner.</span>
              </span>
            </label>
            <div>
              <button type="submit" className="m-button" data-variant="primary" disabled={busy || key.trim().length < 8}>Plan the move</button>
            </div>
          </form>
        ) : null}

      </div>
    </Page>
  );
}

const KIND_WORDS: Record<Proposal['proposal']['kind'], { label: string; accept: string; accepted: string }> = {
  step: { label: 'Bring across', accept: 'Add to the plan', accepted: 'Added to the plan' },
  setup: { label: 'Set up here', accept: 'Have the assistant set it up', accepted: 'Handed to the assistant' },
  build: { label: 'Needs building', accept: 'We want this', accepted: 'Wanted' },
};

/**
 * The layer on top of the fixed plan: with a model connected, it looks at what else the account
 * has and puts forward additions. Nothing it proposes happens until someone accepts it here.
 */
function Assessment({ run, busy, act }: { run: MigrationRun; busy: boolean; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const settings = useQuery(() => api.getAssistantSettings(), []);
  const assistant = useSharedAssistant();
  const navigate = useNavigate();
  const [looking, setLooking] = useState(false);
  const found = run.assessment;
  const idle = run.status !== 'running';
  const over = !OPEN.includes(run.status);

  async function look() {
    setLooking(true);
    await act(() => api.assessMigration(run.id));
    setLooking(false);
  }

  function accept(item: Proposal) {
    void act(async () => {
      await api.decideMigrationProposal({ runId: run.id, proposalId: item.id, accept: true });
      // Something to set up is the assistant's to do: it plans the changes and asks before making them.
      if (item.proposal.kind === 'setup') {
        assistant.send(item.proposal.prompt);
        navigate('/assistant');
      }
    });
  }

  return (
    <section className="m-card m-stack" data-gap="3" aria-label="What the model makes of your account" style={{ padding: 'var(--m-space-4)' }}>
      <div className="m-stack" data-gap="1">
        <span className="m-cluster" data-gap="2" style={medium}>
          <Sparkles size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden /> Beyond the standard things
        </span>
        <span style={small}>The plan above brings everything HubSpot has as standard, and needs no model. With a model connected, it can also look at what else your account uses, such as tickets, quotes, workflows and forms, and put forward what to bring, what to set up here, and what this CRM would need built. Nothing happens until you accept it.</span>
      </div>
      {over ? null : settings.data && !settings.data.configured ? (
        <span style={small}>No model is connected. <Link to="/settings" style={{ color: 'var(--m-color-accent-text)' }}>Connect one in Settings</Link> to use this.</span>
      ) : (
        <div>
          <button type="button" className="m-button" data-size="sm" disabled={busy || looking || !idle || !settings.data} onClick={() => void look()}>
            {looking ? <span className="m-spinner" aria-hidden style={{ inlineSize: 12, blockSize: 12 }} /> : <Sparkles size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />} {looking ? 'Looking at your account…' : found ? 'Look again' : 'Look at my account'}
          </button>
        </div>
      )}
      {found ? (
        <>
          <p style={{ margin: 0 }}>{found.summary}</p>
          {found.found.length > 0 ? (
            <details>
              <summary style={{ ...small, cursor: 'pointer' }}>What it was shown</summary>
              <ul style={{ ...small, margin: 'var(--m-space-1) 0 0', paddingInlineStart: 'var(--m-space-4)' }}>
                {found.found.map((item) => (
                  <li key={item.area}>{item.label}: {item.count === null ? item.note : `${number(item.count)}${item.more ? ' or more' : ''}`}{item.examples.length > 0 ? `, such as ${item.examples.slice(0, 3).join(', ')}` : ''}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {found.proposals.length === 0 ? <span style={small}>It found nothing that needs more than the plan above.</span> : null}
          <ul style={plainList}>
            {found.proposals.map((item, index) => {
              const words = KIND_WORDS[item.proposal.kind];
              return (
                <li key={item.id} className="m-stack" data-gap="2" style={{ paddingBlock: 'var(--m-space-3)', ...(index === 0 ? {} : rowDivider), ...(item.status === 'dismissed' ? { opacity: 0.55 } : {}) }}>
                  <div className="m-stack" data-gap="1">
                    <span className="m-cluster" data-gap="2">
                      <span style={medium}>{item.proposal.title}</span>
                      <span className="m-badge">{words.label}</span>
                    </span>
                    <span style={small}>{item.proposal.why}</span>
                    {item.proposal.kind === 'build' ? <span style={small}>{item.proposal.brief}</span> : null}
                    {item.proposal.kind === 'setup' ? <span style={small}>It would ask the assistant: “{item.proposal.prompt}”</span> : null}
                    {item.proposal.kind === 'step' && item.proposal.object ? <span style={small}>Adds a new kind of record, {item.proposal.object.plural}, and brings them across with their fields.</span> : null}
                  </div>
                  {item.status === 'proposed' ? (
                    <div className="m-cluster" data-gap="2">
                      <button type="button" className="m-button" data-size="sm" data-variant="primary" disabled={busy || !idle || (over && item.proposal.kind === 'step')} onClick={() => accept(item)}>{words.accept}</button>
                      <button type="button" className="m-button" data-size="sm" data-variant="ghost" disabled={busy || !idle} onClick={() => void act(() => api.decideMigrationProposal({ runId: run.id, proposalId: item.id, accept: false }))}>Not needed</button>
                    </div>
                  ) : (
                    <span style={small}>{item.status === 'accepted' ? words.accepted : 'Not needed'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

const KINDS = [
  { id: 'records', label: 'Records', help: 'Every record of a HubSpot object type, into one kind of record here.' },
  { id: 'fields', label: 'Fields', help: 'The custom fields of a HubSpot object type, as properties here.' },
  { id: 'activities', label: 'Activity', help: 'A HubSpot activity type, logged on the records it is about.' },
] as const;

function AddStep({ runId, busy, onDone, act }: { runId: string; busy: boolean; onDone: () => void; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const workspace = useWorkspace();
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('records');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(workspace.objects[0]?.id ?? '');
  const [as, setAs] = useState<'note' | 'email' | 'call' | 'meeting'>('note');
  const target = workspace.object(to);

  function submit(event: FormEvent) {
    event.preventDefault();
    const type = from.trim();
    const spec: StepSpec = kind === 'activities' ? { kind, from: type, as } : { kind, from: type, to };
    const title = kind === 'activities' ? `${type} as ${as}s` : kind === 'fields' ? `${target?.singular ?? to} fields from ${type}` : `${type} into ${target?.plural.toLowerCase() ?? to}`;
    void act(async () => {
      await api.addMigrationStep({ runId, title: `${title.slice(0, 1).toUpperCase()}${title.slice(1)}`, spec });
      onDone();
    });
  }

  return (
    <form className="m-stack" data-gap="3" onSubmit={submit}>
      <div className="m-cluster" data-gap="1" role="group" aria-label="Kind of step">
        {KINDS.map((item) => (
          <button key={item.id} type="button" className="m-button" data-size="sm" data-variant={item.id === kind ? 'secondary' : 'ghost'} aria-pressed={item.id === kind} onClick={() => setKind(item.id)}>{item.label}</button>
        ))}
      </div>
      <p style={{ ...small, margin: 0 }}>{KINDS.find((item) => item.id === kind)?.help}</p>
      <div className="m-cluster" data-gap="3" style={{ alignItems: 'flex-end' }}>
        <div className="m-field" style={{ flex: 1, minInlineSize: 180 }}>
          <label className="m-field-label" htmlFor="step-from">HubSpot object type</label>
          <input className="m-input" id="step-from" value={from} onChange={(event) => setFrom(event.target.value)} placeholder={kind === 'activities' ? 'tasks, postal_mail…' : 'tickets, products, 2-12345…'} />
        </div>
        {kind === 'activities' ? (
          <div className="m-field" style={{ flex: 1, minInlineSize: 180 }}>
            <label className="m-field-label" htmlFor="step-as">Logged as</label>
            <select className="m-select" id="step-as" value={as} onChange={(event) => setAs(event.target.value as typeof as)}>
              <option value="note">A note</option>
              <option value="call">A call</option>
              <option value="email">An email</option>
              <option value="meeting">A meeting</option>
            </select>
          </div>
        ) : (
          <div className="m-field" style={{ flex: 1, minInlineSize: 180 }}>
            <label className="m-field-label" htmlFor="step-to">Into</label>
            <select className="m-select" id="step-to" value={to} onChange={(event) => setTo(event.target.value)}>
              {workspace.objects.map((object) => (
                <option key={object.id} value={object.id}>{object.plural}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="m-cluster" data-gap="2">
        <button type="submit" className="m-button" data-variant="primary" data-size="sm" disabled={busy || from.trim() === ''}>Add the step</button>
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={onDone}>Never mind</button>
      </div>
    </form>
  );
}
