import { Plus, Workflow as WorkflowIcon } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import { draftWorkflow } from '../assistant/mock-engine';
import type { Workflow } from '../contracts/workflows';
import { Modal } from '../ui/Modal';
import { formatDateTime } from '../ui/PropertyValue';
import { ICON, figure, medium, small } from '../ui/styles';
import { workflowSentence } from '../ui/workflowText';

/** Start a workflow from a sentence. It is created switched off, for checking before it runs. */
function NewWorkflowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { objects } = useWorkspace();
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      onCreated((await api.saveWorkflow(draftWorkflow(goal, objects))).id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The workflow could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="New workflow" description="Say what should happen, and when. The assistant builds it, switched off, for you to check and change." submitLabel="Build the workflow" busy={busy} error={error} onClose={onClose} onSubmit={create}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="workflow-goal">
          What should happen?
        </label>
        <textarea className="m-input" id="workflow-goal" rows={3} placeholder="When a deal over $50k is won, create a task to send the welcome pack and notify the owner" value={goal} onChange={(event) => setGoal(event.target.value)} required />
        <p className="m-field-hint">A scripted preview: it recognises records being created, deals being won or lost or changing stage, and tasks, emails, sequences, assignment and notifications.</p>
      </div>
    </Modal>
  );
}

/** Every workflow, as the sentence it amounts to, with a switch to turn it on or off. */
export function Workflows() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const workflows = useQuery(() => api.listWorkflows(), [version, workspace.revision]);
  const templates = useQuery(() => api.listEmailTemplates(), []);
  const sequences = useQuery(() => api.listSequences(), []);

  async function toggle(workflow: Workflow) {
    const { runs: _runs, lastRunAt: _last, ...settings } = workflow;
    await api.saveWorkflow({ ...settings, on: !workflow.on });
    setVersion((value) => value + 1);
  }

  return (
    <Page
      icon={WorkflowIcon}
      crumbs={[{ label: 'Workflows' }]}
      actions={
        <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => setCreating(true)}>
          <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Workflow
        </button>
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-stack" data-gap="1">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>Workflows</h1>
          <p style={{ color: 'var(--m-color-fg-muted)', margin: 0 }}>Things the CRM does by itself when records are created or changed.</p>
        </div>
        <section className="m-card" aria-label="Workflows" style={{ padding: 0, overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {(workflows.data ?? []).map((workflow, index) => (
              <li
                key={workflow.id}
                className="m-cluster"
                data-gap="4"
                style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : { borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }) } as CSSProperties}
              >
                <Link to={`/workflows/${workflow.id}`} className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0, color: 'inherit', textDecoration: 'none' }}>
                  <span style={medium}>{workflow.name}</span>
                  <span style={small}>{workflowSentence(workflow, { object: workspace.object(workflow.objectId), users: workspace.users, templates: templates.data ?? [], sequences: sequences.data ?? [] })}</span>
                </Link>
                <span className="m-stack" data-gap="0" style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {workflow.runs.toLocaleString('en-US')} {workflow.runs === 1 ? 'run' : 'runs'}
                  </span>
                  <span style={small}>{workflow.lastRunAt ? `Last ${formatDateTime(workflow.lastRunAt)}` : 'Never run'}</span>
                </span>
                <label className="m-cluster" data-gap="2" style={{ flexShrink: 0 }}>
                  <input className="m-switch" type="checkbox" role="switch" checked={workflow.on} onChange={() => void toggle(workflow)} aria-label={`${workflow.name}: ${workflow.on ? 'on' : 'off'}`} />
                  <span style={{ ...small, inlineSize: 22 }}>{workflow.on ? 'On' : 'Off'}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <p style={{ ...small, margin: 0 }}>In this mock, workflows that are on really run: move a deal to Closed won on the board and a task appears.</p>
      </div>
      {creating ? <NewWorkflowDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/workflows/${id}`)} /> : null}
    </Page>
  );
}
