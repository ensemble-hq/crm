import { ConfigError, KEYS } from '@mariachi/core';
import { createPostgresDatabase } from '@mariachi/database-postgres';
import { DefaultEvents, createEventBus } from '@mariachi/events';
import { OutboxRelay } from '@mariachi/events/outbox';
import { bootstrap } from '@mariachi/lifecycle';
import { useConfigSection } from '@mariachi/config';
import { CRM_CONFIG, type CrmSettings, TENANT_ID } from './config';
import { createEmailProvider } from './email';
import { conversationChanged, emailQueued, emailReceived, recordChanged, recordCreated, recordDeleted, settingsChanged } from './events';
import { announce, createLive } from './live';
import { createServices } from './services/index';

/**
 * The worker: the part of the CRM that reacts to changes. It sends the events the API recorded
 * and runs workflows from them. It can be stopped and started freely: events wait in the database
 * until it is back, and an event delivered twice runs a workflow once.
 */
async function main(): Promise<void> {
  const { config, logger, tracer, metrics, container, lifecycle } = bootstrap();
  if (!config.database) throw new ConfigError('crm/database-required', 'DATABASE_URL is required');
  if (!config.redis) throw new ConfigError('crm/redis-required', 'REDIS_URL is required');

  const database = lifecycle.manage('database', createPostgresDatabase({ url: config.database.url, poolMax: config.database.poolMax }), { priority: 10 });
  container.register(KEYS.Database, database);
  await database.connect();

  const events = lifecycle.manage('events', new DefaultEvents({ bus: createEventBus({ adapter: 'redis-streams', url: config.redis.url, prefix: config.serviceName }), source: config.serviceName }, { logger, tracer, metrics }), { priority: 20 });
  const settings = useConfigSection<CrmSettings>(CRM_CONFIG);
  const { runner, mail, sequences, reports, settings: shape } = createServices({ db: database.db, transaction: database.transaction, source: config.serviceName, email: createEmailProvider(settings, database.db), secretsKey: settings.secretsKey, appOrigin: settings.appOrigin });

  // Live updates: once the work a change sets off is done, open browsers are told what to read again.
  const live = lifecycle.manage('live', createLive(config.redis.url, config.serviceName, { logger, tracer, metrics }), { priority: 25 });
  const recordsChanged = (ctx: Parameters<typeof announce>[1], objectId: string) => announce(live, ctx, { topic: 'records', objectId });
  events.subscribe(recordDeleted, (ctx, payload) => recordsChanged(ctx, payload.objectId), { group: 'live', name: 'live.deleted' });
  events.subscribe(settingsChanged, (ctx) => announce(live, ctx, { topic: 'settings' }), { group: 'live', name: 'live.settings' });
  events.subscribe(conversationChanged, (ctx) => announce(live, ctx, { topic: 'inbox' }), { group: 'live', name: 'live.conversation' });

  // Changes a workflow made are announced too, for whoever else listens, but never set off workflows.
  events.subscribe(
    recordCreated,
    async (ctx, payload, meta) => {
      // A workflow may notify someone; what it creates or changes is announced by its own events.
      if (payload.origin === 'person' && (await runner.handle(ctx, { kind: 'created', recordId: payload.recordId }, meta.id)) > 0) await announce(live, ctx, { topic: 'notifications' });
      await recordsChanged(ctx, payload.objectId);
    },
    { group: 'workflows', name: 'workflows.created' },
  );
  events.subscribe(
    recordChanged,
    async (ctx, payload, meta) => {
      if (payload.origin === 'person' && (await runner.handle(ctx, { kind: 'changed', recordId: payload.recordId, changed: payload.changed }, meta.id)) > 0) await announce(live, ctx, { topic: 'notifications' });
      await recordsChanged(ctx, payload.objectId);
    },
    { group: 'workflows', name: 'workflows.changed' },
  );

  // Moves committed events from the database to the bus. Started after the subscriptions exist.
  // Email: file what arrived, send what was queued. Both are safe to repeat.
  const inboxChanged = async (ctx: Parameters<typeof announce>[1]) => {
    await announce(live, ctx, { topic: 'inbox' });
    // A failed send tells its sender, and a filed email is logged on the contact.
    await announce(live, ctx, { topic: 'notifications' });
  };
  events.subscribe(
    emailReceived,
    async (ctx, payload) => {
      await mail.file(ctx, payload.inboundId);
      await inboxChanged(ctx);
    },
    { group: 'email', name: 'email.file' },
  );
  events.subscribe(
    emailQueued,
    async (ctx, payload) => {
      await mail.deliver(ctx, payload.messageId);
      await inboxChanged(ctx);
    },
    { group: 'email', name: 'email.deliver' },
  );

  // The sweep: on a timer, finish anything the events above did not, and ask the email service what it has that we were never told about.
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const ctx = { traceId: `sweep-${Date.now()}`, userId: null, tenantId: TENANT_ID, scopes: [], identityType: 'service', logger };
      // Sequence steps first, so an email a step queues is sent in this same pass if the event path is slow.
      const steps = await sequences.runDue(ctx);
      if (steps > 0) logger.info({ steps }, 'Sequence steps carried out');
      const done = await mail.sweep(ctx);
      if (done.filed + done.sent + done.released + done.found > 0) logger.info(done, 'Email sweep picked up work the first path missed');
      if (steps + done.filed + done.sent + done.found > 0) await inboxChanged(ctx);
      const reported = await reports.deliverDue(ctx);
      if (reported > 0) logger.info({ reported }, 'Scheduled reports emailed');
      // Workflows on a schedule that have come due. What they change is announced by its own events.
      const scheduled = await runner.scheduled(ctx);
      if (scheduled > 0) {
        logger.info({ scheduled }, 'Scheduled workflows ran');
        await announce(live, ctx, { topic: 'notifications' });
      }
    } catch (error) {
      logger.error({ error }, 'The sweep failed; it will run again');
    } finally {
      sweeping = false;
    }
  };
  // Computed fields that count from today ("days until close") change as days pass, so they are worked out again every hour.
  const refresh = async () => {
    const ctx = { traceId: `formulas-${Date.now()}`, userId: null, tenantId: TENANT_ID, scopes: [], identityType: 'service', logger };
    try {
      for (const objectId of await shape.dated(ctx)) {
        const written = await shape.recompute(ctx, objectId);
        if (written > 0) await announce(live, ctx, { topic: 'records', objectId });
      }
    } catch (error) {
      logger.error({ error }, 'Computed fields could not be refreshed; they will be tried again in an hour');
    }
  };
  let hourly: NodeJS.Timeout | undefined;
  lifecycle.startup.register({ name: 'formula-refresh', priority: 96, fn: async () => void (hourly = setInterval(() => void refresh(), 3_600_000), void refresh()) });
  lifecycle.shutdown.register({ name: 'formula-refresh', priority: 96, fn: async () => clearInterval(hourly) });

  let timer: NodeJS.Timeout | undefined;
  lifecycle.startup.register({ name: 'email-sweep', priority: 95, fn: async () => void (timer = setInterval(() => void sweep(), settings.sweepSeconds * 1000)) });
  lifecycle.shutdown.register({ name: 'email-sweep', priority: 95, fn: async () => clearInterval(timer) });

  lifecycle.manage('outbox-relay', new OutboxRelay({ db: database.db, target: events, logger }), { priority: 30 });

  await lifecycle.start();
  logger.info({}, 'CRM worker running');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
