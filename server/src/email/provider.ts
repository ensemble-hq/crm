import type { InboundPayload } from '../schema';

/**
 * What the CRM needs from an email service, and nothing more. Ensemble's email service is one
 * provider; a customer's own (Resend, SMTP, a connected mailbox) is another, with no change to the
 * inbox. The three capabilities map onto how the CRM keeps mail from being lost:
 *
 * - `send` takes an idempotency key, so retrying after a timeout cannot send twice.
 * - `listInboundSince` lets the sweep catch anything a push delivery missed. A provider that
 *   cannot replay leaves it out, and inbound safety then rests on the provider's own retries.
 * - Push delivery is not here: providers post to `/api/inbound/email`, which stores before it answers.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: OutboundEmail, options: { idempotencyKey: string }): Promise<{ providerId: string }>;
  listInboundSince?(position: string | null): Promise<{ messages: ProviderInbound[]; position: string | null }>;
}

export type OutboundEmail = {
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  /** For automated email: where the recipient unsubscribes. A provider sends it as the `List-Unsubscribe` and `List-Unsubscribe-Post` headers, so mail apps can offer their own unsubscribe button. */
  unsubscribeUrl?: string;
};

export type ProviderInbound = { providerMessageId: string; payload: InboundPayload };

/** A failure that retrying will not fix: a bad address, a rejected sender. The message is marked failed at once. */
export class PermanentSendError extends Error {}
