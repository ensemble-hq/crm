import { loadConfig } from '@mariachi/config';
import { createPostgresDatabase, runMigrations } from '@mariachi/database-postgres';
import { sql } from 'drizzle-orm';
import type { WorkflowSettings } from '../../src/contracts/workflows';
import { objects, users } from '../../src/mock/definitions';
import { dataset, mulberry32 } from '../../src/mock/generate';
import { emailTemplates, inbox } from '../../src/mock/inbox';
import { dashboards, reports } from '../../src/mock/reports';
import { PLACEMENT, roles, teams } from '../../src/mock/team';
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

/** What each person is expected to close this quarter. */
const GOALS: Record<string, number> = { usr_maya: 2_200_000, usr_priya: 2_000_000, usr_jonas: 1_500_000, usr_dario: 4_000_000, usr_aiko: 1_200_000, usr_femi: 950_000 };

/** The workflows the demo company starts with. */
const WORKFLOWS: Array<WorkflowSettings & { id: string }> = [
  {
    id: 'wf_won',
    name: 'Welcome pack when a deal is won',
    on: true,
    objectId: 'deals',
    trigger: { kind: 'changed', property: 'stage', to: 'won' },
    conditions: [],
    actions: [
      { id: 'a1', kind: 'create-task', title: 'Send the welcome pack', dueInDays: 2 },
      { id: 'a2', kind: 'notify', message: 'A deal you own was won. A welcome-pack task is on your list.' },
    ],
  },
  {
    id: 'wf_route',
    name: 'Share out new contacts with no owner',
    on: true,
    objectId: 'contacts',
    trigger: { kind: 'created' },
    conditions: [{ property: 'owner', operator: 'empty' }],
    actions: [
      { id: 'a1', kind: 'assign', userIds: ['usr_priya', 'usr_jonas', 'usr_dario'] },
      { id: 'a2', kind: 'create-task', title: 'Call the new lead', dueInDays: 1 },
    ],
  },
  {
    id: 'wf_big',
    name: 'Flag large new deals',
    on: false,
    objectId: 'deals',
    trigger: { kind: 'created' },
    conditions: [{ property: 'amount', operator: 'gt', value: 100_000 }],
    actions: [
      { id: 'a1', kind: 'set-property', property: 'priority', value: 'high' },
      { id: 'a2', kind: 'notify', message: 'A deal over $100,000 was created.' },
    ],
  },
];

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.database) throw new Error('DATABASE_URL is required');
  const database = createPostgresDatabase({ url: config.database.url });
  await database.connect();
  const db = database.db;
  try {
    await runMigrations(database.adapter, { migrationsFolder: 'drizzle' });
    if (process.argv.includes('--reset')) await db.execute(sql`truncate activities, records, objects, people, teams, roles, workflows, workflow_runs, notifications, mariachi_event_outbox, conversations, messages, inbound_emails, email_templates, mail_cursors, dev_mail, reports, dashboards, goals`);
    const [existing] = (await db.execute(sql`select count(*)::int as total from objects`)) as unknown as Array<{ total: number }>;
    if ((existing?.total ?? 0) > 0) {
      console.log('The database already has data. Run with --reset to replace it.');
      return;
    }

    for (const [position, definition] of objects.entries()) {
      await db.execute(sql`insert into objects (id, tenant_id, position, definition) values (${definition.id}, ${TENANT_ID}, ${position}, ${JSON.stringify(definition)}::jsonb)`);
    }
    for (const [position, { id, builtIn, ...settings }] of roles.entries()) {
      await db.execute(sql`insert into roles (id, tenant_id, settings, built_in, position) values (${id}, ${TENANT_ID}, ${JSON.stringify(settings)}::jsonb, ${builtIn}, ${position})`);
    }
    for (const team of teams) await db.execute(sql`insert into teams (id, tenant_id, name) values (${team.id}, ${TENANT_ID}, ${team.name})`);
    for (const [index, user] of users.entries()) {
      const placement = PLACEMENT[user.id];
      // Staggered so the directory lists people in the order they joined.
      await db.execute(sql`insert into people (id, tenant_id, name, email, role_id, team_id, created_at) values (${user.id}, ${TENANT_ID}, ${user.name}, ${user.email}, ${placement?.roleId ?? 'role_rep'}, ${placement?.teamId ?? null}, now() - make_interval(mins => ${users.length - index}))`);
    }

    for (const [index, { id, ...settings }] of WORKFLOWS.entries()) {
      await db.execute(sql`insert into workflows (id, tenant_id, settings, created_at) values (${id}, ${TENANT_ID}, ${JSON.stringify(settings)}::jsonb, now() - make_interval(mins => ${WORKFLOWS.length - index}))`);
    }

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
    for (const [index, { id, ...settings }] of reports.entries()) {
      await db.execute(sql`insert into reports (id, tenant_id, settings, created_at) values (${id}, ${TENANT_ID}, ${JSON.stringify(settings)}::jsonb, now() - make_interval(mins => ${reports.length - index}))`);
    }
    for (const dashboard of dashboards) await db.execute(sql`insert into dashboards (id, tenant_id, name, report_ids) values (${dashboard.id}, ${TENANT_ID}, ${dashboard.name}, ${JSON.stringify(dashboard.reportIds)}::jsonb)`);
    for (const [userId, amount] of Object.entries(GOALS)) await db.execute(sql`insert into goals (id, tenant_id, amount) values (${userId}, ${TENANT_ID}, ${amount})`);

    // The demo inbox: threads that already happened, so every message is either received or sent.
    for (const [index, template] of emailTemplates.entries()) {
      await db.execute(sql`insert into email_templates (id, tenant_id, name, subject, body, created_at) values (${template.id}, ${TENANT_ID}, ${template.name}, ${template.subject}, ${template.body}, now() - make_interval(mins => ${emailTemplates.length - index}))`);
    }
    const { conversations, messages } = inbox();
    await db.execute(sql`
      insert into conversations (id, tenant_id, subject, status, assignee_id, contact_id, company_id, deal_id, unread, last_message_at, preview, message_count)
      select row.id, ${TENANT_ID}, row.subject, row.status, row."assigneeId", row."contactId", row."companyId", row."dealId", row.unread, row."lastMessageAt", row.preview, row."messageCount"
      from jsonb_to_recordset(${JSON.stringify(conversations)}::jsonb) as row(id text, subject text, status text, "assigneeId" text, "contactId" text, "companyId" text, "dealId" text, unread boolean, "lastMessageAt" timestamptz, preview text, "messageCount" int)`);
    const subjects = new Map(conversations.map((conversation) => [conversation.id, conversation.subject]));
    const allMessages = [...messages.values()].flat().map((message) => ({ ...message, subject: subjects.get(message.conversationId) ?? '', status: message.direction === 'in' ? 'received' : 'sent', header: `<${message.id}@seed>` }));
    await db.execute(sql`
      insert into messages (id, tenant_id, conversation_id, direction, from_name, from_email, subject, body, status, message_id_header, sent_at)
      select row.id, ${TENANT_ID}, row."conversationId", row.direction, row."fromName", row."fromEmail", row.subject, row.body, row.status, row.header, row."sentAt"
      from jsonb_to_recordset(${JSON.stringify(allMessages)}::jsonb) as row(id text, "conversationId" text, direction text, "fromName" text, "fromEmail" text, subject text, body text, status text, header text, "sentAt" timestamptz)`);

    console.log(`Seeded ${objects.length} objects, ${users.length} people, ${records.length} records and ${activities.length} activities.`);
  } finally {
    await database.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
