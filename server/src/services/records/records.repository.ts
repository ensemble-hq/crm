import type { Context } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { type SQL, and, sql } from 'drizzle-orm';
import type { PropertyValue } from '../../../../src/contracts/metadata';
import type { CrmRecord } from '../../../../src/contracts/records';
import { type RecordRow, recordsTable } from '../../schema';

type Raw = { id: string; object_id: string; properties: Record<string, PropertyValue>; created_at: string; updated_at: string };

const COLUMNS = sql`records.id, records.object_id, records.properties, to_char(records.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at, to_char(records.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at`;

function toRecord(row: Raw): CrmRecord {
  return { id: row.id, objectId: row.object_id, properties: row.properties, createdAt: row.created_at, updatedAt: row.updated_at };
}

/**
 * Records are read with SQL written here, because filters and sorting reach into the JSONB column.
 * Every query starts from `scope`, which limits it to the caller's tenant and leaves out deleted rows.
 */
export class RecordsRepository extends DrizzleRepository<RecordRow> {
  constructor(db: DrizzleDb) {
    super(recordsTable, db);
  }

  private scope(ctx: Context, ...conditions: SQL[]): SQL {
    return and(this.buildWhere(ctx), ...conditions) as SQL;
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.db.execute(query)) as unknown as T[];
  }

  async select(ctx: Context, where: SQL[], orderBy: SQL, limit: number, offset: number): Promise<CrmRecord[]> {
    const rows = await this.rows<Raw>(sql`select ${COLUMNS} from records where ${this.scope(ctx, ...where)} order by ${orderBy} limit ${limit} offset ${offset}`);
    return rows.map(toRecord);
  }

  async total(ctx: Context, where: SQL[]): Promise<number> {
    const [row] = await this.rows<{ total: number }>(sql`select count(*)::int as total from records where ${this.scope(ctx, ...where)}`);
    return row?.total ?? 0;
  }

  async byIds(ctx: Context, ids: string[]): Promise<CrmRecord[]> {
    if (ids.length === 0) return [];
    const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const rows = await this.rows<Raw>(sql`select ${COLUMNS} from records where ${this.scope(ctx, sql`records.id in (${list})`)}`);
    return rows.map(toRecord);
  }

  async one(ctx: Context, id: string): Promise<CrmRecord | undefined> {
    return (await this.byIds(ctx, [id]))[0];
  }

  /** Count, and the sum of a number property, for each value of a property. */
  async groups(ctx: Context, where: SQL[], groupBy: string, sumProperty: string | undefined): Promise<Array<{ value: string | null; count: number; sum: number }>> {
    const group = sql`case when jsonb_typeof(records.properties->${groupBy}::text) = 'string' then records.properties->>${groupBy}::text end`;
    const amount = sumProperty ? sql`coalesce(sum(case when jsonb_typeof(records.properties->${sumProperty}::text) = 'number' then (records.properties->>${sumProperty}::text)::numeric else 0 end), 0)::float8` : sql`0::float8`;
    return this.rows(sql`select ${group} as value, count(*)::int as count, ${amount} as sum from records where ${this.scope(ctx, ...where)} group by 1`);
  }

  async insert(ctx: Context, record: { id: string; objectId: string; properties: Record<string, PropertyValue> }): Promise<CrmRecord> {
    await this.create(ctx, record);
    return (await this.one(ctx, record.id)) as CrmRecord;
  }

  /** Merges `changes` into the record's properties, leaving the others as they are. */
  async patch(ctx: Context, id: string, changes: Record<string, PropertyValue>): Promise<CrmRecord | undefined> {
    await this.db.execute(sql`update records set properties = records.properties || ${JSON.stringify(changes)}::jsonb, updated_at = now() where ${this.scope(ctx, sql`records.id = ${id}`)}`);
    return this.one(ctx, id);
  }

  async remove(ctx: Context, ids: string[]): Promise<number> {
    const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const rows = await this.rows<{ id: string }>(sql`update records set deleted_at = now(), updated_at = now() where ${this.scope(ctx, sql`records.id in (${list})`)} returning records.id`);
    return rows.length;
  }
}
