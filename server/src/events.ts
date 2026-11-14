import { defineEvent } from '@mariachi/events';
import { z } from 'zod';
import { propertyValueSchema } from '../../src/contracts/metadata';

/**
 * What the CRM announces when records change. Every write records its event in the same
 * transaction, so nothing that reacts to changes (workflows now; sequences, search and live
 * updates later) can miss one, whether the change came from the app, an import or an agent.
 */

/** `workflow` marks a change a workflow made, which must not set off other workflows. */
const origin = z.enum(['person', 'workflow']);

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
