import { Eye, Pencil, Plus, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { Directory, Member, Role, RoleSettings, Scope, Team } from '../contracts/team';
import { Modal } from '../ui/Modal';
import { AgentsTab } from './Agents';
import { ICON, figure, initials, medium, plainList, rowDivider, small } from '../ui/styles';

const SCOPE_LABELS: Record<Scope, string> = { none: 'Nothing', own: 'Their own', team: "Their team's", all: 'Everything' };
const TABS = [
  { id: 'people', label: 'People' },
  { id: 'teams', label: 'Teams' },
  { id: 'roles', label: 'Roles' },
  { id: 'agents', label: 'Agents' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function MemberDialog({ member, directory, onClose, onSaved }: { member: Member | 'new'; directory: Directory; onClose: () => void; onSaved: () => void }) {
  const existing = member === 'new' ? undefined : member;
  const [name, setName] = useState(existing?.name ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [roleId, setRoleId] = useState(existing?.roleId ?? 'role_rep');
  const [teamId, setTeamId] = useState(existing?.teamId ?? directory.teams[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      if (existing) await api.updateMember({ id: existing.id, roleId, teamId: teamId || null });
      else await api.inviteMember({ name, email, roleId, teamId: teamId || null });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="sm" title={existing ? existing.name : 'Invite someone'} submitLabel={existing ? 'Save' : 'Send invitation'} busy={busy} error={error} onClose={onClose} onSubmit={save}>
      {existing ? null : (
        <>
          <div className="m-field">
            <label className="m-field-label" htmlFor="member-name">
              Name
            </label>
            <input className="m-input" id="member-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="m-field">
            <label className="m-field-label" htmlFor="member-email">
              Email
            </label>
            <input className="m-input" id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
        </>
      )}
      <div className="m-field">
        <label className="m-field-label" htmlFor="member-role">
          Role
        </label>
        <select className="m-select" id="member-role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          {directory.roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <p className="m-field-hint">{directory.roles.find((role) => role.id === roleId)?.description}</p>
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="member-team">
          Team
        </label>
        <select className="m-select" id="member-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">No team</option>
          {directory.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

/** Take someone's access away, and say who gets everything they own. */
function DeactivateDialog({ member, directory, onClose, onDone }: { member: Member; directory: Directory; onClose: () => void; onDone: (message: string) => void }) {
  const others = directory.members.filter((item) => item.id !== member.id && item.status === 'active');
  const [reassignTo, setReassignTo] = useState(others.find((item) => item.teamId === member.teamId)?.id ?? others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function deactivate() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.deactivateMember({ id: member.id, reassignTo });
      onDone(`${member.name} was deactivated. ${result.reassigned.toLocaleString('en-US')} records moved to ${others.find((item) => item.id === reassignTo)?.name ?? 'the new owner'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be done.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="sm" tone="danger" title={`Deactivate ${member.name}?`} description="They can no longer sign in. Their history stays. Everything they own goes to the person you choose." submitLabel="Deactivate" busy={busy} error={error} onClose={onClose} onSubmit={deactivate}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="deactivate-to">
          Give their contacts, companies, deals and tasks to
        </label>
        <select className="m-select" id="deactivate-to" value={reassignTo} onChange={(event) => setReassignTo(event.target.value)}>
          {others.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

function RoleDialog({ role, onClose, onSaved }: { role: Role | 'new'; onClose: () => void; onSaved: () => void }) {
  const existing = role === 'new' ? undefined : role;
  const [draft, setDraft] = useState<RoleSettings>({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    view: existing?.view ?? 'team',
    edit: existing?.edit ?? 'own',
    delete: existing?.delete ?? 'none',
    manageSettings: existing?.manageSettings ?? false,
    managePeople: existing?.managePeople ?? false,
    exportRecords: existing?.exportRecords ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (changes: Partial<RoleSettings>) => setDraft((previous) => ({ ...previous, ...changes }));

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveRole({ ...draft, id: existing?.id });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The role could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={existing ? `Edit the ${existing.name} role` : 'New role'} submitLabel={existing ? 'Save' : 'Create role'} busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="role-name">
          Name
        </label>
        <input className="m-input" id="role-name" value={draft.name} onChange={(event) => set({ name: event.target.value })} required />
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="role-description">
          What it is for
        </label>
        <input className="m-input" id="role-description" value={draft.description} onChange={(event) => set({ description: event.target.value })} />
      </div>
      <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="m-field-label">Records with an owner</legend>
        {(['view', 'edit', 'delete'] as const).map((action) => (
          <div key={action} className="m-cluster" data-justify="between" data-gap="3">
            <label htmlFor={`role-${action}`}>Can {action === 'view' ? 'see' : action === 'edit' ? 'change' : 'delete'}</label>
            <select className="m-select" data-size="sm" id={`role-${action}`} value={draft[action]} onChange={(event) => set({ [action]: event.target.value as Scope })} style={{ inlineSize: 180 }}>
              {(Object.keys(SCOPE_LABELS) as Scope[]).map((scope) => (
                <option key={scope} value={scope}>
                  {SCOPE_LABELS[scope]}
                </option>
              ))}
            </select>
          </div>
        ))}
        <p className="m-field-hint">Records nobody owns are open to everyone who can see anything.</p>
      </fieldset>
      <fieldset className="m-stack" data-gap="1" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="m-field-label">Also allowed to</legend>
        <label className="m-field" data-layout="inline">
          <input className="m-checkbox" type="checkbox" checked={draft.manageSettings} onChange={(event) => set({ manageSettings: event.target.checked })} /> Change objects and properties
        </label>
        <label className="m-field" data-layout="inline">
          <input className="m-checkbox" type="checkbox" checked={draft.managePeople} onChange={(event) => set({ managePeople: event.target.checked })} /> Manage people, teams and roles
        </label>
        <label className="m-field" data-layout="inline">
          <input className="m-checkbox" type="checkbox" checked={draft.exportRecords} onChange={(event) => set({ exportRecords: event.target.checked })} /> Export records
        </label>
      </fieldset>
    </Modal>
  );
}

function TeamDialog({ team, onClose, onSaved }: { team: Team | 'new'; onClose: () => void; onSaved: () => void }) {
  const existing = team === 'new' ? undefined : team;
  const [name, setName] = useState(existing?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveTeam({ id: existing?.id, name });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The team could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open size="sm" title={existing ? 'Rename team' : 'New team'} submitLabel={existing ? 'Save' : 'Create team'} busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="team-name">
          Name
        </label>
        <input className="m-input" id="team-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
    </Modal>
  );
}

/** Who is in the workspace, how they are grouped, and what each role lets them do. */
export function People() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const directory = useQuery(() => api.getDirectory(), [version]);
  const [memberDialog, setMemberDialog] = useState<Member | 'new'>();
  const [deactivating, setDeactivating] = useState<Member>();
  const [roleDialog, setRoleDialog] = useState<Role | 'new'>();
  const [teamDialog, setTeamDialog] = useState<Team | 'new'>();
  const [agentDialog, setAgentDialog] = useState(false);
  const [notice, setNotice] = useState<string>();
  const tab: Tab = TABS.find((item) => item.id === params.get('tab'))?.id ?? 'people';
  const data = directory.data;
  const canManage = workspace.access.managePeople;

  async function refresh() {
    setVersion((value) => value + 1);
    await workspace.reload();
    workspace.touch();
  }

  async function act(run: () => Promise<unknown>) {
    setNotice(undefined);
    try {
      await run();
      await refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'That could not be done.');
    }
  }

  const add =
    tab === 'people'
      ? { label: 'Invite', icon: UserPlus, onClick: () => setMemberDialog('new') }
      : tab === 'teams'
        ? { label: 'Team', icon: Plus, onClick: () => setTeamDialog('new') }
        : tab === 'agents'
          ? { label: 'Agent', icon: Plus, onClick: () => setAgentDialog(true) }
          : { label: 'Role', icon: Plus, onClick: () => setRoleDialog('new') };

  return (
    <Page
      icon={Users}
      crumbs={[{ label: 'Settings', to: '/settings' }, { label: 'People and permissions' }]}
      actions={
        canManage ? (
          <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={add.onClick}>
            <add.icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {add.label}
          </button>
        ) : null
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-cluster" data-justify="between" data-gap="3">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>People and permissions</h1>
          <div className="m-cluster" data-gap="1" role="group" aria-label="Show">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="m-button"
                data-variant="ghost"
                data-size="sm"
                aria-pressed={tab === item.id}
                style={tab === item.id ? ({ '--m-button-ghost-bg': 'var(--m-button-secondary-bg)' } as CSSProperties) : undefined}
                onClick={() => setParams(item.id === 'people' ? {} : { tab: item.id }, { replace: true })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {!canManage ? (
          <output className="m-alert" data-tone="info">
            <div className="m-alert-content">
              <p className="m-alert-body">As {workspace.access.roleName}, you can see who is here but not change anything.</p>
            </div>
          </output>
        ) : null}
        {notice ? (
          <output className="m-alert" data-tone="info">
            <div className="m-alert-content">
              <p className="m-alert-body">{notice}</p>
            </div>
          </output>
        ) : null}

        {data && tab === 'people' ? (
          <section className="m-card" aria-label="People" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0' } as CSSProperties}>
              <table className="m-table">
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Team</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="m-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((member) => (
                    <tr key={member.id} style={member.status === 'deactivated' ? { color: 'var(--m-color-fg-muted)' } : undefined}>
                      <td>
                        <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
                          <span className="m-avatar" data-size="sm" aria-hidden>
                            {initials(member.name)}
                          </span>
                          <span className="m-stack" data-gap="0">
                            <span style={medium}>
                              {member.name}
                              {member.id === workspace.currentUser.id ? ' (you)' : ''}
                            </span>
                            <span style={small}>{member.email}</span>
                          </span>
                        </span>
                      </td>
                      <td>{data.teams.find((team) => team.id === member.teamId)?.name ?? '—'}</td>
                      <td>{data.roles.find((role) => role.id === member.roleId)?.name ?? '—'}</td>
                      <td>
                        {member.status === 'active' ? (
                          <span className="m-badge" data-tone="success">
                            Active
                          </span>
                        ) : member.status === 'invited' ? (
                          <span className="m-badge" data-tone="info">
                            Invited
                          </span>
                        ) : (
                          <span className="m-badge">Deactivated</span>
                        )}
                      </td>
                      <td>
                        {canManage ? (
                          <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                            {member.status !== 'deactivated' && member.id !== workspace.currentUser.id ? (
                              <button
                                type="button"
                                className="m-button"
                                data-size="sm"
                                title="See the CRM exactly as they do"
                                onClick={() =>
                                  void act(async () => {
                                    await api.viewAs(member.id);
                                  })
                                }
                              >
                                <Eye size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> View as
                              </button>
                            ) : null}
                            {member.status === 'deactivated' ? (
                              <button type="button" className="m-button" data-size="sm" onClick={() => void act(() => api.reactivateMember(member.id))}>
                                Reactivate
                              </button>
                            ) : (
                              <>
                                <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Change ${member.name}'s role or team`} onClick={() => setMemberDialog(member)}>
                                  <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                                </button>
                                {member.id !== workspace.currentUser.id ? (
                                  <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Deactivate ${member.name}`} onClick={() => setDeactivating(member)}>
                                    <UserMinus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                                  </button>
                                ) : null}
                              </>
                            )}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {data && tab === 'teams' ? (
          <section className="m-card" aria-label="Teams" style={{ padding: 0, overflow: 'hidden' }}>
            <ul style={plainList}>
              {data.teams.map((team, index) => {
                const people = data.members.filter((member) => member.teamId === team.id && member.status !== 'deactivated');
                return (
                  <li key={team.id} className="m-cluster" data-gap="3" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : rowDivider) }}>
                    <div className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                      <span style={medium}>{team.name}</span>
                      <span style={small}>{people.length === 0 ? 'Nobody yet' : people.map((member) => member.name).join(', ')}</span>
                    </div>
                    {canManage ? (
                      <>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Rename ${team.name}`} onClick={() => setTeamDialog(team)}>
                          <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Delete ${team.name}`} onClick={() => void act(() => api.deleteTeam(team.id))}>
                          <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {data && tab === 'agents' ? <AgentsTab directory={data} canManage={canManage} creating={agentDialog} onCreated={() => setAgentDialog(false)} /> : null}

        {data && tab === 'roles' ? (
          <section className="m-card" aria-label="Roles" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0' } as CSSProperties}>
              <table className="m-table">
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Can see</th>
                    <th scope="col">Can change</th>
                    <th scope="col">Can delete</th>
                    <th scope="col">Also</th>
                    <th scope="col">People</th>
                    <th scope="col">
                      <span className="m-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.roles.map((role) => {
                    const extras = [role.manageSettings ? 'objects and properties' : '', role.managePeople ? 'people' : '', role.exportRecords ? 'export' : ''].filter(Boolean);
                    return (
                      <tr key={role.id}>
                        <td>
                          <span className="m-stack" data-gap="0">
                            <span style={medium}>{role.name}</span>
                            <span style={small}>{role.description}</span>
                          </span>
                        </td>
                        <td>{SCOPE_LABELS[role.view]}</td>
                        <td>{SCOPE_LABELS[role.edit]}</td>
                        <td>{SCOPE_LABELS[role.delete]}</td>
                        <td style={{ color: 'var(--m-color-fg-muted)' }}>{extras.length > 0 ? extras.join(', ') : '—'}</td>
                        <td data-numeric="">{data.members.filter((member) => member.roleId === role.id && member.status !== 'deactivated').length}</td>
                        <td>
                          {canManage && role.id !== 'role_admin' ? (
                            <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                              <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Edit the ${role.name} role`} onClick={() => setRoleDialog(role)}>
                                <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                              </button>
                              {role.builtIn ? null : (
                                <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Delete the ${role.name} role`} onClick={() => void act(() => api.deleteRole(role.id))}>
                                  <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                                </button>
                              )}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
      {memberDialog && data ? (
        <MemberDialog
          key={memberDialog === 'new' ? 'new' : memberDialog.id}
          member={memberDialog}
          directory={data}
          onClose={() => setMemberDialog(undefined)}
          onSaved={() => {
            setMemberDialog(undefined);
            void refresh();
          }}
        />
      ) : null}
      {deactivating && data ? (
        <DeactivateDialog
          member={deactivating}
          directory={data}
          onClose={() => setDeactivating(undefined)}
          onDone={(message) => {
            setDeactivating(undefined);
            setNotice(message);
            void refresh();
          }}
        />
      ) : null}
      {roleDialog ? (
        <RoleDialog
          key={roleDialog === 'new' ? 'new' : roleDialog.id}
          role={roleDialog}
          onClose={() => setRoleDialog(undefined)}
          onSaved={() => {
            setRoleDialog(undefined);
            void refresh();
          }}
        />
      ) : null}
      {teamDialog ? (
        <TeamDialog
          key={teamDialog === 'new' ? 'new' : teamDialog.id}
          team={teamDialog}
          onClose={() => setTeamDialog(undefined)}
          onSaved={() => {
            setTeamDialog(undefined);
            void refresh();
          }}
        />
      ) : null}
    </Page>
  );
}
