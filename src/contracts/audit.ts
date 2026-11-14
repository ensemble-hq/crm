import { z } from 'zod';

/**
 * The audit log: every change made to the CRM, by whom or by what, through which door, and whether
 * it went through. It can only be added to. Each entry is chained to the one before it, so an entry
 * removed or altered afterwards shows up when the chain is checked.
 */

export const auditEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  /** A member's id, or `visitor` for someone outside the team using a public form or booking page. */
  actorId: z.string(),
  actorName: z.string(),
  actorKind: z.enum(['person', 'agent', 'visitor']),
  /** Set when an administrator was viewing the CRM as someone else: who they really were. */
  signedInAs: z.string().nullable(),
  /** The operation, such as `records.update`, and its name in words. */
  operation: z.string(),
  title: z.string(),
  effect: z.enum(['write', 'destructive', 'send']),
  /** How it arrived: the app, a plan the assistant proposed and the person approved, an agent over MCP, or a direct API call. */
  via: z.enum(['app', 'assistant', 'mcp', 'api', 'public']),
  /** What it was done to, when that is one thing: a record's id, a workflow's, a person's. */
  targetId: z.string().nullable(),
  outcome: z.enum(['done', 'refused', 'failed']),
  /** Why it was refused or failed. */
  problem: z.string().nullable(),
  /** What was asked for, with secrets removed and long values shortened. */
  detail: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditQuerySchema = z.object({
  actorId: z.string().optional(),
  operation: z.string().optional(),
  targetId: z.string().optional(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditPageSchema = z.object({ entries: z.array(auditEntrySchema), total: z.number().int() });
export type AuditPage = z.infer<typeof auditPageSchema>;

export const auditCheckSchema = z.object({
  /** True when every entry still links to the one before it. */
  intact: z.boolean(),
  entries: z.number().int(),
  /** What is wrong, when something is. */
  problem: z.string().nullable(),
});
export type AuditCheck = z.infer<typeof auditCheckSchema>;

export interface AuditApi {
  listAudit(query: AuditQuery): Promise<AuditPage>;
  /** Checks that nothing in the log has been removed or altered. */
  checkAudit(): Promise<AuditCheck>;
}
