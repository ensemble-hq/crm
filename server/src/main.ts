import { createApiServer, hmacSignatureStrategy } from '@mariachi/api-facade';
import { createCommunication } from '@mariachi/communication';
import { useConfigSection } from '@mariachi/config';
import { ConfigError, KEYS } from '@mariachi/core';
import { createPostgresDatabase, runMigrations } from '@mariachi/database-postgres';
import { bootstrap } from '@mariachi/lifecycle';
import { MemoryRateLimiter } from '@mariachi/rate-limit';
import { createControllers } from './api/controllers/index';
import { createAuthStrategy } from './auth';
import { CRM_CONFIG, type CrmSettings, TENANT_ID } from './config';
import { createEmailProvider } from './email';
import { registerServices } from './services/index';

async function main(): Promise<void> {
  const { config, logger, tracer, metrics, container, lifecycle } = bootstrap();
  const settings = useConfigSection<CrmSettings>(CRM_CONFIG);
  if (!config.database) throw new ConfigError('crm/database-required', 'DATABASE_URL is required');

  // Startup runs in ascending priority; shutdown runs in reverse.
  const database = lifecycle.manage('database', createPostgresDatabase({ url: config.database.url, poolMax: config.database.poolMax }), { priority: 10 });
  container.register(KEYS.Database, database);
  await database.connect();
  if (settings.migrateOnStart) await runMigrations(database.adapter, { migrationsFolder: 'drizzle', logger });

  // One communication layer per process: operations register on it; HTTP and MCP call through it.
  const communication = createCommunication({}, { logger, tracer, metrics });
  container.register(KEYS.Communication, communication);
  const email = createEmailProvider(settings, database.db);
  const operations = registerServices(communication, { db: database.db, transaction: database.transaction, source: config.serviceName, email });

  const api = createApiServer({
    name: 'api',
    prefix: '/api',
    logger,
    tracer,
    trustProxy: config.server.trustProxy,
    bodyLimitBytes: config.server.bodyLimitBytes,
    cors: config.server.corsOrigins.length > 0 ? { origins: config.server.corsOrigins } : false,
  })
    .withAuthStrategy('session', createAuthStrategy(settings, { production: config.env === 'production', jwtSecret: config.auth?.jwtSecret, jwtIssuer: config.auth?.jwtIssuer, jwtAudience: config.auth?.jwtAudience }))
    // Email providers sign what they deliver; that signature is their sign-in.
    .withAuthStrategy('inbound', hmacSignatureStrategy({ secret: settings.inboundSecret, header: 'x-signature', provider: 'email', tenantId: TENANT_ID }))
    .withAuth('session')
    // Anyone can reach the public form and booking operations, so callers who are not signed in are held to a modest rate per address.
    .withRateLimit({ limiter: new MemoryRateLimiter(), default: { windowMs: 60_000, maxRequests: 6_000 }, anonymous: { windowMs: 60_000, maxRequests: 60 } })
    .withHealth(lifecycle.health)
    .withOpenApi({ info: { title: 'CRM', version: '0.1.0' } });
  for (const controller of createControllers(communication, operations, { name: config.serviceName, version: '0.1.0' }, email.name)) api.registerController(controller);

  lifecycle.startup.register({
    name: 'api',
    priority: 100,
    fn: async () => {
      const address = await api.listen(config.server.port, config.server.host);
      logger.info({ address, operations: operations.length }, 'CRM API listening');
    },
  });
  lifecycle.shutdown.register({ name: 'api', priority: 100, fn: () => api.close() });

  await lifecycle.start();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
