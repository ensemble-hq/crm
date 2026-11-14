import type { Context } from '@mariachi/core';
import { randomUUID } from 'node:crypto';
import type { Notification, Reference } from '../../../../src/contracts/records';
import type { RecordsRepository } from '../records/records.repository';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { NotificationsRepository } from './notifications.repository';

export class NotificationsService {
  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly records: RecordsRepository,
    private readonly workspace: WorkspaceService,
  ) {}

  /** The acting person's notifications, newest first, with names for the records they are about. */
  async list(ctx: Context): Promise<{ notifications: Notification[]; references: Record<string, Reference> }> {
    const rows = await this.notifications.findMany(ctx, { userId: ctx.userId ?? '' }, { sort: { field: 'createdAt', direction: 'desc' }, limit: 50 });
    const objects = await this.workspace.definitions(ctx);
    const references: Record<string, Reference> = {};
    // A notification is addressed to one person about one record, so its name is shown even if their role would not list it.
    for (const record of await this.records.byIds(ctx, [...new Set(rows.flatMap((row) => (row.recordId ? [row.recordId] : [])))])) {
      const primary = objects.find((object) => object.id === record.objectId)?.primaryProperty;
      const label = primary ? record.properties[primary] : undefined;
      references[record.id] = { objectId: record.objectId, label: typeof label === 'string' ? label : record.id };
    }
    return { notifications: rows.map((row) => ({ id: row.id, message: row.message, recordId: row.recordId, createdAt: row.createdAt.toISOString(), read: row.read })), references };
  }

  /** Marks one notification read, or all of the acting person's when no id is given. */
  async markRead(ctx: Context, id: string | undefined): Promise<void> {
    await this.notifications.updateWhere(ctx, { userId: ctx.userId ?? '', ...(id ? { id } : {}) }, { read: true });
  }

  async send(ctx: Context, userId: string, message: string, recordId: string | null): Promise<void> {
    await this.notifications.create(ctx, { id: `ntf_${randomUUID().replace(/-/g, '').slice(0, 12)}`, userId, message, recordId, read: false });
  }
}
