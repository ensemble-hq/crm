import { type ReactNode, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../app/workspace';
import { AssistantContext } from './context';
import type { PageContext } from './types';
import { useAssistant } from './useAssistant';

/**
 * Holds the conversation above the pages, so it survives moving around the CRM, and tells the
 * assistant where the user is: which object's list, or which record.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { object: findObject } = useWorkspace();

  const page = useMemo<PageContext>(() => {
    const [first, second] = location.pathname.split('/').filter(Boolean);
    const object = findObject(first);
    return { path: location.pathname, objectId: object?.id, recordId: object && second ? second : undefined };
  }, [location.pathname, findObject]);

  const assistant = useAssistant({ page: () => page, navigate });
  const value = useMemo(() => ({ ...assistant, page }), [assistant, page]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
