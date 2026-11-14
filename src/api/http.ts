import { operations } from '../contracts/operations';
import type { CrmApi } from '../contracts/records';

/**
 * The CRM's server, as the same `CrmApi` the mock implements. Each method is built from the shared
 * operation list: calling `api.listRecords(query)` posts the query to `/ops/records.list`.
 */

async function call(base: string, name: string, input: unknown): Promise<unknown> {
  const response = await fetch(`${base}/ops/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }) });
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    // The server answers every failure with `{ error: { code, message } }`, in words meant for a person.
    const message = (body as { error?: { message?: string } } | undefined)?.error?.message;
    throw new Error(message ?? `The server could not do that (${response.status}).`);
  }
  return body;
}

/** The methods the server serves. Pass the names it has, so the rest can stay on another source while it is built out. */
export function createHttpApi(base: string, served?: string[]): Partial<CrmApi> {
  const api: Record<string, (input?: unknown) => Promise<unknown>> = {};
  for (const operation of operations) {
    if (served && !served.includes(operation.name)) continue;
    api[operation.method] = (input) => call(base, operation.name, input);
  }
  return api as Partial<CrmApi>;
}
