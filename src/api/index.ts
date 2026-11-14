import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import type { CrmApi } from '../contracts/records';
import { mockApi } from '../mock/api';
import { createHttpApi } from './http';

/**
 * The one place the app chooses its data source. With `VITE_API_URL` set, the operations the server
 * serves go to it; anything it does not serve yet still comes from the mock, so the app keeps
 * working while the backend is built out one group of operations at a time.
 */
const server = import.meta.env.VITE_API_URL as string | undefined;
export const api: CrmApi = server ? { ...mockApi, ...createHttpApi(server) } : mockApi;

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
