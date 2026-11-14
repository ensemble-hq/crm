import { ArrowDown, ArrowUp, CheckSquare, Mail, Pause, Pencil, Phone, Play, Plus, Send, Sparkles, Trash2, UserMinus } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import { draftSequence } from '../assistant/mock-engine';
import type { EmailTemplate } from '../contracts/inbox';
import type { Enrollment, Sequence, SequenceStep } from '../contracts/sequences';
import { Modal } from '../ui/Modal';
import { formatDate } from '../ui/PropertyValue';
import { ICON, cardTitle, figure, medium, plainList, rowDivider, small } from '../ui/styles';

const STEP_KINDS: Record<SequenceStep['kind'], { label: string; icon: typeof Mail }> = {
  email: { label: 'Email', icon: Mail },
  call: { label: 'Call', icon: Phone },
  task: { label: 'Task', icon: CheckSquare },
};

const ENROLLMENT_STATUS: Record<Enrollment['status'], { label: string; tone?: 'info' | 'success' | 'warning' }> = {
  active: { label: 'In progress', tone: 'info' },
  replied: { label: 'Replied', tone: 'success' },
  finished: { label: 'Finished' },
  stopped: { label: 'Stopped', tone: 'warning' },
};

function percent(part: number, whole: number): string {
  return whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`;
}

function StatusBadge({ status }: { status: Sequence['status'] }) {
  return status === 'active' ? (
    <span className="m-badge" data-tone="success" data-variant="solid">
      Running
    </span>
  ) : (
    <span className="m-badge">Paused</span>
  );
}

/** Name, subject and body of one saved email. */
function TemplateDialog({ template, onClose, onSaved }: { template: EmailTemplate | 'new'; onClose: () => void; onSaved: () => void }) {
  const existing = template === 'new' ? undefined : template;
  const [name, setName] = useState(existing?.name ?? '');
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [body, setBody] = useState(existing?.body ?? 'Hi {{firstName}},\n\n\n\nBest,\n{{myName}}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveEmailTemplate({ id: existing?.id, name, subject, body });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The template could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="lg" title={existing ? `Edit "${existing.name}"` : 'New template'} submitLabel={existing ? 'Save' : 'Create template'} busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="template-name">
          Name
        </label>
        <input className="m-input" id="template-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="template-subject">
          Subject
        </label>
        <input className="m-input" id="template-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="template-body">
          Message
        </label>
        <textarea className="m-input" id="template-body" rows={10} value={body} onChange={(event) => setBody(event.target.value)} />
        <p className="m-field-hint">
          <code>{'{{firstName}}'}</code> becomes the contact's first name and <code>{'{{myName}}'}</code> the sender's.
        </p>
      </div>
    </Modal>
  );
}

/** Start a sequence from a sentence, or from nothing. */
function NewSequenceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const draft = draftSequence(goal);
      const created = await api.saveSequence({ name: draft.name, status: 'paused', steps: draft.steps.map((step, index) => ({ ...step, id: `s${index + 1}` })) });
      onCreated(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sequence could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="New sequence" description="Say what it is for. The assistant drafts the steps, and you edit them before anyone is enrolled. It starts paused." submitLabel="Draft the sequence" busy={busy} error={error} onClose={onClose} onSubmit={create}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="sequence-goal">
          What is this sequence for?
        </label>
        <textarea className="m-input" id="sequence-goal" rows={3} placeholder="Follow up with people after a demo" value={goal} onChange={(event) => setGoal(event.target.value)} required />
        <p className="m-field-hint">A scripted preview: it recognises follow-ups, demos, renewals and winning back quiet leads.</p>
      </div>
    </Modal>
  );
}

/** Sequences home: every sequence with how it is doing, and the email templates they send. */
export function Sequences() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | 'new'>();
  const [removeError, setRemoveError] = useState<string>();
  const sequences = useQuery(() => api.listSequences(), [version]);
  const templates = useQuery(() => api.listEmailTemplates(), [version]);
  const tab = params.get('tab') === 'templates' ? 'templates' : 'sequences';

  async function removeTemplate(template: EmailTemplate) {
    setRemoveError(undefined);
    try {
      await api.deleteEmailTemplate(template.id);
      setVersion((value) => value + 1);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : 'The template could not be deleted.');
    }
  }

  return (
    <Page
      icon={Send}
      crumbs={[{ label: 'Sequences' }]}
      actions={
        tab === 'sequences' ? (
          <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => setCreating(true)}>
            <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Sequence
          </button>
        ) : (
          <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => setEditing('new')}>
            <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Template
          </button>
        )
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-cluster" data-justify="between" data-gap="3">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>{tab === 'sequences' ? 'Sequences' : 'Email templates'}</h1>
          <div className="m-cluster" data-gap="1" role="group" aria-label="Show">
            {[
              { id: 'sequences', label: 'Sequences' },
              { id: 'templates', label: `Templates${templates.data ? ` ${templates.data.length}` : ''}` },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className="m-button"
                data-variant="ghost"
                data-size="sm"
                aria-pressed={tab === item.id}
                style={tab === item.id ? ({ '--m-button-ghost-bg': 'var(--m-button-secondary-bg)' } as CSSProperties) : undefined}
                onClick={() => setParams(item.id === 'templates' ? { tab: 'templates' } : {}, { replace: true })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'sequences' ? (
          <section className="m-card" aria-label="Sequences" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0' } as CSSProperties}>
              <table className="m-table">
                <thead>
                  <tr>
                    <th scope="col">Sequence</th>
                    <th scope="col">Steps</th>
                    <th scope="col" data-numeric="">
                      Enrolled
                    </th>
                    <th scope="col" data-numeric="">
                      In progress
                    </th>
                    <th scope="col" data-numeric="">
                      Replied
                    </th>
                    <th scope="col" data-numeric="">
                      Reply rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(sequences.data ?? []).map((sequence) => (
                    <tr key={sequence.id}>
                      <td>
                        <span className="m-cluster" data-gap="2">
                          <Link to={`/sequences/${sequence.id}`} style={{ ...medium, color: 'inherit', textDecoration: 'none' }}>
                            {sequence.name}
                          </Link>
                          <StatusBadge status={sequence.status} />
                        </span>
                      </td>
                      <td>
                        <span className="m-cluster" data-gap="1" style={{ color: 'var(--m-color-fg-muted)' }}>
                          {sequence.steps.map((step) => {
                            const Icon = STEP_KINDS[step.kind].icon;
                            return <Icon key={step.id} size={ICON.button} strokeWidth={ICON.strokeWidth} aria-label={STEP_KINDS[step.kind].label} />;
                          })}
                        </span>
                      </td>
                      <td data-numeric="">{sequence.stats.enrolled.toLocaleString('en-US')}</td>
                      <td data-numeric="">{sequence.stats.active.toLocaleString('en-US')}</td>
                      <td data-numeric="">{sequence.stats.replied.toLocaleString('en-US')}</td>
                      <td data-numeric="">{percent(sequence.stats.replied, sequence.stats.enrolled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <>
            {removeError ? (
              <p className="m-field-error" role="alert" style={{ margin: 0 }}>
                {removeError}
              </p>
            ) : null}
            <section className="m-card" aria-label="Templates" style={{ padding: 0, overflow: 'hidden' }}>
              <ul style={plainList}>
                {(templates.data ?? []).map((template, index) => (
                  <li key={template.id} className="m-cluster" data-justify="between" data-gap="3" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : rowDivider) }}>
                    <div className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                      <span style={medium}>{template.name}</span>
                      <span style={{ ...small, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {template.subject ? `${template.subject} · ` : ''}
                        {template.body.replace(/\s+/g, ' ').slice(0, 110)}
                      </span>
                    </div>
                    <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Edit ${template.name}`} onClick={() => setEditing(template)}>
                      <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </button>
                    <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Delete ${template.name}`} onClick={() => void removeTemplate(template)}>
                      <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <p style={{ ...small, margin: 0 }}>Templates are used for replies in the inbox and for the email steps of sequences.</p>
          </>
        )}
      </div>
      {creating ? <NewSequenceDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/sequences/${id}`)} /> : null}
      {editing ? (
        <TemplateDialog
          key={editing === 'new' ? 'new' : editing.id}
          template={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setVersion((value) => value + 1);
          }}
        />
      ) : null}
    </Page>
  );
}

