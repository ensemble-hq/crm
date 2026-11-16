/**
 * The system being left, as the importer sees it: something that can be read by path. The importer
 * only ever reads. HubSpot over HTTPS is one of these; tests hand in an account held in memory.
 */
export interface MigrationSource {
  get(path: string, query?: Record<string, string>): Promise<unknown>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    /** The HTTP status the other system answered with, when it answered. */
    readonly status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** HubSpot's API, read with a private app access token. Waits and tries again when HubSpot says it is being asked too fast. */
export function hubspotSource(key: string, baseUrl: string): MigrationSource {
  return {
    async get(path, query = {}) {
      const url = new URL(path, baseUrl);
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      for (let attempt = 0; ; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(url, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
        } catch (error) {
          if (attempt < 3) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw new SourceError(`HubSpot could not be reached: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (response.ok) return response.json();
        // Too fast, or a passing fault on their side: wait as long as they ask, a few times.
        if ((response.status === 429 || response.status >= 500) && attempt < 5) {
          const asked = Number(response.headers.get('retry-after'));
          await sleep(Math.min(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1000 * 2 ** attempt, 15_000));
          continue;
        }
        const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
        throw new SourceError(body?.message ? `HubSpot answered ${response.status}: ${body.message}` : `HubSpot answered ${response.status}.`, response.status);
      }
    },
  };
}

/** What a failure reading the other system means, in words for the person running the import. */
export function explain(error: unknown): string {
  if (error instanceof SourceError) {
    if (error.status === 401) return 'HubSpot did not accept the key. Check that it is a private app access token and has not been rotated, then enter it again.';
    if (error.status === 403) return `The key is not allowed to read this. Give the private app the scope it is missing, then try the step again. (${error.message})`;
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
