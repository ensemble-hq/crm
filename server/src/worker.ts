import { ConfigError, KEYS } from '@mariachi/core';
import { createPostgresDatabase } from '@mariachi/database-postgres';
import { DefaultEvents, createEventBus } from '@mariachi/events';
import { OutboxRelay } from '@mariachi/events/outbox';
import { bootstrap } from '@mariachi/lifecycle';
import { useConfigSection } from '@mariachi/config';
import { CRM_CONFIG, type CrmSettings, TENANT_ID } from './config';
import { createEmailProvider } from './email';
import { emailQueued, emailReceived, recordChanged, recordCreated } from './events';
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
  const { runner, mail, sequences } = createServices({ db: database.db, transaction: database.transaction, source: config.serviceName, email: createEmailProvider(settings, database.db) });

  // Changes a workflow made are announced too, for whoever else listens, but never set off workflows.
  events.subscribe(
    recordCreated,
    async (ctx, payload, meta) => {
      if (payload.origin === 'person') await runner.handle(ctx, { kind: 'created', recordId: payload.recordId }, meta.id);
    },
    { group: 'workflows', name: 'workflows.created' },
  );
  events.subscribe(
    recordChanged,
    async (ctx, payload, meta) => {
      if (payload.origin === 'person') await runner.handle(ctx, { kind: 'changed', recordId: payload.recordId, changed: payload.changed }, meta.id);
    },
    { group: 'workflows', name: 'workflows.changed' },
  );

  // Moves committed events from the database to the bus. Started after the subscriptions exist.
  // Email: file what arrived, send what was queued. Both are safe to repeat.
  events.subscribe(emailReceived, (ctx, payload) => mail.file(ctx, payload.inboundId), { group: 'email', name: 'email.file' });
  events.subscribe(emailQueued, (ctx, payload) => mail.deliver(ctx, payload.messageId), { group: 'email', name: 'email.deliver' });

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
    } catch (error) {
      logger.error({ error }, 'The email sweep failed; it will run again');
    } finally {
      sweeping = false;
    }
  };
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
