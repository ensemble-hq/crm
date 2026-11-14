import { loadConfig } from '@mariachi/config';
import { createPostgresDatabase, runMigrations } from '@mariachi/database-postgres';
import { sql } from 'drizzle-orm';
import { objects, users } from '../../src/mock/definitions';
import { dataset, mulberry32 } from '../../src/mock/generate';
import { TENANT_ID } from './config';

/**
 * Fills an empty database with the demo company the mock uses: the same objects, people and
 * records, so the app looks the same on the server as it does on mock data. Run with `--reset` to
 * empty the database first. A real instance starts from the object definitions alone.
 */

const DAY = 86_400_000;
const BATCH = 2_000;

const HAPPENINGS: Array<{ kind: string; title: string; body?: string }> = [
  { kind: 'call', title: 'Call logged · 18 min', body: 'Talked through rollout timing. They want to start with one site and expand after the first quarter.' },
  { kind: 'email', title: 'Email received: Re: Proposal', body: 'This looks good. Can you confirm the onboarding timeline before we take it to the board?' },
  { kind: 'meeting', title: 'Meeting: Product walkthrough', body: 'Covered reporting and permissions. Next step is a security review with their IT lead.' },
  { kind: 'note', title: 'Note', body: 'Budget is approved for this year. The decision sits with operations, finance only signs off.' },
  { kind: 'email', title: 'Email sent: Following up', body: 'Sharing the summary from our call and the two case studies you asked about.' },
  { kind: 'call', title: 'Call logged · 6 min', body: 'Left a voicemail and followed up by email.' },
  { kind: 'meeting', title: 'Meeting: Quarterly review', body: 'Usage is up across both teams. They asked about adding seats in the new year.' },
  { kind: 'note', title: 'Note', body: 'Prefers email to calls. Best reached before 10am their time.' },
];

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.database) throw new Error('DATABASE_URL is required');
  const database = createPostgresDatabase({ url: config.database.url });
  await database.connect();
  const db = database.db;
  try {
    await runMigrations(database.adapter, { migrationsFolder: 'drizzle' });
    if (process.argv.includes('--reset')) await db.execute(sql`truncate activities, records, objects, people`);
    const [existing] = (await db.execute(sql`select count(*)::int as total from objects`)) as unknown as Array<{ total: number }>;
    if ((existing?.total ?? 0) > 0) {
      console.log('The database already has data. Run with --reset to replace it.');
      return;
    }

    for (const [position, definition] of objects.entries()) {
      await db.execute(sql`insert into objects (id, tenant_id, position, definition) values (${definition.id}, ${TENANT_ID}, ${position}, ${JSON.stringify(definition)}::jsonb)`);
    }
    for (const user of users) await db.execute(sql`insert into people (id, tenant_id, name, email) values (${user.id}, ${TENANT_ID}, ${user.name}, ${user.email})`);

    const records = [...dataset().byId.values()];
    for (let start = 0; start < records.length; start += BATCH) {
      const batch = records.slice(start, start + BATCH).map((record) => ({ id: record.id, object_id: record.objectId, properties: record.properties, created_at: record.createdAt }));
      await db.execute(sql`
        insert into records (id, tenant_id, object_id, properties, created_at, updated_at)
        select row.id, ${TENANT_ID}, row.object_id, row.properties, row.created_at, row.created_at
        from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as row(id text, object_id text, properties jsonb, created_at timestamptz)`);
    }

    // A few things have happened on every record that has a story. The latest matches the record's own "last activity" where it has one.
    const random = mulberry32(7_2026);
    const now = Date.now();
    const activities: Array<Record<string, string | undefined>> = [];
    for (const record of records) {
      if (record.objectId === 'tasks' || record.objectId === 'products') continue;
      const created = Date.parse(record.createdAt);
      const last = typeof record.properties.lastActivity === 'string' ? Math.min(Date.parse(record.properties.lastActivity) + 9 * 3_600_000, now) : created + random() * Math.max(now - created, DAY);
      const count = 2 + Math.floor(random() * 4);
      for (let index = 0; index < count; index += 1) {
        const happening = HAPPENINGS[Math.floor(random() * HAPPENINGS.length)] ?? HAPPENINGS[0];
        const at = index === 0 ? last : created + random() * Math.max(last - created, DAY);
        activities.push({ id: `act_${record.id}_${index}`, record_id: record.id, kind: happening?.kind, title: happening?.title, body: happening?.body, actor_id: users[Math.floor(random() * users.length)]?.id, occurred_at: new Date(Math.min(at, last)).toISOString() });
      }
    }
    for (let start = 0; start < activities.length; start += BATCH * 2) {
      await db.execute(sql`
        insert into activities (id, tenant_id, record_id, kind, title, body, actor_id, occurred_at)
        select row.id, ${TENANT_ID}, row.record_id, row.kind, row.title, row.body, row.actor_id, row.occurred_at
        from jsonb_to_recordset(${JSON.stringify(activities.slice(start, start + BATCH * 2))}::jsonb) as row(id text, record_id text, kind text, title text, body text, actor_id text, occurred_at timestamptz)`);
    }
    console.log(`Seeded ${objects.length} objects, ${users.length} people, ${records.length} records and ${activities.length} activities.`);
  } finally {
    await database.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
