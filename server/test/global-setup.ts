import postgres from 'postgres';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://crm:dev@localhost:5442/crm_test';

/** Makes the test database if it is not there. The tables are made by the first test file that connects. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const existing = await sql`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) await sql.unsafe(`create database "${name}"`);
  } catch (error) {
    throw new Error(`The tests need the development database running (pnpm db:up). ${error instanceof Error ? error.message : ''}`);
  } finally {
    await sql.end();
  }
}
