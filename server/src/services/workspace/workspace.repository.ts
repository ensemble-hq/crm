import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type ObjectRow, objectsTable } from '../../schema';

export class ObjectsRepository extends DrizzleRepository<ObjectRow> {
  constructor(db: DrizzleDb) {
    super(objectsTable, db);
  }
}
