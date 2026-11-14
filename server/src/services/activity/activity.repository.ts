import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type ActivityRow, activitiesTable } from '../../schema';

export class ActivityRepository extends DrizzleRepository<ActivityRow> {
  constructor(db: DrizzleDb) {
    super(activitiesTable, db);
  }
}
