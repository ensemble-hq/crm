import { Bot, Copy, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, useQuery } from '../api';
import type { Agent, AgentReach, Directory } from '../contracts/team';
import { Modal } from '../ui/Modal';
import { formatDate } from '../ui/PropertyValue';
import { ICON, cardTitle, medium, plainList, rowDivider, small } from '../ui/styles';

const REACH: Record<AgentReach, { label: string; detail: string }> = {
  read: { label: 'Look things up', detail: 'It can read what its role reaches and change nothing.' },
  write: { label: 'Create and change', detail: 'It can also create and edit records, notes, tasks and the like. It cannot delete, merge or send email.' },
  everything: { label: 'Everything its role allows', detail: 'It can also delete, merge and send email. Choose this only for an agent you trust to act alone.' },
};

function AgentDialog({ agent, directory, onClose, onSaved }: { agent: Agent | 'new'; directory: Directory; onClose: () => void; onSaved: () => void }) {
  const existing = agent === 'new' ? undefined : agent;
  const [name, setName] = useState(existing?.name ?? '');
  const [roleId, setRoleId] = useState(existing?.roleId ?? directory.roles.find((role) => role.id === 'role_viewer')?.id ?? directory.roles[0]?.id ?? '');
  const [teamId, setTeamId] = useState(existing?.teamId ?? '');
  const [reach, setReach] = useState<AgentReach>(existing?.reach ?? 'read');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveAgent({ id: existing?.id, name, roleId, teamId: teamId || null, reach });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={existing ? `Change ${existing.name}` : 'New agent'} description="An agent is software that works in the CRM under its own name. Its role sets which records it reaches, exactly as for a person." submitLabel={existing ? 'Save' : 'Create agent'} busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="agent-name">
          Name
        </label>
        <input className="m-input" id="agent-name" value={name} placeholder="Research agent" onChange={(event) => setName(event.target.value)} required />
        <p className="m-field-hint">What people will see next to anything it does.</p>
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="agent-role">
          Role
        </label>
        <select className="m-select" id="agent-role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          {directory.roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="agent-team">
          Team
        </label>
        <select className="m-select" id="agent-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">No team</option>
          {directory.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="agent-reach">
          What it may do
        </label>
        <select className="m-select" id="agent-reach" value={reach} onChange={(event) => setReach(event.target.value as AgentReach)}>
          {(Object.keys(REACH) as AgentReach[]).map((id) => (
            <option key={id} value={id}>
              {REACH[id].label}
            </option>
          ))}
        </select>
        <p className="m-field-hint">{REACH[reach].detail}</p>
      </div>
    </Modal>
  );
}

