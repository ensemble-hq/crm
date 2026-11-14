import type { Context } from '@mariachi/core';
import { DefaultRealtime, type Realtime, createRealtimeInfra } from '@mariachi/realtime';
import { z } from 'zod';

/**
 * Live updates. When something changes, every open browser is told which part of the CRM to read
 * again, so a task a workflow created or an email that just arrived shows without a reload.
 *
 * A notice says where to look, never what is there: it carries no record data, so it cannot show
 * anyone something their role hides. The browser reads again through the normal operations, which
 * apply its person's access as always.
 *
 * Notices travel through Redis, so the worker can reach browsers connected to the API.
 */

/** The one channel every member's browser listens on. */
export const CHANGES = 'changes';

export const noticeSchema = z.object({
  /** Which part of the CRM changed. */
  topic: z.enum(['records', 'inbox', 'notifications', 'settings']),
  /** For `records`: the object whose records changed. */
  objectId: z.string().optional(),
});
export type Notice = z.infer<typeof noticeSchema>;

export function createLive(redisUrl: string, prefix: string, instrumentation: ConstructorParameters<typeof DefaultRealtime>[1]): Realtime {
  return new DefaultRealtime(
    {
      ...createRealtimeInfra({ adapter: 'redis', url: redisUrl, prefix: `${prefix}:live` }),
      // Anyone who got as far as a connection is a member; members may listen for changes and nothing else.
      authorize: (_identity, channel, action) => channel === CHANGES && action === 'subscribe',
    },
    instrumentation,
  );
}

/** Tells every open browser to read part of the CRM again. Never fails the work that caused it. */
export async function announce(live: Realtime, ctx: Context, notice: Notice): Promise<void> {
  try {
    await live.broadcast(ctx, CHANGES, notice);
  } catch (error) {
    ctx.logger.warn({ error, notice }, 'A live update could not be sent; browsers will catch up on their next read');
  }
}
