import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuditCheck, AuditPage } from '../../src/contracts/audit';
import type { CrmRecord, Workspace } from '../../src/contracts/records';
import type { Agent } from '../../src/contracts/team';
import { type Crm, FEMI, JONAS, MAYA, PRIYA, refusal, startCrm } from './harness';

let crm: Crm;
let agent: Agent;
let key: string;
const asAgent = <T>(operation: string, input?: unknown) => crm.call<T>(agent.id, operation, input, 'api-key');
const log = async (query: Record<string, unknown> = {}) => (await crm.call<AuditPage>(MAYA, 'audit.list', { page: 1, pageSize: 100, ...query })).entries;

beforeAll(async () => {
  crm = await startCrm();
});

describe('agents', () => {
  it('are created, and given keys, only by people who manage people', async () => {
    expect(await refusal(crm.call(JONAS, 'agents.save', { name: 'X', roleId: 'role_rep', teamId: null, reach: 'read' }))).toMatch(/can't set up agents/);
    agent = await crm.call<Agent>(MAYA, 'agents.save', { name: 'Research agent', roleId: 'role_rep', teamId: 'team_new', reach: 'read' });
    const made = await crm.call<{ id: string; key: string; prefix: string }>(MAYA, 'agents.createKey', { agentId: agent.id, name: 'Laptop' });
    key = made.key;
    const listed = JSON.stringify(await crm.call(MAYA, 'agents.list'));
    expect(listed).toContain(made.prefix);
    expect(listed).not.toContain(key);
    const [stored] = await crm.rows<{ hashed_key: string }>(sql`select hashed_key from api_keys`);
    expect(stored?.hashed_key).not.toContain(key.slice(-12));
  });

  it('sign in with their key, as themselves', async () => {
    expect((await crm.services.agents.verify(key)).userId).toBe(agent.id);
    await expect(crm.services.agents.verify('ak_crm_nope_nope')).rejects.toThrow();
    const workspace = await asAgent<Workspace>('workspace.get');
    expect(workspace.currentUserId).toBe(agent.id);
    expect(workspace.users.find((user) => user.id === agent.id)?.kind).toBe('agent');
  });

  it('are held to what they were set up to do, on top of their role', async () => {
    const create = () => asAgent<CrmRecord>('records.create', { objectId: 'contacts', properties: { name: 'By Agent', email: 'by.agent@example.com', owner: agent.id } });
    expect(await refusal(create())).toBe('This agent may only look things up. A person who manages people can change that.');
    await crm.call(MAYA, 'agents.save', { id: agent.id, name: agent.name, roleId: 'role_rep', teamId: 'team_new', reach: 'write' });
    const made = await create();
    expect(await refusal(asAgent('records.delete', [made.id]))).toMatch(/may create and change things, but not delete/);
    // Its role still applies: a sales rep cannot edit someone else's record.
    const theirs = await crm.seed('deals', { name: 'Not the agent\'s', owner: PRIYA, stage: 'qualified' });
    expect(await refusal(asAgent('records.update', { id: theirs, properties: { priority: 'high' } }))).toBe('As Sales rep, you can only edit deals you own.');
  });

  it('can never manage people, agents, keys or the assistant, whatever their role', async () => {
    await crm.call(MAYA, 'agents.save', { id: agent.id, name: agent.name, roleId: 'role_admin', teamId: null, reach: 'everything' });
    expect(await refusal(asAgent('people.invite', { name: 'P', email: 'p@example.com', roleId: 'role_admin', teamId: null }))).toMatch(/An agent can't invite people/);
    expect(await refusal(asAgent('agents.createKey', { agentId: agent.id, name: 'self' }))).toBe('That is for people to do, not agents.');
    expect(await refusal(asAgent('assistant.settings'))).toBe('That is for people to do, not agents.');
    expect(await refusal(asAgent('audit.list', { page: 1, pageSize: 5 }))).toBe('That is for people to do, not agents.');
  });

  it('stop working when a key is revoked or the agent is removed, and keep their name on what they did', async () => {
    const [stored] = await crm.rows<{ id: string }>(sql`select id::text as id from api_keys`);
    await crm.call(MAYA, 'agents.revokeKey', stored?.id);
    await expect(crm.services.agents.verify(key)).rejects.toThrow();
    await crm.call(MAYA, 'agents.remove', agent.id);
    expect(await refusal(asAgent('workspace.get'))).toMatch(/do not have access/);
    const workspace = await crm.call<Workspace>(MAYA, 'workspace.get');
    expect(workspace.former?.find((user) => user.id === agent.id)?.name).toBe('Research agent');
  });
});

describe('the audit log', () => {
  it('records every change, with who made it and whether it went through', async () => {
    const entries = await log();
    const made = entries.find((entry) => entry.operation === 'records.create');
    expect(made).toMatchObject({ actorName: 'Research agent', actorKind: 'agent', outcome: 'done', via: 'api' });
    expect(made?.targetId).toMatch(/^con_/);
    const refused = entries.find((entry) => entry.operation === 'records.delete');
    expect(refused).toMatchObject({ actorKind: 'agent', outcome: 'refused' });
    expect(refused?.problem).toMatch(/not delete/);
    expect(entries.some((entry) => entry.operation === 'records.list')).toBe(false);
  });

  it('names both people when an admin was viewing as someone else', async () => {
    await crm.call(MAYA, 'people.viewAs', JONAS);
    const deal = await crm.seed('deals', { name: 'Seen as Jonas', owner: JONAS, stage: 'qualified' });
    await crm.call(MAYA, 'records.update', { id: deal, properties: { priority: 'high' } });
    await crm.call(MAYA, 'people.viewAs', null);
    const entry = (await log({ targetId: deal }))[0];
    expect(entry).toMatchObject({ actorName: 'Jonas Lindqvist', signedInAs: 'Maya Okafor' });
  });

  it('keeps secrets out and shortens long values', async () => {
    await refusal(crm.call(MAYA, 'assistant.saveSettings', { provider: 'no-such-provider', apiKey: 'super-secret-value' }));
    const deal = await crm.seed('deals', { name: 'Long note', owner: MAYA, stage: 'qualified' });
    await crm.call(MAYA, 'activity.create', { recordId: deal, kind: 'note', title: 'Note', body: 'x'.repeat(600) });
    const text = JSON.stringify(await log());
    expect(text).not.toContain('super-secret-value');
    expect(text).toContain('(hidden)');
    expect(text).toContain('(600 characters)');
  });

  it('records what a visitor did through a public page', async () => {
    const form = await crm.call<{ id: string }>(MAYA, 'forms.save', { name: 'Contact us', heading: 'Hi', fields: [{ property: 'email', required: true }], submitLabel: 'Go', thanks: 'Thanks' });
    await crm.visit('forms.submit', { formId: form.id, values: { email: 'visitor@example.com' } });
    expect((await log({ actorId: 'visitor' }))[0]).toMatchObject({ actorName: 'A visitor', actorKind: 'visitor', via: 'public', operation: 'forms.submit' });
  });

  it('is read only by people who manage people', async () => {
    expect(await refusal(crm.call(FEMI, 'audit.list', { page: 1, pageSize: 5 }))).toMatch(/can't read the audit log/);
  });

  it('cannot be edited or deleted, and shows when it has been tampered with', async () => {
    await expect(crm.db.execute(sql`update audit_logs set actor = 'someone-else'`)).rejects.toThrow();
    await expect(crm.db.execute(sql`delete from audit_logs`)).rejects.toThrow();
    expect(await crm.call<AuditCheck>(MAYA, 'audit.check')).toMatchObject({ intact: true, problem: null });
    // Someone with the database's own keys switches the protection off, alters an entry, and switches it back on.
    await crm.db.execute(sql`alter table audit_logs disable trigger all`);
    await crm.db.execute(sql`update audit_logs set action = 'records.nothing' where chain_seq = 2`);
    await crm.db.execute(sql`alter table audit_logs enable trigger all`);
    expect(await crm.call<AuditCheck>(MAYA, 'audit.check')).toMatchObject({ intact: false });
  });
});
