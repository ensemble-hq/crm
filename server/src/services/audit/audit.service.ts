import { DrizzleAuditLog } from '@mariachi/audit/postgres';
import type { Context } from '@mariachi/core';
import type { DrizzleDb } from '@mariachi/database-postgres';
import type { AuditCheck, AuditEntry, AuditPage, AuditQuery } from '../../../../src/contracts/audit';
import type { Operation } from '../../../../src/contracts/operations';
import { type Actor, actorOf, assertAllowed } from '../people/access';
import type { PeopleRepository } from '../people/people.repository';

/**
 * The audit log. Every operation that changes, deletes or sends is written here once it has been
 * tried: who or what asked, how the request arrived, what it was for, and whether it went through
 * or was refused. Refusals are kept too, because "an agent tried to delete this" is worth knowing.
 *
 * It is Mariachi's audit trail underneath: the table only accepts new rows, and each entry is
 * hashed together with the one before it, so a removed or altered entry breaks the chain.
 */

// `confirm` is what someone types to erase a person: their email address, which must not outlive them here.
const SECRET = /key|secret|password|token|^confirm$/i;
const MAX_DETAIL = 1_500;

/** What was asked for, safe to keep: secrets blanked, long text shortened, large lists counted instead of stored. */
function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}… (${value.length} characters)` : value;
  if (Array.isArray(value)) return value.length > 12 || depth > 2 ? `${value.length} items` : value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET.test(key) && typeof item === 'string' && item ? '(hidden)' : redact(item, depth + 1)]));
  }
  return value;
}

/** The one thing an operation was done to, when there is one. */
function targetOf(input: unknown, result: unknown): string | null {
  const pick = (value: unknown, keys: string[]) => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return undefined;
    for (const key of keys) {
      const found = (value as Record<string, unknown>)[key];
      if (typeof found === 'string' && found) return found;
    }
    return undefined;
  };
  // What was acted on, else what was made, else the kind of thing it was made in.
  return pick(input, ['id', 'recordId', 'keepId', 'dealId', 'leadId', 'conversationId', 'sequenceId', 'formId', 'bookingPageId', 'agentId', 'userId']) ?? pick(result, ['id', 'contactId']) ?? pick(input, ['objectId']) ?? null;
}

type Request = { routePath?: string; headers?: Record<string, string | string[] | undefined>; ip?: string };

export class AuditService {
  private readonly log: DrizzleAuditLog;

  constructor(
    db: DrizzleDb,
    private readonly people: PeopleRepository,
  ) {
    this.log = new DrizzleAuditLog(db);
  }

  /** Writes what was just tried. Never throws: failing to write the log must not undo or fail the work, so it is reported loudly instead. */
  async record(ctx: Context, operation: Operation, actor: Actor | undefined, input: unknown, outcome: { result?: unknown; error?: unknown }): Promise<void> {
    if (operation.effect === 'read') return;
    try {
      const request = (ctx as Context & { request?: Request }).request;
      const header = (name: string) => {
        const value = request?.headers?.[name];
        return typeof value === 'string' ? value : undefined;
      };
      const via = !actor ? 'public' : request?.routePath?.startsWith('/api/mcp') ? 'mcp' : header('x-crm-via') === 'assistant' ? 'assistant' : ctx.identityType === 'api-key' ? 'api' : 'app';
      const error = outcome.error;
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
      await this.log.log(ctx, {
        actor: actor?.userId ?? 'visitor',
        action: operation.name,
        resource: operation.name.split('.')[0] ?? 'crm',
        resourceId: targetOf(input, outcome.result) ?? '',
        tenantId: ctx.tenantId,
        ipAddress: request?.ip,
        userAgent: header('user-agent'),
        metadata: {
          title: operation.title,
          effect: operation.effect,
          via,
          kind: !actor ? 'visitor' : actor.agent ? 'agent' : 'person',
          signedInAs: actor && actor.signedInId !== actor.userId ? actor.signedInId : null,
          keyId: ctx.apiKeyId ?? null,
          outcome: error === undefined ? 'done' : /forbidden|unauthorized|validation|conflict|not-found/.test(code) ? 'refused' : 'failed',
          problem: error === undefined ? null : error instanceof Error ? error.message : String(error),
          detail: JSON.stringify(redact(input) ?? null).slice(0, MAX_DETAIL),
        },
      });
    } catch (failure) {
      ctx.logger.error({ error: failure, operation: operation.name }, 'An audit entry could not be written');
    }
  }

  /** Newest first. For the people who run the workspace. */
  async list(ctx: Context, query: AuditQuery): Promise<AuditPage> {
    assertAllowed(actorOf(ctx), 'managePeople', 'read the audit log');
    const page = await this.log.find(ctx, { actor: query.actorId, action: query.operation, resourceId: query.targetId }, { page: query.page, pageSize: query.pageSize });
    // Names come from everyone who has ever been a member, so a removed agent's entries still say who it was.
    const names = new Map((await this.people.findMany(ctx, {}, { limit: 5_000 })).map((person) => [person.id, person.name]));
    const entries: AuditEntry[] = page.data.map((entry) => {
      const meta = (entry.metadata ?? {}) as Record<string, unknown>;
      return {
        id: entry.id,
        at: new Date(entry.occurredAt).toISOString(),
        actorId: entry.actor,
        actorName: entry.actor === 'visitor' ? 'A visitor' : (names.get(entry.actor) ?? 'Someone no longer here'),
        actorKind: meta.kind === 'agent' ? 'agent' : meta.kind === 'visitor' ? 'visitor' : 'person',
        signedInAs: typeof meta.signedInAs === 'string' ? (names.get(meta.signedInAs) ?? meta.signedInAs) : null,
        operation: entry.action,
        title: typeof meta.title === 'string' ? meta.title : entry.action,
        effect: meta.effect === 'destructive' || meta.effect === 'send' ? meta.effect : 'write',
        via: meta.via === 'assistant' || meta.via === 'mcp' || meta.via === 'api' || meta.via === 'public' ? meta.via : 'app',
        targetId: entry.resourceId || null,
        outcome: meta.outcome === 'refused' || meta.outcome === 'failed' ? meta.outcome : 'done',
        problem: typeof meta.problem === 'string' ? meta.problem : null,
        detail: typeof meta.detail === 'string' ? meta.detail : '',
      };
    });
    return { entries, total: page.total };
  }

  async check(ctx: Context): Promise<AuditCheck> {
    assertAllowed(actorOf(ctx), 'managePeople', 'check the audit log');
    const result = await this.log.verifyChain(ctx, ctx.tenantId);
    return result.ok ? { intact: true, entries: result.checked, problem: null } : { intact: false, entries: 'checked' in result ? Number(result.checked) : 0, problem: 'reason' in result ? String(result.reason) : 'An entry has been removed or altered.' };
  }
}
