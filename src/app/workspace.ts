import { createContext, useContext } from 'react';
import type { ObjectDefinition, User } from '../contracts/metadata';
import type { Workspace } from '../contracts/records';

export type WorkspaceValue = Workspace & {
  currentUser: User;
  object(id: string | undefined): ObjectDefinition | undefined;
  user(id: string | null | undefined): User | undefined;
};

/**
 * Kept apart from `WorkspaceProvider` so that hot reload never replaces the context while pages
 * are reading it.
 */
export const WorkspaceContext = createContext<WorkspaceValue | undefined>(undefined);

/** The object definitions, the users and who is signed in. */
export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
