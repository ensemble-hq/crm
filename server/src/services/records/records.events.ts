import type { Context } from '@mariachi/core';
import type { Outbox } from '@mariachi/events/outbox';
import type { PropertyValue } from '../../../../src/contracts/metadata';
import type { CrmRecord } from '../../../../src/contracts/records';
import { type Origin, recordChanged, recordCreated, recordDeleted } from '../../events';

/** Announces record changes. Each method must be called inside the transaction that makes the change. */
export class RecordEvents {
  constructor(
    private readonly outbox: Outbox,
    /** Runs `fn` in one database transaction; the events it records are only sent if it commits. */
    readonly transaction: <T>(ctx: Context, fn: () => Promise<T>) => Promise<T>,
  ) {}

  async created(ctx: Context, record: CrmRecord, origin: Origin = 'person'): Promise<void> {
    await this.outbox.add(ctx, recordCreated, { recordId: record.id, objectId: record.objectId, origin });
  }

  async changed(ctx: Context, record: CrmRecord, changed: Record<string, PropertyValue>, origin: Origin = 'person'): Promise<void> {
    if (Object.keys(changed).length > 0) await this.outbox.add(ctx, recordChanged, { recordId: record.id, objectId: record.objectId, changed, origin });
  }

  async deleted(ctx: Context, record: CrmRecord, origin: Origin = 'person'): Promise<void> {
    await this.outbox.add(ctx, recordDeleted, { recordId: record.id, objectId: record.objectId, origin });
  }
}
