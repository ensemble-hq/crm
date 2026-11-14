import { createContext, useContext } from 'react';
import type { ObjectDefinition, User } from '../contracts/metadata';
import type { Workspace } from '../contracts/records';

export type WorkspaceValue = Workspace & {
  currentUser: User;
  object(id: string | undefined): ObjectDefinition | undefined;
  user(id: string | null | undefined): User | undefined;
  /** Fetches the definitions again, after an object or property changed. Resolves once they are in. */
  reload(): Promise<void>;
  /** Goes up whenever records changed somewhere else on the page (the assistant, a bulk action). Queries re-run on it. */
  revision: number;
  /** Says that records changed, so every open list and record page re-reads. */
  touch(): void;
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
