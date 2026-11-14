import { type ReactNode, useMemo } from 'react';
import { api, useQuery } from '../api';
import { WorkspaceContext, type WorkspaceValue } from './workspace';

/** Loads the object definitions and users once; every page reads them through `useWorkspace`. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data, error } = useQuery(() => api.getWorkspace(), []);

  const value = useMemo<WorkspaceValue | undefined>(() => {
    if (!data) return undefined;
    const currentUser = data.users.find((user) => user.id === data.currentUserId) ?? data.users[0];
    if (!currentUser) return undefined;
    return {
      ...data,
      currentUser,
      object: (id) => data.objects.find((object) => object.id === id),
      user: (id) => (id ? data.users.find((user) => user.id === id) : undefined),
    };
  }, [data]);

  if (error) {
    return (
      <div className="m-alert" data-tone="danger" role="alert" style={{ margin: 'var(--m-space-6)' }}>
        <div className="m-alert-content">
          <p className="m-alert-title">The workspace didn't load</p>
          <p className="m-alert-body">{error.message}</p>
        </div>
      </div>
    );
  }
  if (!value) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minBlockSize: '100vh' }}>
        <span className="m-spinner" role="status" aria-label="Loading workspace" />
      </div>
    );
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
