import { defineEvent } from '@mariachi/events';
import { z } from 'zod';
import { propertyValueSchema } from '../../src/contracts/metadata';

/**
 * What the CRM announces when records change. Every write records its event in the same
 * transaction, so nothing that reacts to changes (workflows now; sequences, search and live
 * updates later) can miss one, whether the change came from the app, an import or an agent.
 */

/** `workflow` marks a change a workflow made, which must not set off other workflows. */
/** `restore` marks a deleted record coming back, which is not a new record and sets nothing off. */
const origin = z.enum(['person', 'workflow', 'restore']);

export const recordCreated = defineEvent('record.created', { schema: z.object({ recordId: z.string(), objectId: z.string(), origin }) });

export const recordChanged = defineEvent('record.changed', {
  schema: z.object({
    recordId: z.string(),
    objectId: z.string(),
    /** The properties that changed, with their new values. */
    changed: z.record(propertyValueSchema),
    origin,
  }),
});

export const recordDeleted = defineEvent('record.deleted', { schema: z.object({ recordId: z.string(), objectId: z.string(), origin }) });

export type Origin = z.infer<typeof origin>;

/** An email arrived and is stored; it still has to be filed into a conversation. */
export const emailReceived = defineEvent('email.received', { schema: z.object({ inboundId: z.string() }) });

/** Someone sent an email; it is stored as queued and still has to go out. */
export const emailQueued = defineEvent('email.queued', { schema: z.object({ messageId: z.string() }) });

/** A conversation was assigned, closed, reopened or marked, so inboxes should read again. */
export const conversationChanged = defineEvent('conversation.changed', { schema: z.object({ conversationId: z.string() }) });

/** An object, a property or a saved view changed, so every browser should load the workspace again. */
export const settingsChanged = defineEvent('settings.changed', { schema: z.object({ objectId: z.string() }) });