/** The key, shown once, with how to connect an agent using it. */
function NewKey({ created, onDone }: { created: { key: string; agent: string }; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const address = `${window.location.origin}${(import.meta.env.VITE_API_URL as string | undefined) ?? '/api'}/mcp`;
  return (
    <Modal open title={`Key for ${created.agent}`} description="Copy it now. It is not stored and cannot be shown again; if it is lost, revoke it and make another." submitLabel="I have copied it" onClose={onDone} onSubmit={async () => onDone()}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="agent-new-key">
          Key
        </label>
        <div className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
          <input className="m-input" id="agent-new-key" readOnly value={created.key} onFocus={(event) => event.target.select()} style={{ flex: 1, fontFamily: 'var(--m-font-family-mono, monospace)' }} />
          <button
            type="button"
            className="m-button"
            onClick={() => {
              void navigator.clipboard?.writeText(created.key).then(() => setCopied(true));
            }}
          >
            <Copy size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="m-field">
        <span className="m-field-label">To connect an agent over MCP</span>
        <p style={{ ...small, margin: 0 }}>
          Give it this address, and send the key as a bearer token (an <code>Authorization: Bearer</code> header):
        </p>
        <code style={{ wordBreak: 'break-all' }}>{address}</code>
      </div>
    </Modal>
  );
}

/** The agents that work in this CRM: what each may do, and the keys it signs in with. */
export function AgentsTab({ directory, canManage, creating, onCreated }: { directory: Directory; canManage: boolean; creating: boolean; onCreated: () => void }) {
  const [version, setVersion] = useState(0);
  const agents = useQuery(() => api.listAgents(), [version]);
  const [editing, setEditing] = useState<Agent>();
  const [created, setCreated] = useState<{ key: string; agent: string }>();
  const [notice, setNotice] = useState<string>();
  const refresh = () => setVersion((value) => value + 1);

  async function act(run: () => Promise<unknown>) {
    setNotice(undefined);
    try {
      await run();
      refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'That could not be done.');
    }
  }

  return (
    <>
      <p style={{ ...small, margin: 0 }}>
        An agent is software that works in the CRM under its own name: an AI agent connected over MCP, a script, an integration. It is limited by a role like anyone else, and what it does is shown under its name. Only people can create agents and hand out keys.
      </p>
      {notice ? (
        <p className="m-field-error" role="alert" style={{ margin: 0 }}>
          {notice}
        </p>
      ) : null}
      {agents.data?.length === 0 ? <p style={{ margin: 0 }}>No agents yet.</p> : null}
      {(agents.data ?? []).map((agent) => (
        <section key={agent.id} className="m-card" aria-label={agent.name}>
          <div className="m-card-body m-stack" data-gap="3">
            <div className="m-cluster" data-justify="between">
              <div className="m-cluster" data-gap="2">
                <Bot size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
                <h2 style={cardTitle}>{agent.name}</h2>
                <span className="m-badge">{directory.roles.find((role) => role.id === agent.roleId)?.name ?? 'No role'}</span>
                <span className="m-badge" data-tone={agent.reach === 'everything' ? 'warning' : agent.reach === 'write' ? 'info' : undefined}>
                  {REACH[agent.reach].label}
                </span>
              </div>
              {canManage ? (
                <div className="m-cluster" data-gap="1">
                  <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => void act(async () => setCreated({ key: (await api.createAgentKey({ agentId: agent.id, name: `Key ${agent.keys.length + 1}` })).key, agent: agent.name }))}>
                    <KeyRound size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> New key
                  </button>
                  <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Change ${agent.name}`} onClick={() => setEditing(agent)}>
                    <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="m-button"
                    data-variant="ghost"
                    data-size="sm"
                    data-icon-only
                    aria-label={`Remove ${agent.name}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${agent.name}? Its keys stop working at once. What it did keeps its name.`)) void act(() => api.removeAgent(agent.id));
                    }}
                  >
                    <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
            {agent.keys.length === 0 ? (
              <p style={{ ...small, margin: 0 }}>No keys, so it cannot sign in yet.</p>
            ) : (
              <ul style={plainList}>
                {agent.keys.map((key, index) => (
                  <li key={key.id} className="m-cluster" data-justify="between" style={{ paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
                    <span>
                      <span style={medium}>{key.name}</span> <code>{key.prefix}…</code>
                      <span style={{ ...small, marginInlineStart: 'var(--m-space-2)' }}>
                        made {formatDate(key.createdAt)} · {key.lastUsedAt ? `last used ${formatDate(key.lastUsedAt)}` : 'never used'}
                      </span>
                    </span>
                    {canManage ? (
                      <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => void act(() => api.revokeAgentKey(key.id))}>
                        Revoke
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
      {creating || editing ? (
        <AgentDialog
          agent={editing ?? 'new'}
          directory={directory}
          onClose={() => {
            setEditing(undefined);
            onCreated();
          }}
          onSaved={() => {
            setEditing(undefined);
            onCreated();
            refresh();
          }}
        />
      ) : null}
      {created ? <NewKey created={created} onDone={() => setCreated(undefined)} /> : null}
    </>
  );
}
