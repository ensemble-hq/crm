import type { Context } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { Activity, ActivityKind, CreateActivity } from '../../../../src/contracts/records';
import type { ActivityRow } from '../../schema';
import type { RecordsService } from '../records/records.service';
import type { ActivityRepository } from './activity.repository';

function toActivity(row: ActivityRow): Activity {
  return { id: row.id, recordId: row.recordId, kind: row.kind as ActivityKind, title: row.title, body: row.body ?? undefined, actorId: row.actorId, occurredAt: row.occurredAt.toISOString() };
}

export class ActivityService {
  constructor(
    private readonly activities: ActivityRepository,
    private readonly records: RecordsService,
  ) {}

  /** Newest first. Asking for a record you may not see fails the same way as asking for the record. */
  async list(ctx: Context, recordId: string): Promise<Activity[]> {
    await this.records.find(ctx, recordId);
    const rows = await this.activities.findMany(ctx, { recordId }, { sort: { field: 'occurredAt', direction: 'desc' }, limit: 200 });
    return rows.map(toActivity);
  }

  async create(ctx: Context, input: CreateActivity): Promise<Activity> {
    await this.records.find(ctx, input.recordId);
    const row = await this.activities.create(ctx, { id: `act_${randomUUID().replace(/-/g, '').slice(0, 12)}`, recordId: input.recordId, kind: input.kind, title: input.title, body: input.body ?? null, actorId: ctx.userId ?? 'system' });
    return toActivity(row);
  }
}
