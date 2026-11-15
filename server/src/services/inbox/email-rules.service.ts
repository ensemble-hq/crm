import { ConflictError, type Context, ValidationError } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { sql } from 'drizzle-orm';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { EmailPreference, EmailSettings, EmailStatus } from '../../../../src/contracts/inbox';
import { type ConsentRow, type EmailPreferenceRow, type EmailSettingsRow, consentsTable, emailPreferencesTable, emailSettingsTable } from '../../schema';
import { actorOf, assertAllowed } from '../people/access';

/**
 * Who may be emailed, and how often. Every email the CRM sends passes through `check` when it is
 * queued and again just before it goes, so no route (a reply, a sequence, a workflow, an agent)
 * can send to someone who has said no.
 *
 * Two kinds of email are told apart. A message a person writes to one contact is a conversation:
 * it is stopped only for a blocked address. Email the CRM sends on its own (a sequence step, a
 * workflow) is automated: it also obeys unsubscribes and a weekly limit per address, and it always
 * carries a working unsubscribe link and the organization's postal address.
 */

export type Purpose = 'conversation' | 'automated';

/** The address has opted out or is blocked. Trying again later will not help. */
export class Suppressed extends ConflictError {}

/** The address has had its share of automated email for now. Try again at `until`. */
export class OverLimit extends ConflictError {
  constructor(
    message: string,
    readonly until: Date,
  ) {
    super(message);
  }
}

class PreferencesRepository extends DrizzleRepository<EmailPreferenceRow> {
  constructor(db: DrizzleDb) {
    super(emailPreferencesTable, db);
  }
}
class ConsentsRepository extends DrizzleRepository<ConsentRow> {
  constructor(db: DrizzleDb) {
    super(consentsTable, db);
  }
}
class SettingsRepository extends DrizzleRepository<EmailSettingsRow> {
  constructor(db: DrizzleDb) {
    super(emailSettingsTable, db);
  }
}

const SETTINGS_ID = 'email';
const WEEK = 7 * 86_400_000;
const clean = (email: string) => email.trim().toLowerCase();
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1•••$2');

export class EmailRules {
  private readonly preferences: PreferencesRepository;
  private readonly consents: ConsentsRepository;
  private readonly settings: SettingsRepository;

  constructor(
    private readonly db: DrizzleDb,
    /** Signs unsubscribe links, so a link works for exactly one address and cannot be made up. */
    private readonly secret: string,
    private readonly appOrigin: string,
    private readonly organization: string,
  ) {
    this.preferences = new PreferencesRepository(db);
    this.consents = new ConsentsRepository(db);
    this.settings = new SettingsRepository(db);
  }

  // Settings

  async getSettings(ctx: Context): Promise<EmailSettings> {
    const row = await this.settings.findById(ctx, SETTINGS_ID);
    return { weeklyLimit: row?.weeklyLimit ?? 3, postalAddress: row?.postalAddress ?? '' };
  }

