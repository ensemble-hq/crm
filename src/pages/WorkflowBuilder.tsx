import { Background, Controls, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './workflow-canvas.css';
import { ArrowDown, ArrowUp, Bell, CheckSquare, Filter as FilterIcon, type LucideIcon, Mail, PenLine, Plus, Send, Trash2, Users, Webhook, Workflow as WorkflowIcon, X, Zap } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition, PropertyValue } from '../contracts/metadata';
import type { Action, ActionKind, Trigger, WorkflowSettings } from '../contracts/workflows';
import { Modal } from '../ui/Modal';
import { PropertyInput } from '../ui/PropertyInput';
import { formatDateTime } from '../ui/PropertyValue';
import { describeFilter } from '../ui/filters';
import { ICON, cardTitle, figure, medium, plainList, rowDivider, small } from '../ui/styles';
import { ACTION_LABELS, type WorkflowNames, actionText, newAction, triggerText, workflowSentence } from '../ui/workflowText';
import { FilterDialog } from './FilterDialog';

const ACTION_ICONS: Record<ActionKind, LucideIcon> = {
  'set-property': PenLine,
  'create-task': CheckSquare,
  'send-email': Mail,
  notify: Bell,
  enroll: Send,
  assign: Users,
  webhook: Webhook,
};

/** What is selected on the canvas: the trigger, the conditions, one action, or the "add" node. */
type Selection = 'trigger' | 'conditions' | 'add' | string;

type StepData = { eyebrow: string; text: string; icon: LucideIcon; muted?: boolean; dashed?: boolean };
type StepNode = Node<StepData, 'step'>;

const NODE_WIDTH = 320;
/** Space between one box and the next, where the connector shows. */
const NODE_GAP = 44;

/** How tall a box will be for its text, so boxes can be stacked without measuring them first. */
function boxHeight(text: string): number {
  return 43 + Math.max(1, Math.ceil(text.length / 36)) * 20;
}

