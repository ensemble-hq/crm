import type { Context } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { and, sql } from 'drizzle-orm';
import { type ObjectRow, objectsTable } from '../../schema';

export class ObjectsRepository extends DrizzleRepository<ObjectRow> {
  constructor(db: DrizzleDb) {
    super(objectsTable, db);
  }

  /** Holds an object's definition for the rest of the transaction, so two changes to it cannot overwrite each other. */
  async lock(ctx: Context, id: string): Promise<void> {
    await this.db.execute(sql`select id from objects where ${and(this.buildWhere(ctx), sql`objects.id = ${id}`)} for update`);
  }
}
