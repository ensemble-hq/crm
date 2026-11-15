import { type Context, NotFoundError, ValidationError } from '@mariachi/core';
import type { DrizzleDb } from '@mariachi/database-postgres';
import { type SQL, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Erasure, PersonalData } from '../../../../src/contracts/privacy';
import type { CrmRecord } from '../../../../src/contracts/records';
import { actorOf, assertAllowed, visibility } from '../people/access';
import type { RecordEvents } from '../records/records.events';
import type { RecordsRepository } from '../records/records.repository';
import type { WorkspaceService } from '../workspace/workspace.service';

/**
 * Privacy requests: hand a person everything held about them, or remove it.
 *
 * Erasing is the one place the CRM really deletes. Elsewhere a deleted record is only marked as
 * deleted; here the record and everything about the person leaves the database in one
 * transaction. Two things are kept on purpose. Their address goes on the never-email list, because
 * forgetting it entirely is how someone who asked to be left alone gets emailed again after the
 * next import. And the audit log keeps its entries, which cannot be edited by design; they say
 * that changes were made and by whom, with long values already shortened.
 */
export class PrivacyService {
  constructor(
    private readonly db: DrizzleDb,
    private readonly records: RecordsRepository,
    private readonly events: RecordEvents,
    private readonly workspace: WorkspaceService,
  ) {}

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    return (await this.db.execute(query)) as unknown as T[];
  }

  private async person(ctx: Context, recordId: string): Promise<{ record: CrmRecord; email: string | null; name: string }> {
    // Only someone who can see the record can ask about the person behind it.
    const visible = visibility(actorOf(ctx));
    const record = await this.records.one(ctx, recordId, ...(visible ? [visible] : []));
    if (!record) throw new NotFoundError('record', recordId);
    const object = await this.workspace.definition(ctx, record.objectId);
    if (!object.properties.some((property) => property.id === 'email')) throw new ValidationError(`Privacy requests are about people. ${object.plural} have no email address.`);
    const email = typeof record.properties.email === 'string' && record.properties.email.trim() ? record.properties.email.trim().toLowerCase() : null;
    return { record, email, name: String(record.properties[object.primaryProperty] ?? '') };
  }

  async export(ctx: Context, recordId: string): Promise<PersonalData> {
    assertAllowed(actorOf(ctx), 'exportRecords', 'export what is held about a person');
    const { record, email } = await this.person(ctx, recordId);
    const objects = await this.workspace.definitions(ctx);
    const object = objects.find((item) => item.id === record.objectId);
    const tenant = ctx.tenantId;
    // Fields go out under the names people see, not the ids the database uses.
    const fields = Object.fromEntries((object?.properties ?? []).filter((property) => record.properties[property.id] !== undefined && record.properties[property.id] !== null).map((property) => [property.label, record.properties[property.id]]));
    const conversations = await this.rows<{ id: string; subject: string }>(sql`select id, subject from conversations where tenant_id = ${tenant} and contact_id = ${recordId} order by created_at`);
    const withMessages = [];
    for (const conversation of conversations) {
      const messages = await this.rows(sql`select direction, from_name as "from", from_email as "fromEmail", to_email as "toEmail", body, sent_at as "sentAt" from messages where tenant_id = ${tenant} and conversation_id = ${conversation.id} order by sent_at`);
      withMessages.push({ subject: conversation.subject, messages });
    }
    const pointing = objects.flatMap((item) => item.properties.filter((property) => property.type === 'reference' && property.referenceObjectId === record.objectId).map((property) => ({ object: item, propertyId: property.id })));
    const linkedRecords = [];
    for (const { object: other, propertyId } of pointing) {
      for (const linked of await this.records.select(ctx, [sql`records.object_id = ${other.id}`, sql`records.properties->>${propertyId}::text = ${recordId}`], sql`records.created_at`, 500, 0)) {
        linkedRecords.push({ kind: other.singular, name: linked.properties[other.primaryProperty] ?? linked.id });
      }
    }
    return {
      exportedAt: new Date().toISOString(),
      record: { id: record.id, kind: object?.singular ?? record.objectId, createdAt: record.createdAt, fields },
      emailPreference: email ? ((await this.rows(sql`select status, source, reason, updated_at as "changedAt" from email_preferences where tenant_id = ${tenant} and email = ${email}`))[0] ?? null) : null,
      consents: email ? await this.rows(sql`select text, source, created_at as "givenAt" from consents where tenant_id = ${tenant} and email = ${email} order by created_at`) : [],
      activity: await this.rows(sql`select kind, title, body, occurred_at as "at" from activities where tenant_id = ${tenant} and record_id = ${recordId} order by occurred_at`),
      conversations: withMessages,
      formSubmissions: await this.rows(sql`select values, submitted_at as "submittedAt" from submissions where tenant_id = ${tenant} and contact_id = ${recordId} order by submitted_at`),
      meetings: await this.rows(sql`select starts_at as "startsAt", duration_minutes as "durationMinutes" from meetings where tenant_id = ${tenant} and contact_id = ${recordId} order by starts_at`),
      sequences: await this.rows(sql`select sequences.name as sequence, enrollments.status, enrollments.created_at as "enrolledAt" from enrollments join sequences on sequences.id = enrollments.sequence_id where enrollments.tenant_id = ${tenant} and enrollments.contact_id = ${recordId} order by enrollments.created_at`),
      linkedRecords,
    };
  }

  async erase(ctx: Context, input: { recordId: string; confirm: string }): Promise<Erasure> {
    assertAllowed(actorOf(ctx), 'manageSettings', 'erase a person');
    const { record, email, name } = await this.person(ctx, input.recordId);
    // Typing who it is guards against erasing the wrong person; nothing here can be brought back.
    const expected = email ?? name.trim().toLowerCase();
    if (input.confirm.trim().toLowerCase() !== expected) throw new ValidationError(`To erase this person, confirm with their ${email ? 'email address' : 'name'} exactly.`);
    const objects = await this.workspace.definitions(ctx);
    const tenant = ctx.tenantId;
    const id = record.id;
    const gone = async (query: SQL) => (await this.rows(query)).length;
    return this.events.transaction(ctx, async () => {
      const messages = await gone(sql`delete from messages where tenant_id = ${tenant} and conversation_id in (select id from conversations where tenant_id = ${tenant} and contact_id = ${id}) returning id`);
      const conversations = await gone(sql`delete from conversations where tenant_id = ${tenant} and contact_id = ${id} returning id`);
      const activity = await gone(sql`delete from activities where tenant_id = ${tenant} and record_id = ${id} returning id`);
      const formSubmissions = await gone(sql`delete from submissions where tenant_id = ${tenant} and contact_id = ${id} returning id`);
      const meetings = await gone(sql`delete from meetings where tenant_id = ${tenant} and contact_id = ${id} returning id`);
      const sequences = await gone(sql`delete from enrollments where tenant_id = ${tenant} and contact_id = ${id} returning id`);
      const consents = email ? await gone(sql`delete from consents where tenant_id = ${tenant} and email = ${email} returning id`) : 0;
      // Copies kept for safety and history: mail as it arrived, notifications about them, what workflows did to them, and events not yet or already sent.
      let other = await gone(sql`delete from notifications where tenant_id = ${tenant} and record_id = ${id} returning id`);
      other += await gone(sql`delete from deal_people where tenant_id = ${tenant} and contact_id = ${id} returning id`);
      other += await gone(sql`delete from workflow_runs where tenant_id = ${tenant} and record_id = ${id} returning id`);
      other += await gone(sql`delete from mariachi_event_outbox where envelope->'payload'->>'recordId' = ${id} returning id`);
      if (email) other += await gone(sql`delete from inbound_emails where tenant_id = ${tenant} and lower(payload->>'fromEmail') = ${email} returning id`);

      // Deals and tasks about them stay, no longer pointing at anyone.
      let unlinked = 0;
      for (const object of objects) {
        for (const property of object.properties) {
          if (property.type !== 'reference' || property.referenceObjectId !== record.objectId) continue;
          unlinked += await gone(sql`update records set properties = jsonb_set(properties, array[${property.id}]::text[], 'null'::jsonb), updated_at = now() where tenant_id = ${tenant} and object_id = ${object.id} and properties->>${property.id}::text = ${id} returning id`);
        }
      }
      const removed = await gone(sql`delete from records where tenant_id = ${tenant} and id = ${id} returning id`);
      // The address alone is kept, blocked, so an import or a form next month cannot start emailing them again.
      if (email) {
        await this.db.execute(sql`
          insert into email_preferences (id, tenant_id, email, status, source, reason, changed_by)
          values (${`pref_${randomUUID().replace(/-/g, '').slice(0, 12)}`}, ${tenant}, ${email}, 'blocked', 'member', 'Erased at their request', ${actorOf(ctx).signedInId})
          on conflict (tenant_id, email) do update set status = 'blocked', source = 'member', reason = 'Erased at their request', changed_by = excluded.changed_by, updated_at = now()`);
      }
      await this.events.deleted(ctx, record);
      return { removed: { record: removed, activity, conversations, messages, formSubmissions, meetings, sequences, consents, other }, unlinked, blocked: email !== null };
    });
  }
}
