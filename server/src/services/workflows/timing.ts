import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Trigger } from '../../../../src/contracts/workflows';

const DAY = 86_400_000;

/** The most recent moment a schedule was due, at or before `now`. Hours and weekdays are in UTC. */
export function latestSlot(trigger: Extract<Trigger, { kind: 'schedule' }>, now: Date): string {
  let slot = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), trigger.hour);
  if (slot > now.getTime()) slot -= DAY;
  if (trigger.every === 'week') {
    const wanted = trigger.weekday ?? 1;
    // getUTCDay counts Sunday as 0; the schedule counts Monday as 1 and Sunday as 7.
    while ((new Date(slot).getUTCDay() || 7) !== wanted) slot -= DAY;
  }
  return new Date(slot).toISOString();
}

/**
 * The address another system calls ends in the workflow's id and a signature of it made with this
 * instance's secret, so it cannot be guessed and nothing extra has to be stored.
 */
export function hookToken(secret: string, workflowId: string): string {
  return `${workflowId}.${createHmac('sha256', secret).update(`workflow-hook:${workflowId}`).digest('base64url').slice(0, 32)}`;
}

/** The workflow a token is for, or nothing if the token was not made here. */
export function workflowOfToken(secret: string, token: string): string | undefined {
  const workflowId = token.slice(0, token.lastIndexOf('.'));
  if (!workflowId) return undefined;
  const expected = Buffer.from(hookToken(secret, workflowId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? workflowId : undefined;
}
