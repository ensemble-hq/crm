import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type PersonRow, type RoleRow, type TeamRow, peopleTable, rolesTable, teamsTable } from '../../schema';

export class PeopleRepository extends DrizzleRepository<PersonRow> {
  constructor(db: DrizzleDb) {
    super(peopleTable, db);
  }
}

export class TeamsRepository extends DrizzleRepository<TeamRow> {
  constructor(db: DrizzleDb) {
    super(teamsTable, db);
  }
}

export class RolesRepository extends DrizzleRepository<RoleRow> {
  constructor(db: DrizzleDb) {
    super(rolesTable, db);
  }
}
