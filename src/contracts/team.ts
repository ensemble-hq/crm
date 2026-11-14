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
}
