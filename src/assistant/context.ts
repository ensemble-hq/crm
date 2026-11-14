import { createContext, useContext } from 'react';
import type { PageContext } from './types';
import type { Assistant } from './useAssistant';

export type SharedAssistant = Assistant & {
  /** The page the user is on right now. */
  page: PageContext;
};

/** Kept apart from `AssistantProvider` so hot reload never replaces the context while pages read it. */
export const AssistantContext = createContext<SharedAssistant | undefined>(undefined);

/** The one conversation with the assistant, shared by its page and the bar on every other page. */
export function useSharedAssistant(): SharedAssistant {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('useSharedAssistant must be used inside AssistantProvider');
  return value;
}
