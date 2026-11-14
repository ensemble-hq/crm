import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type NotificationRow, notificationsTable } from '../../schema';

export class NotificationsRepository extends DrizzleRepository<NotificationRow> {
  constructor(db: DrizzleDb) {
    super(notificationsTable, db);
  }
}
