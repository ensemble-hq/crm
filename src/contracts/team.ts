import { z } from 'zod';
import { userSchema } from './metadata';

/**
 * People, teams and roles. A role says how far someone can see, change and delete records (their
 * own, their team's, or everyone's) and whether they can run the workspace. The server enforces
 * it on every read and write; the screens only reflect it.
 */

export const scopeSchema = z.enum(['none', 'own', 'team', 'all']);
export type Scope = z.infer<typeof scopeSchema>;

export const roleSettingsSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** Which records with an owner this role can see, change and delete. Records with no owner count as everyone's. */
  view: scopeSchema,
  edit: scopeSchema,
  delete: scopeSchema,
  /** Objects and their properties. (Workflows, sequences, forms and reports are not gated yet.) */
  manageSettings: z.boolean(),
  /** People, teams and roles. */
  managePeople: z.boolean(),
  exportRecords: z.boolean(),
});
export type RoleSettings = z.infer<typeof roleSettingsSchema>;

export const roleSchema = roleSettingsSchema.extend({ id: z.string(), builtIn: z.boolean() });
export type Role = z.infer<typeof roleSchema>;

export const teamSchema = z.object({ id: z.string(), name: z.string() });
export type Team = z.infer<typeof teamSchema>;

export const memberSchema = userSchema.extend({
  roleId: z.string(),
  teamId: z.string().nullable(),
  status: z.enum(['active', 'invited', 'deactivated']),
});
export type Member = z.infer<typeof memberSchema>;

export const directorySchema = z.object({ members: z.array(memberSchema), teams: z.array(teamSchema), roles: z.array(roleSchema) });
export type Directory = z.infer<typeof directorySchema>;

/** What the signed-in (or viewed-as) person may do, sent with the workspace so screens can reflect it. */
export const accessSchema = z.object({
  roleName: z.string(),
  view: scopeSchema,
  edit: scopeSchema,
  delete: scopeSchema,
  manageSettings: z.boolean(),
  managePeople: z.boolean(),
  exportRecords: z.boolean(),
  /** Set while an admin is looking at the CRM as someone else: the admin's own id. */
  viewedBy: z.string().nullable(),
});
export type Access = z.infer<typeof accessSchema>;

/**
 * An agent is software that works in the CRM under its own name: an outside AI agent connected over
 * MCP, a script, an integration. It is a member like a person, with a role that sets which records
 * it reaches, plus a limit on what kind of thing it may do at all. What it changes carries its name.
 */
export const agentReachSchema = z.enum(['read', 'write', 'everything']);
export type AgentReach = z.infer<typeof agentReachSchema>;

export const agentKeySchema = z.object({ id: z.string(), name: z.string(), prefix: z.string(), createdAt: z.string(), lastUsedAt: z.string().nullable() });

export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  roleId: z.string(),
  teamId: z.string().nullable(),
  /** `read`: look things up only. `write`: also create and change. `everything`: also delete, merge and send. */
  reach: agentReachSchema,
  status: z.enum(['active', 'deactivated']),
  /** The keys it signs in with. Only the start of each is kept; the key itself is shown once, when it is made. */
  keys: z.array(agentKeySchema),
});
export type Agent = z.infer<typeof agentSchema>;

export const saveAgentSchema = z.object({ id: z.string().optional(), name: z.string().min(1), roleId: z.string(), teamId: z.string().nullable(), reach: agentReachSchema });
export const createAgentKeySchema = z.object({ agentId: z.string(), name: z.string().min(1) });
export const createdAgentKeySchema = z.object({ id: z.string(), prefix: z.string(), key: z.string() });

export const inviteMemberSchema = z.object({ name: z.string(), email: z.string(), roleId: z.string(), teamId: z.string().nullable() });
export const updateMemberSchema = z.object({ id: z.string(), roleId: z.string().optional(), teamId: z.string().nullable().optional() });
export const deactivateMemberSchema = z.object({ id: z.string(), reassignTo: z.string() });
export const saveTeamSchema = z.object({ id: z.string().optional(), name: z.string() });
export const saveRoleSchema = roleSettingsSchema.extend({ id: z.string().optional() });

export interface TeamApi {
  getDirectory(): Promise<Directory>;
  inviteMember(input: { name: string; email: string; roleId: string; teamId: string | null }): Promise<Member>;
  updateMember(input: { id: string; roleId?: string; teamId?: string | null }): Promise<Member>;
  /** Takes away someone's access and hands everything they own to another person. */
  deactivateMember(input: { id: string; reassignTo: string }): Promise<{ reassigned: number }>;
  reactivateMember(id: string): Promise<Member>;
  /** Creates a team, or renames one when `id` is given. */
  saveTeam(input: { id?: string; name: string }): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  /** Creates a role, or replaces one when `id` is given. */
  saveRole(input: RoleSettings & { id?: string }): Promise<Role>;
  deleteRole(id: string): Promise<void>;
  /** See the CRM exactly as another person does. Pass null to go back to yourself. Admins only. */
  viewAs(userId: string | null): Promise<void>;
  listAgents(): Promise<Agent[]>;
  /** Creates an agent, or changes one when `id` is given. */
  saveAgent(input: z.infer<typeof saveAgentSchema>): Promise<Agent>;
  /** Switches an agent off for good and revokes its keys. What it did keeps its name. */
  removeAgent(id: string): Promise<void>;
  /** Makes a key for an agent. The key is returned once and cannot be read again. */
  createAgentKey(input: z.infer<typeof createAgentKeySchema>): Promise<z.infer<typeof createdAgentKeySchema>>;
  revokeAgentKey(id: string): Promise<void>;
}
