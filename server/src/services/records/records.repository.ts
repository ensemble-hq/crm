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

  async byIds(ctx: Context, ids: string[], ...where: SQL[]): Promise<CrmRecord[]> {
    if (ids.length === 0) return [];
    const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const rows = await this.rows<Raw>(sql`select ${COLUMNS} from records where ${this.scope(ctx, sql`records.id in (${list})`, ...where)}`);
    return rows.map(toRecord);
  }

  async one(ctx: Context, id: string, ...where: SQL[]): Promise<CrmRecord | undefined> {
    return (await this.byIds(ctx, [id], ...where))[0];
  }

  /** Count, and the sum of a number property, for each value of a property. */
  async groups(ctx: Context, where: SQL[], groupBy: string, sumProperty: string | undefined): Promise<Array<{ value: string | null; count: number; sum: number }>> {
    const group = sql`case when jsonb_typeof(records.properties->${groupBy}::text) = 'string' then records.properties->>${groupBy}::text end`;
    const amount = sumProperty ? sql`coalesce(sum(case when jsonb_typeof(records.properties->${sumProperty}::text) = 'number' then (records.properties->>${sumProperty}::text)::numeric else 0 end), 0)::float8` : sql`0::float8`;
    return this.rows(sql`select ${group} as value, count(*)::int as count, ${amount} as sum from records where ${this.scope(ctx, ...where)} group by 1`);
  }

  /**
   * Count and sum for each combination of some keys, where each key is a SQL expression that yields
   * text or null. Reports and the forecast are built on this.
   */
  async aggregate(ctx: Context, where: SQL[], keys: SQL[], sumProperty: string | undefined, from: SQL = sql`records`): Promise<Array<{ keys: Array<string | null>; count: number; sum: number }>> {
    const amount = sumProperty ? sql`coalesce(sum(case when jsonb_typeof(records.properties->${sumProperty}::text) = 'number' then (records.properties->>${sumProperty}::text)::numeric else 0 end), 0)::float8` : sql`0::float8`;
    const selected = keys.length > 0 ? sql`${sql.join(keys.map((key, index) => sql`${key} as ${sql.raw(`k${index}`)}`), sql`, `)}, ` : sql``;
    const grouping = keys.length > 0 ? sql`group by ${sql.join(keys.map((_, index) => sql.raw(String(index + 1))), sql`, `)}` : sql``;
    const rows = await this.rows<Record<string, string | number | null>>(sql`select ${selected}count(*)::int as count, ${amount} as sum from ${from} where ${this.scope(ctx, ...where)} ${grouping}`);
    return rows.map((row) => ({ keys: keys.map((_, index) => (row[`k${index}`] as string | null) ?? null), count: Number(row.count), sum: Number(row.sum) }));
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

  /** The record of an object whose property is this text, ignoring case: a contact by email. */
  async byText(ctx: Context, objectId: string, propertyId: string, value: string): Promise<CrmRecord | undefined> {
    const rows = await this.rows<Raw>(sql`select ${COLUMNS} from records where ${this.scope(ctx, sql`records.object_id = ${objectId}`, sql`lower(records.properties->>${propertyId}::text) = ${value.toLowerCase()}`)} order by records.created_at limit 1`);
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  /** Every record of an object by one property's text, lower-cased: for matching a file's rows to what is already here. */
  async index(ctx: Context, objectId: string, propertyId: string): Promise<Map<string, string>> {
    const rows = await this.rows<{ key: string; id: string }>(
      sql`select lower(records.properties->>${propertyId}::text) as key, records.id from records where ${this.scope(ctx, sql`records.object_id = ${objectId}`, sql`jsonb_typeof(records.properties->${propertyId}::text) = 'string'`, sql`records.properties->>${propertyId}::text <> ''`)}`,
    );
    return new Map(rows.map((row) => [row.key, row.id]));
  }

  /** Adds many records in one statement. */
  async insertMany(ctx: Context, records: Array<{ id: string; objectId: string; properties: Record<string, PropertyValue> }>): Promise<void> {
    if (records.length === 0) return;
    await this.db.execute(sql`
      insert into records (id, tenant_id, object_id, properties)
      select item.id, ${ctx.tenantId}, item."objectId", item.properties
      from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as item(id text, "objectId" text, properties jsonb)`);
  }

  /** Merges changes into many records in one statement. */
  async patchMany(ctx: Context, changes: Array<{ id: string; changes: Record<string, PropertyValue> }>): Promise<void> {
    if (changes.length === 0) return;
    await this.db.execute(sql`
      update records set properties = records.properties || item.changes, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) as item(id text, changes jsonb)
      where ${this.scope(ctx, sql`records.id = item.id`)}`);
  }

  /** Values of a property that more than one record has, ignoring case and spaces around, with the records that share each. */
  async sharedValues(ctx: Context, where: SQL[], propertyId: string, limit: number): Promise<{ groups: Array<{ value: string; count: number; ids: string[] }>; total: number }> {
    const value = sql`lower(btrim(records.properties->>${propertyId}::text))`;
    const scope = this.scope(ctx, ...where, sql`jsonb_typeof(records.properties->${propertyId}::text) = 'string'`, sql`btrim(records.properties->>${propertyId}::text) <> ''`);
    const rows = await this.rows<{ value: string; count: number; ids: string[]; total: number }>(sql`
      select value, count, ids, count(*) over ()::int as total from (
        select ${value} as value, count(*)::int as count, array_agg(records.id order by records.created_at) as ids from records where ${scope} group by 1 having count(*) > 1
      ) shared order by count desc, value limit ${limit}`);
    return { groups: rows.map((row) => ({ value: row.value, count: row.count, ids: row.ids })), total: rows[0]?.total ?? 0 };
  }

  /** Takes a property off every record of an object, when the property itself is deleted. */
  async dropProperty(ctx: Context, objectId: string, propertyId: string): Promise<void> {
    await this.db.execute(sql`update records set properties = records.properties - ${propertyId}::text where ${this.scope(ctx, sql`records.object_id = ${objectId}`, sql`records.properties ? ${propertyId}`)}`);
  }

  /** Makes everything that pointed at one record point at another: linked records, activity, conversations, enrolments, line items and notifications. */
  async repoint(ctx: Context, fromId: string, toId: string, references: Array<{ objectId: string; propertyId: string }>): Promise<void> {
    for (const reference of references) {
      await this.db.execute(
        sql`update records set properties = jsonb_set(records.properties, array[${reference.propertyId}::text], to_jsonb(${toId}::text)), updated_at = now() where ${this.scope(ctx, sql`records.object_id = ${reference.objectId}`, sql`records.properties->>${reference.propertyId}::text = ${fromId}`)}`,
      );
    }
    const tenant = sql`tenant_id = ${ctx.tenantId}`;
    await this.db.execute(sql`update activities set record_id = ${toId} where ${tenant} and record_id = ${fromId}`);
    await this.db.execute(sql`update notifications set record_id = ${toId} where ${tenant} and record_id = ${fromId}`);
    await this.db.execute(sql`update workflow_runs set record_id = ${toId} where ${tenant} and record_id = ${fromId}`);
    await this.db.execute(sql`update conversations set contact_id = ${toId} where ${tenant} and contact_id = ${fromId}`);
    await this.db.execute(sql`update conversations set company_id = ${toId} where ${tenant} and company_id = ${fromId}`);
    await this.db.execute(sql`update conversations set deal_id = ${toId} where ${tenant} and deal_id = ${fromId}`);
    await this.db.execute(sql`update enrollments set contact_id = ${toId} where ${tenant} and contact_id = ${fromId}`);
    await this.db.execute(sql`update line_items set deal_id = ${toId} where ${tenant} and deal_id = ${fromId}`);
  }

  /** Hands every record one person owns to another. */
  async reassign(ctx: Context, fromId: string, toId: string): Promise<number> {
    const rows = await this.rows<{ id: string }>(
      sql`update records set properties = jsonb_set(records.properties, '{owner}', to_jsonb(${toId}::text)), updated_at = now() where ${this.scope(ctx, sql`records.properties->>'owner' = ${fromId}`)} returning records.id`,
    );
    return rows.length;
  }

  async remove(ctx: Context, ids: string[]): Promise<number> {
    const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const rows = await this.rows<{ id: string }>(sql`update records set deleted_at = now(), updated_at = now() where ${this.scope(ctx, sql`records.id in (${list})`)} returning records.id`);
    return rows.length;
  }
}