  async saveSettings(ctx: Context, input: EmailSettings): Promise<EmailSettings> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'change the email sending rules');
    const values = { weeklyLimit: input.weeklyLimit, postalAddress: input.postalAddress.trim() };
    if (await this.settings.findById(ctx, SETTINGS_ID)) await this.settings.update(ctx, SETTINGS_ID, values);
    else await this.settings.create(ctx, { id: SETTINGS_ID, ...values });
    return values;
  }

  // Reading

  private row(ctx: Context, email: string): Promise<EmailPreferenceRow | null> {
    return this.preferences.findOne(ctx, { email: clean(email) });
  }

  /** Automated emails sent, or waiting to go, to an address in the last seven days, oldest first. */
  private async recent(ctx: Context, email: string): Promise<Date[]> {
    const rows = (await this.db.execute(
      sql`select created_at from messages where tenant_id = ${ctx.tenantId} and direction = 'out' and purpose = 'automated' and status <> 'failed' and lower(to_email) = ${clean(email)} and created_at > now() - interval '7 days' order by created_at`,
    )) as unknown as Array<{ created_at: string | Date }>;
    return rows.map((row) => new Date(row.created_at));
  }

  async describe(ctx: Context, email: string): Promise<EmailPreference> {
    const address = clean(email);
    const [row, consent, sent, settings] = await Promise.all([this.row(ctx, address), this.consents.findMany(ctx, { email: address }, { sort: { field: 'createdAt', direction: 'desc' }, limit: 1 }), this.recent(ctx, address), this.getSettings(ctx)]);
    return {
      email: address,
      status: (row?.status as EmailStatus | undefined) ?? 'subscribed',
      source: (row?.source as EmailPreference['source'] | undefined) ?? 'none',
      reason: row?.reason ?? null,
      changedAt: row?.updatedAt.toISOString() ?? null,
      consent: consent[0] ? { text: consent[0].text, source: consent[0].source, at: consent[0].createdAt.toISOString() } : null,
      sentThisWeek: sent.length,
      weeklyLimit: settings.weeklyLimit,
    };
  }

  /** Throws when this address must not get this kind of email now. Called when an email is queued and again just before it is sent. */
  async check(ctx: Context, email: string, purpose: Purpose, options: { countingItself?: boolean } = {}): Promise<void> {
    const row = await this.row(ctx, email);
    if (row?.status === 'blocked') throw new Suppressed(`${email} cannot be emailed${row.reason ? `: ${row.reason}` : '.'}`);
    if (purpose !== 'automated') return;
    if (row?.status === 'unsubscribed') throw new Suppressed(`${email} has unsubscribed, so nothing automated is sent to them.`);
    const [sent, settings] = await Promise.all([this.recent(ctx, email), this.getSettings(ctx)]);
    // Just before sending, the message being sent is already one of the ones counted.
    const others = sent.length - (options.countingItself ? 1 : 0);
    if (others >= settings.weeklyLimit) {
      const oldest = sent[0] ?? new Date();
      throw new OverLimit(`${email} has already had ${others} automated ${others === 1 ? 'email' : 'emails'} this week, which is the limit.`, new Date(oldest.getTime() + WEEK + 60_000));
    }
  }

  // Changing

  private async write(ctx: Context, email: string, status: EmailStatus, source: 'recipient' | 'member' | 'bounce', reason: string | null, changedBy: string | null): Promise<void> {
    const address = clean(email);
    const existing = await this.row(ctx, address);
    const values = { status, source, reason, changedBy };
    if (existing) await this.preferences.update(ctx, existing.id, values);
    else await this.preferences.create(ctx, { id: `pref_${randomUUID().replace(/-/g, '').slice(0, 12)}`, email: address, ...values });
  }

  /** A member of the team stops or resumes email to an address. */
  async set(ctx: Context, input: { email: string; status: EmailStatus; reason?: string }): Promise<EmailPreference> {
    const actor = actorOf(ctx);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) throw new ValidationError('That is not an email address.');
    const existing = await this.row(ctx, input.email);
    const reason = input.reason?.trim() || null;
    if (input.status === 'subscribed' && existing && existing.status !== 'subscribed') {
      // Emailing someone again after they were stopped needs a reason on record, and undoing their own choice is for an admin.
      if (!reason) throw new ValidationError('Say why it is right to email this person again, such as how they asked to be.');
      if (existing.source === 'recipient') assertAllowed(actor, 'manageSettings', 'resume email to someone who unsubscribed themselves');
    }
    await this.write(ctx, input.email, input.status, 'member', reason, actor.userId);
    return this.describe(ctx, input.email);
  }

  /** The email service says the address does not exist or complained. */
  async bounced(ctx: Context, email: string, reason: string): Promise<void> {
    await this.write(ctx, email, 'blocked', 'bounce', reason, null);
  }

  /** Someone agreed to be emailed, in these words. Agreeing again brings back someone who had unsubscribed, but not a blocked address. */
  async recordConsent(ctx: Context, email: string, text: string, source: string): Promise<void> {
    const address = clean(email);
    await this.consents.create(ctx, { id: `cns_${randomUUID().replace(/-/g, '').slice(0, 12)}`, email: address, text, source });
    const existing = await this.row(ctx, address);
    if (existing?.status === 'unsubscribed') await this.write(ctx, address, 'subscribed', 'recipient', `Agreed again on ${source}`, null);
  }

  // Unsubscribe links

  private sign(address: string): string {
    return createHmac('sha256', this.secret).update(`unsubscribe:${address}`).digest('base64url').slice(0, 32);
  }

  unsubscribeUrl(email: string): string {
    const address = clean(email);
    return `${this.appOrigin}/u/${Buffer.from(address).toString('base64url')}.${this.sign(address)}`;
  }

  /** Where a mail app's own unsubscribe button posts. */
  oneClickUrl(email: string): string {
    return this.unsubscribeUrl(email).replace('/u/', '/api/inbound/unsubscribe/');
  }

  /** What automated email ends with: the organization's address and the way out. */
  async footer(ctx: Context, email: string): Promise<string> {
    const { postalAddress } = await this.getSettings(ctx);
    return `\n\n--\n${this.organization}${postalAddress ? `\n${postalAddress}` : ''}\nTo stop getting these emails: ${this.unsubscribeUrl(email)}`;
  }

  /** The same, as parts, for an email that is designed. */
  async footerParts(ctx: Context, email: string): Promise<{ organization: string; postalAddress?: string; unsubscribeUrl: string }> {
    const { postalAddress } = await this.getSettings(ctx);
    return { organization: this.organization, ...(postalAddress ? { postalAddress } : {}), unsubscribeUrl: this.unsubscribeUrl(email) };
  }

  private addressOf(token: string): string {
    const [encoded = '', signature = ''] = token.split('.');
    const address = Buffer.from(encoded, 'base64url').toString();
    const expected = Buffer.from(this.sign(address));
    const given = Buffer.from(signature);
    if (!address.includes('@') || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ValidationError('This unsubscribe link is not valid.');
    return address;
  }

  /** What the public page shows. The address is partly hidden: a forwarded email should not hand the whole address to whoever opens the link. */
  async page(ctx: Context, token: string): Promise<{ email: string; status: EmailStatus; organization: string }> {
    const address = this.addressOf(token);
    const row = await this.row(ctx, address);
    return { email: mask(address), status: (row?.status as EmailStatus | undefined) ?? 'subscribed', organization: this.organization };
  }

  /** The recipient unsubscribes, or undoes it. A blocked address stays blocked. */
  async unsubscribe(ctx: Context, token: string, resubscribe: boolean): Promise<{ email: string; status: EmailStatus; organization: string }> {
    const address = this.addressOf(token);
    const row = await this.row(ctx, address);
    if (row?.status !== 'blocked') await this.write(ctx, address, resubscribe ? 'subscribed' : 'unsubscribed', 'recipient', resubscribe ? 'Subscribed again from the unsubscribe page' : 'Unsubscribed from a link in an email', null);
    return this.page(ctx, token);
  }
}