/** One sequence: how it is doing, its steps (editable), and who is in it. */
export function SequenceDetail() {
  const { sequenceId = '' } = useParams();
  const navigate = useNavigate();
  const { touch, revision } = useWorkspace();
  const [version, setVersion] = useState(0);
  const detail = useQuery(() => api.getSequence(sequenceId), [sequenceId, version, revision]);
  const templates = useQuery(() => api.listEmailTemplates(), []);
  const [draft, setDraft] = useState<{ name: string; steps: SequenceStep[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  if (detail.error) return <Navigate to="/sequences" replace />;
  const sequence = detail.data?.sequence.id === sequenceId ? detail.data.sequence : undefined;
  if (!sequence || !detail.data) {
    return (
      <Page icon={Send} crumbs={[{ label: 'Sequences', to: '/sequences' }, { label: 'Sequence' }]}>
        <span className="m-spinner" role="status" aria-label="Loading the sequence" />
      </Page>
    );
  }

  const name = draft?.name ?? sequence.name;
  const steps = draft?.steps ?? sequence.steps;
  const changed = draft !== undefined;
  const edit = (changes: Partial<{ name: string; steps: SequenceStep[] }>) => setDraft({ name, steps, ...changes });
  const setStep = (id: string, changes: Partial<SequenceStep>) => edit({ steps: steps.map((step) => (step.id === id ? { ...step, ...changes } : step)) });

  function move(index: number, by: number) {
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(index + by, 0, moved);
    edit({ steps: next });
  }

  function addStep(kind: SequenceStep['kind']) {
    const id = `s${Date.now().toString(36)}`;
    edit({ steps: [...steps, kind === 'email' ? { id, kind, waitDays: 3, templateId: templates.data?.[0]?.id } : { id, kind, waitDays: 2, title: kind === 'call' ? 'Call to follow up' : 'Check in' }] });
  }

  async function save(status = sequence?.status ?? 'paused') {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveSequence({ id: sequenceId, name, status, steps });
      setDraft(undefined);
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sequence could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function stop(enrollment: Enrollment) {
    await api.stopEnrollment(enrollment.id);
    setVersion((value) => value + 1);
    touch();
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteSequence(sequenceId);
      navigate('/sequences');
    } finally {
      setBusy(false);
    }
  }

  // The day each step lands on, counting from enrolment.
  let day = 1;
  const days = steps.map((step) => {
    day += step.waitDays;
    return day;
  });
  const stats = sequence.stats;

  return (
    <Page
      icon={Send}
      crumbs={[{ label: 'Sequences', to: '/sequences' }, { label: sequence.name }]}
      wide
      actions={
        <>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setConfirming(true)}>
            <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Delete
          </button>
          <button type="button" className="m-button" data-size="sm" disabled={busy} onClick={() => void save(sequence.status === 'active' ? 'paused' : 'active')}>
            {sequence.status === 'active' ? <Pause size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> : <Play size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />}
            {sequence.status === 'active' ? 'Pause' : 'Start'}
          </button>
          <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy || !changed} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-cluster" data-gap="3">
          <label className="m-sr-only" htmlFor="sequence-name">
            Sequence name
          </label>
          <input className="m-input" id="sequence-name" value={name} onChange={(event) => edit({ name: event.target.value })} style={{ ...figure, fontVariantNumeric: 'normal', inlineSize: 'min(480px, 100%)', blockSize: 'auto' }} />
          <StatusBadge status={sequence.status} />
        </div>
        {error ? (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}

        <section className="m-card" aria-label="How it is doing" style={{ padding: 0 }}>
          <div className="m-cluster" data-gap="0" style={{ alignItems: 'stretch' }}>
            {[
              { label: 'Enrolled', value: stats.enrolled.toLocaleString('en-US') },
              { label: 'In progress', value: stats.active.toLocaleString('en-US') },
              { label: 'Replied', value: stats.replied.toLocaleString('en-US'), note: `${percent(stats.replied, stats.enrolled)} of everyone enrolled` },
              { label: 'Finished without a reply', value: stats.finished.toLocaleString('en-US') },
              { label: 'Taken out', value: stats.stopped.toLocaleString('en-US') },
            ].map((item, index) => (
              <div key={item.label} className="m-stack" data-gap="1" style={{ flex: '1 1 150px', padding: 'var(--m-space-3) var(--m-space-4)', borderInlineStart: index === 0 ? undefined : 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
                <span style={{ color: 'var(--m-color-fg-muted)' }}>{item.label}</span>
                <span style={figure}>{item.value}</span>
                {item.note ? <span style={small}>{item.note}</span> : null}
              </div>
            ))}
          </div>
        </section>

        <div className="m-grid" style={{ '--m-layout-grid-min': '420px' } as CSSProperties}>
          <section className="m-card" aria-label="Steps">
            <div className="m-card-body m-stack" data-gap="3">
              <div className="m-stack" data-gap="0">
                <h2 style={cardTitle}>Steps</h2>
                <span style={small}>A contact leaves the sequence as soon as they reply.</span>
              </div>
              <ol className="m-stack" data-gap="0" style={plainList}>
                {steps.map((step, index) => {
                  const Icon = STEP_KINDS[step.kind].icon;
                  return (
                    <li key={step.id} className="m-cluster" data-gap="3" data-align="start" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-3)', ...(index === 0 ? {} : rowDivider) }}>
                      <span style={{ display: 'grid', placeItems: 'center', inlineSize: 32, blockSize: 32, flexShrink: 0, borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-sunken)' }}>
                        <Icon size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
                      </span>
                      <div className="m-stack" data-gap="2" style={{ flex: 1, minInlineSize: 0 }}>
                        <div className="m-cluster" data-gap="2">
                          <span style={medium}>
                            Day {days[index]} · {STEP_KINDS[step.kind].label}
                          </span>
                          <label className="m-cluster" data-gap="1" style={small}>
                            wait
                            <input
                              className="m-input"
                              data-size="sm"
                              type="number"
                              min={0}
                              max={60}
                              aria-label={`Days to wait before step ${index + 1}`}
                              value={step.waitDays}
                              onChange={(event) => setStep(step.id, { waitDays: Math.max(0, Number(event.target.value) || 0) })}
                              style={{ inlineSize: 64 }}
                            />
                            {step.waitDays === 1 ? 'day' : 'days'}
                          </label>
                        </div>
                        {step.kind === 'email' ? (
                          <select className="m-select" data-size="sm" aria-label={`Template for step ${index + 1}`} value={step.templateId ?? ''} onChange={(event) => setStep(step.id, { templateId: event.target.value })}>
                            <option value="" disabled>
                              Choose a template…
                            </option>
                            {(templates.data ?? []).map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.name}
                                {template.subject ? ` · ${template.subject}` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input className="m-input" data-size="sm" aria-label={`What to do in step ${index + 1}`} value={step.title ?? ''} onChange={(event) => setStep(step.id, { title: event.target.value })} />
                        )}
                      </div>
                      <span className="m-cluster" data-gap="0" style={{ flexWrap: 'nowrap' }}>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Move step ${index + 1} down`} disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Remove step ${index + 1}`} onClick={() => edit({ steps: steps.filter((item) => item.id !== step.id) })}>
                          <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div className="m-cluster" data-gap="2">
                <span style={small}>Add a step:</span>
                {(Object.keys(STEP_KINDS) as SequenceStep['kind'][]).map((kind) => {
                  const Icon = STEP_KINDS[kind].icon;
                  return (
                    <button key={kind} type="button" className="m-button" data-size="sm" onClick={() => addStep(kind)}>
                      <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {STEP_KINDS[kind].label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="m-card" aria-label="Enrolled contacts">
            <div className="m-card-body m-stack" data-gap="2">
              <div className="m-cluster" data-justify="between">
                <div className="m-stack" data-gap="0">
                  <h2 style={cardTitle}>Enrolled contacts</h2>
                  <span style={small}>{detail.data.total > detail.data.enrollments.length ? `The most recent ${detail.data.enrollments.length} of ${detail.data.total.toLocaleString('en-US')}` : `${detail.data.total.toLocaleString('en-US')} in all`}</span>
                </div>
                <Link to="/contacts" className="m-button" data-size="sm">
                  <Sparkles size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Enrol from contacts
                </Link>
              </div>
              {detail.data.enrollments.length === 0 ? <p style={{ ...small, margin: 0 }}>Nobody yet. Select contacts in the contacts list and choose “Enrol in sequence”.</p> : null}
              <ul className="m-stack" data-gap="0" style={{ ...plainList, maxBlockSize: 520, overflowY: 'auto' }}>
                {detail.data.enrollments.map((enrollment, index) => {
                  const status = ENROLLMENT_STATUS[enrollment.status];
                  return (
                    <li key={enrollment.id} className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
                      <div className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                        <Link to={`/contacts/${enrollment.contactId}`} style={{ ...medium, color: 'inherit', textDecoration: 'none' }}>
                          {detail.data?.references[enrollment.contactId]?.label ?? 'Unknown contact'}
                        </Link>
                        <span style={small}>
                          Step {Math.min(enrollment.stepsDone + (enrollment.status === 'active' ? 1 : 0), sequence.steps.length)} of {sequence.steps.length}
                          {enrollment.nextRunAt ? ` · next on ${formatDate(enrollment.nextRunAt)}` : ''}
                        </span>
                      </div>
                      <span className="m-badge" data-tone={status.tone} data-variant={status.tone ? 'solid' : undefined}>
                        {status.label}
                      </span>
                      {enrollment.status === 'active' ? (
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Take out of the sequence" title="Take out of the sequence" onClick={() => void stop(enrollment)}>
                          <UserMinus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                      ) : (
                        <span style={{ inlineSize: 28 }} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
        <p style={{ ...small, margin: 0 }}>Mock: the schedule is shown but nothing is sent, and contacts do not move through the steps on their own.</p>
      </div>
      <Modal open={confirming} size="sm" tone="danger" title={`Delete "${sequence.name}"?`} description={`The ${stats.active.toLocaleString('en-US')} contacts in progress stop receiving it. This can't be undone.`} submitLabel="Delete sequence" busy={busy} onClose={() => setConfirming(false)} onSubmit={remove} />
    </Page>
  );
}