/** One box on the canvas. All boxes look alike; the eyebrow says what part of the workflow it is. */
function StepBox({ data, selected }: NodeProps<StepNode>) {
  const Icon = data.icon;
  return (
    <div
      style={{
        inlineSize: NODE_WIDTH,
        padding: 'var(--m-space-3)',
        borderRadius: 'var(--m-radius-lg)',
        background: data.dashed ? 'transparent' : 'var(--m-color-bg-surface)',
        color: 'var(--m-color-fg-default)',
        border: data.dashed ? 'var(--m-border-width-thin) dashed var(--m-color-border-strong)' : 'var(--m-border-width-thin) solid var(--m-color-border-default)',
        boxShadow: selected ? '0 0 0 2px var(--m-color-info-border)' : data.dashed ? 'none' : 'var(--m-shadow-sm)',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
      <div className="m-cluster" data-gap="3" data-align="start" style={{ flexWrap: 'nowrap' }}>
        <span style={{ display: 'grid', placeItems: 'center', inlineSize: 28, blockSize: 28, flexShrink: 0, borderRadius: 'var(--m-radius-md)', background: 'var(--m-color-bg-sunken)' }}>
          <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
        </span>
        <div className="m-stack" data-gap="0" style={{ minInlineSize: 0 }}>
          <span style={{ ...small, textTransform: 'uppercase', letterSpacing: 'var(--m-font-tracking-wide)', fontSize: 'var(--m-font-size-xs)' }}>{data.eyebrow}</span>
          <span style={{ color: data.muted ? 'var(--m-color-fg-muted)' : undefined }}>{data.text}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { step: StepBox };

/** React Flow's own colours, pointed at the design tokens so the canvas follows the theme. */
const flowTheme = {
  '--xy-background-color': 'transparent',
  '--xy-background-pattern-dots-color': 'var(--m-color-border-default)',
  '--xy-edge-stroke': 'var(--m-color-border-strong)',
  '--xy-edge-stroke-width': '2',
  '--xy-controls-button-background-color': 'var(--m-color-bg-surface)',
  '--xy-controls-button-background-color-hover': 'var(--m-color-bg-sunken)',
  '--xy-controls-button-color': 'var(--m-color-fg-default)',
  '--xy-controls-button-color-hover': 'var(--m-color-fg-default)',
  '--xy-controls-button-border-color': 'var(--m-color-border-muted)',
  '--xy-attribution-background-color': 'transparent',
} as CSSProperties;

function capitalize(text: string): string {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

function startingSettings(object: ObjectDefinition | undefined): WorkflowSettings {
  return { name: '', on: false, objectId: object?.id ?? '', trigger: { kind: 'created' }, conditions: [], actions: [] };
}

function TriggerEditor({ settings, object, objects, onChange }: { settings: WorkflowSettings; object: ObjectDefinition; objects: ObjectDefinition[]; onChange: (changes: Partial<WorkflowSettings>) => void }) {
  const trigger = settings.trigger;
  const watchable = object.properties.filter((property) => !property.system);
  const watched = trigger.kind === 'changed' ? object.properties.find((property) => property.id === trigger.property) : undefined;
  const setTrigger = (next: Trigger) => onChange({ trigger: next });
  return (
    <>
      <div className="m-field">
        <label className="m-field-label" htmlFor="workflow-object">
          Watch
        </label>
        <select className="m-select" id="workflow-object" value={settings.objectId} onChange={(event) => onChange({ objectId: event.target.value, trigger: { kind: 'created' }, conditions: [], actions: settings.actions.filter((action) => action.kind !== 'set-property') })}>
          {objects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.plural}
            </option>
          ))}
        </select>
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="workflow-trigger">
          Start when
        </label>
        <select
          className="m-select"
          id="workflow-trigger"
          value={trigger.kind}
          onChange={(event) => setTrigger(event.target.value === 'created' ? { kind: 'created' } : { kind: 'changed', property: watchable.find((property) => property.type === 'select')?.id ?? watchable[0]?.id ?? '' })}
        >
          <option value="created">A {object.singular.toLowerCase()} is created</option>
          <option value="changed">A field on a {object.singular.toLowerCase()} changes</option>
        </select>
      </div>
      {trigger.kind === 'changed' ? (
        <>
          <div className="m-field">
            <label className="m-field-label" htmlFor="workflow-trigger-property">
              Which field
            </label>
            <select className="m-select" id="workflow-trigger-property" value={trigger.property} onChange={(event) => setTrigger({ kind: 'changed', property: event.target.value })}>
              {watchable.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.label}
                </option>
              ))}
            </select>
          </div>
          {watched?.options ? (
            <div className="m-field">
              <label className="m-field-label" htmlFor="workflow-trigger-to">
                Changes to
              </label>
              <select className="m-select" id="workflow-trigger-to" value={trigger.to ?? ''} onChange={(event) => setTrigger({ kind: 'changed', property: trigger.property, to: event.target.value || undefined })}>
                <option value="">Anything</option>
                {watched.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ActionEditor({ action, names, onChange }: { action: Action; names: WorkflowNames; onChange: (action: Action) => void }) {
  switch (action.kind) {
    case 'set-property': {
      const settable = (names.object?.properties ?? []).filter((property) => !property.system && property.type !== 'reference' && property.type !== 'multiselect' && property.id !== names.object?.primaryProperty);
      const property = settable.find((item) => item.id === action.property);
      return (
        <>
          <div className="m-field">
            <label className="m-field-label" htmlFor="action-property">
              Field
            </label>
            <select className="m-select" id="action-property" value={action.property} onChange={(event) => onChange({ ...action, property: event.target.value, value: null })}>
              {settable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {property ? (
            <div className="m-field" data-layout={property.type === 'boolean' ? 'inline' : undefined}>
              <label className="m-field-label" htmlFor="action-value">
                Set it to
              </label>
              <PropertyInput id="action-value" property={property} value={action.value} onChange={(value: PropertyValue) => onChange({ ...action, value })} />
            </div>
          ) : null}
        </>
      );
    }
    case 'create-task':
      return (
        <>
          <div className="m-field">
            <label className="m-field-label" htmlFor="action-title">
              Task
            </label>
            <input className="m-input" id="action-title" value={action.title} onChange={(event) => onChange({ ...action, title: event.target.value })} />
            <p className="m-field-hint">It is given to the record's owner and linked to the record.</p>
          </div>
          <div className="m-field">
            <label className="m-field-label" htmlFor="action-due">
              Due in (days)
            </label>
            <input className="m-input" id="action-due" type="number" min={0} max={90} value={action.dueInDays} onChange={(event) => onChange({ ...action, dueInDays: Math.max(0, Number(event.target.value) || 0) })} />
          </div>
        </>
      );
    case 'send-email':
      return (
        <div className="m-field">
          <label className="m-field-label" htmlFor="action-template">
            Template
          </label>
          <select className="m-select" id="action-template" value={action.templateId} onChange={(event) => onChange({ ...action, templateId: event.target.value })}>
            {names.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <p className="m-field-hint">Sent to the record's contact. Templates are edited under Sequences.</p>
        </div>
      );
    case 'notify':
      return (
        <div className="m-field">
          <label className="m-field-label" htmlFor="action-message">
            Tell the owner
          </label>
          <textarea className="m-input" id="action-message" rows={3} value={action.message} onChange={(event) => onChange({ ...action, message: event.target.value })} />
        </div>
      );
    case 'enroll':
      return (
        <div className="m-field">
          <label className="m-field-label" htmlFor="action-sequence">
            Sequence
          </label>
          <select className="m-select" id="action-sequence" value={action.sequenceId} onChange={(event) => onChange({ ...action, sequenceId: event.target.value })}>
            {names.sequences.map((sequence) => (
              <option key={sequence.id} value={sequence.id}>
                {sequence.name}
              </option>
            ))}
          </select>
        </div>
      );
    case 'assign':
      return (
        <fieldset className="m-stack" data-gap="1" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="m-field-label">Take turns between</legend>
          {names.users.map((user) => (
            <label key={user.id} className="m-field" data-layout="inline">
              <input
                className="m-checkbox"
                type="checkbox"
                checked={action.userIds.includes(user.id)}
                onChange={(event) => {
                  const next = event.target.checked ? [...action.userIds, user.id] : action.userIds.filter((id) => id !== user.id);
                  // At least one person has to stay in the rota.
                  if (next.length > 0) onChange({ ...action, userIds: next });
                }}
              />
              {user.name}
            </label>
          ))}
        </fieldset>
      );
    case 'webhook':
      return (
        <div className="m-field">
          <label className="m-field-label" htmlFor="action-url">
            Address
          </label>
          <input className="m-input" id="action-url" type="url" value={action.url} onChange={(event) => onChange({ ...action, url: event.target.value })} />
          <p className="m-field-hint">The record is posted there as JSON. In this mock nothing is sent.</p>
        </div>
      );
  }
}

/**
 * Build a workflow on a canvas. The canvas shows the flow top to bottom: what starts it, what it
 * checks, and what it does. Click a box to change it in the panel beside. Workflows are a straight
 * line today; the canvas is the place branches will go.
 */
export function WorkflowBuilder() {
  const { workflowId } = useParams();
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const isNew = !workflowId || workflowId === 'new';
  const [version, setVersion] = useState(0);
  const detail = useQuery(() => (isNew ? Promise.resolve(undefined) : api.getWorkflow(workflowId)), [workflowId, version, workspace.revision]);
  const templates = useQuery(() => api.listEmailTemplates(), []);
  const sequences = useQuery(() => api.listSequences(), []);
  const [draft, setDraft] = useState<WorkflowSettings>();
  const [selected, setSelected] = useState<Selection>();
  const [filterIndex, setFilterIndex] = useState<number | 'new'>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const saved = !isNew && detail.data?.workflow.id === workflowId ? detail.data.workflow : undefined;
  const importable = workspace.objects.filter((object) => !object.completion);
  const settings: WorkflowSettings | undefined = draft ?? saved ?? (isNew ? startingSettings(importable[0]) : undefined);
  const object = workspace.object(settings?.objectId);
  const names = useMemo<WorkflowNames>(() => ({ object, users: workspace.users, templates: templates.data ?? [], sequences: sequences.data ?? [] }), [object, workspace.users, templates.data, sequences.data]);
  const conditionKey = JSON.stringify(settings?.conditions ?? []);
  const matching = useQuery(() => (settings && object ? api.countWorkflowMatches({ objectId: settings.objectId, conditions: settings.conditions }) : Promise.resolve(undefined)), [settings?.objectId, conditionKey]);

  const { nodes, edges } = useMemo(() => {
    if (!settings) return { nodes: [] as StepNode[], edges: [] as Edge[] };
    const steps: Array<{ id: string; data: StepData }> = [
      { id: 'trigger', data: { eyebrow: 'When', text: capitalize(triggerText(settings.trigger, object)), icon: Zap } },
      {
        id: 'conditions',
        data: {
          eyebrow: 'Only if',
          text: settings.conditions.length === 0 || !object ? 'Always' : settings.conditions.map((condition) => describeFilter(condition, object, workspace.users)).join(' and '),
          icon: FilterIcon,
          muted: settings.conditions.length === 0,
        },
      },
      ...settings.actions.map((action, index) => ({ id: action.id, data: { eyebrow: index === 0 ? 'Then' : 'And then', text: capitalize(actionText(action, names)), icon: ACTION_ICONS[action.kind] } })),
      { id: 'add', data: { eyebrow: settings.actions.length === 0 ? 'Then' : 'And then', text: 'Add an action', icon: Plus, muted: true, dashed: true } },
    ];
    let y = 0;
    const placed = steps.map((step): StepNode => {
      const node: StepNode = { id: step.id, type: 'step', position: { x: 0, y }, data: step.data, selected: step.id === selected, draggable: false };
      y += boxHeight(step.data.text) + NODE_GAP;
      return node;
    });
    return {
      nodes: placed,
      edges: steps.slice(1).map((step, index): Edge => ({ id: `${steps[index]?.id}-${step.id}`, source: steps[index]?.id ?? '', target: step.id, type: 'straight', selectable: false, markerEnd: { type: MarkerType.ArrowClosed } })),
    };
  }, [settings, object, names, workspace.users, selected]);

  if (!isNew && detail.error) return <Navigate to="/workflows" replace />;
  if (!settings || !object) {
    return (
      <Page icon={WorkflowIcon} crumbs={[{ label: 'Workflows', to: '/workflows' }, { label: 'Workflow' }]}>
        <span className="m-spinner" role="status" aria-label="Loading the workflow" />
      </Page>
    );
  }

  const set = (changes: Partial<WorkflowSettings>) => setDraft({ ...settings, ...changes });
  const changed = draft !== undefined;
  const selectedAction = settings.actions.find((action) => action.id === selected);
  const selectedIndex = settings.actions.findIndex((action) => action.id === selected);

  function moveAction(by: number) {
    const next = [...(settings?.actions ?? [])];
    const [moved] = next.splice(selectedIndex, 1);
    if (moved) next.splice(selectedIndex + by, 0, moved);
    set({ actions: next });
  }

  async function save(on = settings?.on ?? false) {
    if (!settings) return;
    if (settings.name.trim() === '') {
      setError('Give the workflow a name.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.saveWorkflow({ ...settings, on, id: saved?.id });
      setDraft(undefined);
      if (isNew) navigate(`/workflows/${result.id}`, { replace: true });
      else setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The workflow could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!saved) return;
    setBusy(true);
    try {
      await api.deleteWorkflow(saved.id);
      navigate('/workflows');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      icon={WorkflowIcon}
      crumbs={[{ label: 'Workflows', to: '/workflows' }, { label: isNew ? 'New workflow' : saved?.name || 'Workflow' }]}
      wide
      actions={
        <>
          {saved ? (
            <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setConfirming(true)}>
              <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Delete
            </button>
          ) : null}
          <label className="m-cluster" data-gap="2">
            <input className="m-switch" type="checkbox" role="switch" checked={settings.on} disabled={busy} onChange={(event) => void save(event.target.checked)} aria-label={settings.on ? 'Workflow is on' : 'Workflow is off'} />
            <span style={small}>{settings.on ? 'On' : 'Off'}</span>
          </label>
          <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy || (!changed && !isNew)} onClick={() => void save()}>
            {busy ? 'Saving…' : isNew ? 'Save workflow' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="m-stack" data-gap="3">
        <div className="m-stack" data-gap="1">
          <label className="m-sr-only" htmlFor="workflow-name">
            Workflow name
          </label>
          <input className="m-input" id="workflow-name" placeholder="Name this workflow" value={settings.name} onChange={(event) => set({ name: event.target.value })} style={{ ...figure, fontVariantNumeric: 'normal', inlineSize: 'min(560px, 100%)', blockSize: 'auto' }} />
          <p style={{ color: 'var(--m-color-fg-muted)', margin: 0 }}>{workflowSentence(settings, names)}</p>
        </div>
        {error ? (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}

        <section className="m-card" aria-label="Workflow" style={{ padding: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', blockSize: 'calc(100vh - 250px)', minBlockSize: 460 }}>
          <div style={{ minInlineSize: 0, background: 'var(--m-color-bg-sunken)' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelected(node.id)}
              onPaneClick={() => setSelected(undefined)}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
              panOnScroll
              zoomOnDoubleClick={false}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.4}
              maxZoom={1.5}
              style={flowTheme}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <aside aria-label="Details" className="m-stack" data-gap="3" style={{ minBlockSize: 0, overflowY: 'auto', padding: 'var(--m-space-4)', borderInlineStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
            {selected === 'trigger' ? (
              <>
                <h2 style={cardTitle}>When</h2>
                <TriggerEditor settings={settings} object={object} objects={importable} onChange={set} />
              </>
            ) : selected === 'conditions' ? (
              <>
                <h2 style={cardTitle}>Only if</h2>
                <p style={{ ...small, margin: 0 }}>The workflow only runs for a {object.singular.toLowerCase()} that passes every condition.</p>
                <div className="m-cluster" data-gap="1">
                  {settings.conditions.map((condition, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no identity beyond their position
                    <span key={index} className="m-badge" style={{ gap: 'var(--m-space-1)' }}>
                      <button type="button" onClick={() => setFilterIndex(index)} style={{ all: 'unset', cursor: 'pointer' }}>
                        {describeFilter(condition, object, workspace.users)}
                      </button>
                      <button type="button" aria-label="Remove this condition" onClick={() => set({ conditions: settings.conditions.filter((_, position) => position !== index) })} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}>
                        <X size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
                      </button>
                    </span>
                  ))}
                  <button type="button" className="m-button" data-size="sm" onClick={() => setFilterIndex('new')}>
                    <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Condition
                  </button>
                </div>
                {matching.data ? (
                  <p style={{ ...small, margin: 0 }}>
                    {matching.data.matching.toLocaleString('en-US')} of {matching.data.total.toLocaleString('en-US')} {object.plural.toLowerCase()} pass right now.
                  </p>
                ) : null}
              </>
            ) : selected === 'add' ? (
              <>
                <h2 style={cardTitle}>Add an action</h2>
                <div className="m-stack" data-gap="1">
                  {(Object.keys(ACTION_LABELS) as ActionKind[]).map((kind) => {
                    const Icon = ACTION_ICONS[kind];
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="m-button"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => {
                          const action = newAction(kind, names);
                          set({ actions: [...settings.actions, action] });
                          setSelected(action.id);
                        }}
                      >
                        <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {ACTION_LABELS[kind]}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : selectedAction ? (
              <>
                <div className="m-cluster" data-justify="between">
                  <h2 style={cardTitle}>{ACTION_LABELS[selectedAction.kind]}</h2>
                  <span className="m-cluster" data-gap="0">
                    <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Move this action earlier" disabled={selectedIndex === 0} onClick={() => moveAction(-1)}>
                      <ArrowUp size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </button>
                    <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Move this action later" disabled={selectedIndex === settings.actions.length - 1} onClick={() => moveAction(1)}>
                      <ArrowDown size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="m-button"
                      data-variant="ghost"
                      data-size="sm"
                      data-icon-only
                      aria-label="Remove this action"
                      onClick={() => {
                        set({ actions: settings.actions.filter((action) => action.id !== selectedAction.id) });
                        setSelected(undefined);
                      }}
                    >
                      <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </button>
                  </span>
                </div>
                <ActionEditor action={selectedAction} names={names} onChange={(next) => set({ actions: settings.actions.map((action) => (action.id === next.id ? next : action)) })} />
              </>
            ) : (
              <>
                <h2 style={cardTitle}>Recent runs</h2>
                {isNew ? <p style={{ ...small, margin: 0 }}>Click a box on the canvas to set it up. The workflow runs once it is saved and switched on.</p> : null}
                {saved && detail.data?.runs.length === 0 ? <p style={{ ...small, margin: 0 }}>It has not run yet. Click a box on the canvas to change it.</p> : null}
                <ul className="m-stack" data-gap="0" style={plainList}>
                  {(saved ? (detail.data?.runs ?? []) : []).map((run, index) => (
                    <li key={run.id} className="m-stack" data-gap="1" style={{ paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
                      <div className="m-cluster" data-justify="between" style={{ flexWrap: 'nowrap', gap: 'var(--m-space-2)' }}>
                        <Link to={`/${detail.data?.references[run.recordId]?.objectId ?? object.id}/${run.recordId}`} style={{ ...medium, color: 'inherit', textDecoration: 'none', minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {detail.data?.references[run.recordId]?.label ?? 'A deleted record'}
                        </Link>
                        {run.status === 'failed' ? (
                          <span className="m-badge" data-tone="danger">
                            Failed
                          </span>
                        ) : null}
                      </div>
                      <span style={small}>{formatDateTime(run.startedAt)}</span>
                      {run.steps.map((step) => (
                        <span key={step} style={small}>
                          · {step}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </section>
      </div>
      {filterIndex !== undefined ? (
        <FilterDialog
          object={object}
          initial={filterIndex === 'new' ? undefined : settings.conditions[filterIndex]}
          onClose={() => setFilterIndex(undefined)}
          onSave={(filter) => {
            set({ conditions: filterIndex === 'new' ? [...settings.conditions, filter] : settings.conditions.map((item, position) => (position === filterIndex ? filter : item)) });
            setFilterIndex(undefined);
          }}
        />
      ) : null}
      <Modal open={confirming} size="sm" tone="danger" title={`Delete "${saved?.name ?? ''}"?`} description="It stops running. Its history of past runs is removed too. This can't be undone." submitLabel="Delete workflow" busy={busy} onClose={() => setConfirming(false)} onSubmit={remove} />
    </Page>
  );
}
