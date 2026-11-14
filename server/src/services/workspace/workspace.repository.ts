import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type ObjectRow, type PersonRow, objectsTable, peopleTable } from '../../schema';

export class ObjectsRepository extends DrizzleRepository<ObjectRow> {
  constructor(db: DrizzleDb) {
    super(objectsTable, db);
  }
}

export class PeopleRepository extends DrizzleRepository<PersonRow> {
  constructor(db: DrizzleDb) {
    super(peopleTable, db);
  }
}
