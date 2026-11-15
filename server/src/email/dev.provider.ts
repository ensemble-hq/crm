import type { DrizzleDb } from '@mariachi/database-postgres';
import { sql } from 'drizzle-orm';
import type { InboundPayload } from '../schema';
import { type EmailProvider, type OutboundEmail, PermanentSendError, type ProviderInbound } from './provider';

/**
 * A stand-in email service for development. Sent mail lands in the `dev_mail` table instead of
 * anyone's inbox, and mail put there as "arrived" can be replayed, so the whole path can be tried
 * without a provider account. Addresses on two domains misbehave on purpose:
 *
 * - `@bounce.example` is refused for good, like an address that does not exist.
 * - `@flaky.example` fails the first two tries, like a provider having a bad minute.
 */
export class DevEmailProvider implements EmailProvider {
  readonly name = 'dev';
  private readonly tries = new Map<string, number>();

  constructor(private readonly db: DrizzleDb) {}

  async send(message: OutboundEmail, options: { idempotencyKey: string }): Promise<{ providerId: string }> {
    if (message.toEmail.endsWith('@bounce.example')) throw new PermanentSendError(`${message.toEmail} does not exist.`);
    if (message.toEmail.endsWith('@flaky.example')) {
      const tries = (this.tries.get(options.idempotencyKey) ?? 0) + 1;
      this.tries.set(options.idempotencyKey, tries);
      if (tries <= 2) throw new Error('The email service did not answer.');
    }
    // The key is the row's id: sending the same message again changes nothing.
    await this.db.execute(sql`insert into dev_mail (id, direction, payload, sequence) values (${`out_${options.idempotencyKey}`}, 'out', ${JSON.stringify({ ...message, attachments: (message.attachments ?? []).map((file) => ({ name: file.name, contentType: file.contentType, size: file.content.length })) })}::jsonb, (select coalesce(max(sequence), 0) + 1 from dev_mail)) on conflict (id) do nothing`);
    return { providerId: `dev_${options.idempotencyKey}` };
  }

  async listInboundSince(position: string | null): Promise<{ messages: ProviderInbound[]; position: string | null }> {
    const rows = (await this.db.execute(sql`select id, payload, sequence::text as sequence from dev_mail where direction = 'in' and sequence > ${Number(position ?? 0)} order by sequence limit 200`)) as unknown as Array<{ id: string; payload: InboundPayload; sequence: string }>;
    return { messages: rows.map((row) => ({ providerMessageId: row.id, payload: row.payload })), position: rows.length > 0 ? (rows[rows.length - 1]?.sequence ?? position) : position };
  }

  /** Puts a message in the provider's store as if it had arrived there, without telling the CRM. Only the sweep will find it. */
  async arriveSilently(providerMessageId: string, payload: InboundPayload): Promise<void> {
    await this.db.execute(sql`insert into dev_mail (id, direction, payload, sequence) values (${providerMessageId}, 'in', ${JSON.stringify(payload)}::jsonb, (select coalesce(max(sequence), 0) + 1 from dev_mail)) on conflict (id) do nothing`);
  }
}
