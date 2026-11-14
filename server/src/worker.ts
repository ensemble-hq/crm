import { ConfigError, KEYS } from '@mariachi/core';
import { createPostgresDatabase } from '@mariachi/database-postgres';
import { DefaultEvents, createEventBus } from '@mariachi/events';
import { OutboxRelay } from '@mariachi/events/outbox';
import { bootstrap } from '@mariachi/lifecycle';
import './config';
import { recordChanged, recordCreated } from './events';
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
  const { runner } = createServices({ db: database.db, transaction: database.transaction, source: config.serviceName });

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
  lifecycle.manage('outbox-relay', new OutboxRelay({ db: database.db, target: events, logger }), { priority: 30 });

  await lifecycle.start();
  logger.info({}, 'CRM worker running');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
