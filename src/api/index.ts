import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import type { CrmApi } from '../contracts/records';
import { mockApi } from '../mock/api';

/** The one place the app chooses its data source. Swap `mockApi` for the HTTP client here. */
export const api: CrmApi = mockApi;

export type Query<T> = { data: T | undefined; loading: boolean; error: Error | undefined; reload: () => void };

/**
 * Runs an async read and re-runs it when `deps` change. The previous result stays visible while
 * the next one loads, so tables and boards don't flash empty between pages.
 */
export function useQuery<T>(read: () => Promise<T>, deps: DependencyList): Query<T> {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: Error | undefined }>({
    data: undefined,
    loading: true,
    error: undefined,
  });
  const [version, setVersion] = useState(0);
  const latest = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `read` is rebuilt every render; `deps` says when to re-run
  useEffect(() => {
    latest.current += 1;
    const run = latest.current;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    read().then(
      (data) => {
        if (run === latest.current) setState({ data, loading: false, error: undefined });
      },
      (error: unknown) => {
        if (run === latest.current) {
          setState({ data: undefined, loading: false, error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
    );
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
