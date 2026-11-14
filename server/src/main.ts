import { createApiServer, hmacSignatureStrategy } from '@mariachi/api-facade';
import { createCommunication } from '@mariachi/communication';
import { useConfigSection } from '@mariachi/config';
import { ConfigError, KEYS } from '@mariachi/core';
import { installAuditAppendOnly } from '@mariachi/audit/postgres';
import { createPostgresDatabase, runMigrations } from '@mariachi/database-postgres';
import { bootstrap } from '@mariachi/lifecycle';
import { MemoryRateLimiter } from '@mariachi/rate-limit';
import { WSAdapter } from '@mariachi/realtime';
import { createControllers } from './api/controllers/index';
import { createAuthStrategy } from './auth';
import { CRM_CONFIG, type CrmSettings, TENANT_ID } from './config';
import { createEmailProvider } from './email';
import { createLive } from './live';
import { createServices, registerServices } from './services/index';

async function main(): Promise<void> {
  const { config, logger, tracer, metrics, container, lifecycle } = bootstrap();
  const settings = useConfigSection<CrmSettings>(CRM_CONFIG);
  if (!config.database) throw new ConfigError('crm/database-required', 'DATABASE_URL is required');

  // Startup runs in ascending priority; shutdown runs in reverse.
  const database = lifecycle.manage('database', createPostgresDatabase({ url: config.database.url, poolMax: config.database.poolMax }), { priority: 10 });
  container.register(KEYS.Database, database);
  await database.connect();
  if (settings.migrateOnStart) await runMigrations(database.adapter, { migrationsFolder: 'drizzle', logger });
  // The audit log only ever grows: the database itself refuses to change or delete an entry.
  await installAuditAppendOnly(database.db);

  // One communication layer per process: operations register on it; HTTP and MCP call through it.
  const communication = createCommunication({}, { logger, tracer, metrics });
  container.register(KEYS.Communication, communication);
  const email = createEmailProvider(settings, database.db);
  // Live updates need Redis; without it the CRM works, and browsers simply read on their own.
  const live = config.redis ? lifecycle.manage('live', createLive(config.redis.url, config.serviceName, { logger, tracer, metrics }), { priority: 40 }) : undefined;
  const deps = { db: database.db, transaction: database.transaction, source: config.serviceName, email, secretsKey: settings.secretsKey, appOrigin: settings.appOrigin, push: live ? (ctx: Parameters<typeof live.sendToUser>[0], userId: string, data: unknown) => live.sendToUser(ctx, userId, data) : undefined };
  const operations = registerServices(communication, deps);

  const agentKeys = createServices(deps).agents;
  const authenticate = createAuthStrategy(settings, { production: config.env === 'production', jwtSecret: config.auth?.jwtSecret, jwtIssuer: config.auth?.jwtIssuer, jwtAudience: config.auth?.jwtAudience });

  const api = createApiServer({
    name: 'api',
    prefix: '/api',
    logger,
    tracer,
    trustProxy: config.server.trustProxy,
    bodyLimitBytes: config.server.bodyLimitBytes,
    // A turn of the assistant waits on a model, which can take minutes.
    requestTimeoutMs: 250_000,
    cors: config.server.corsOrigins.length > 0 ? { origins: config.server.corsOrigins } : false,
  })
    .withAuthStrategy('session', authenticate)
    // Email providers sign what they deliver; that signature is their sign-in.
    .withAuthStrategy('inbound', hmacSignatureStrategy({ secret: settings.inboundSecret, header: 'x-signature', provider: 'email', tenantId: TENANT_ID }))
    // An agent signs in with its key, sent as `Authorization: Bearer ak_…` or `x-api-key`. Anything else is a person's session.
    .withAuthStrategy('agent', async (request) => {
      const bearer = typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('Bearer ak_') ? request.headers.authorization.slice(7) : undefined;
      const key = bearer ?? (typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : undefined);
      if (!key) return null;
      return { ...(await agentKeys.verify(key)), tenantId: TENANT_ID };
    })
    .withAuth(['agent', 'session'])
    // Anyone can reach the public form and booking operations, so callers who are not signed in are held to a modest rate per address.
    .withRateLimit({ limiter: new MemoryRateLimiter(), default: { windowMs: 60_000, maxRequests: 6_000 }, anonymous: { windowMs: 60_000, maxRequests: 60 } })
    .withHealth(lifecycle.health)
    .withOpenApi({ info: { title: 'CRM', version: '0.1.0' } });
  for (const controller of createControllers(communication, operations, { name: config.serviceName, version: '0.1.0' }, email.name)) api.registerController(controller);

  // Live updates: browsers hold a WebSocket open on the API's own port, at /api/live, and are told
  // when to read again. The connection is signed in the same way as any request, and only a member gets one.
  if (live) {
    const { people } = createServices(deps);
    // The server's own setup runs this when it starts listening, which is after the startup hooks were
    // gathered, so the socket layer is started here and stopped by a hook registered outside.
    let sockets: WSAdapter | undefined;
    lifecycle.shutdown.register({ name: 'live-sockets', priority: 110, fn: async () => sockets?.disconnect() });
    api.configure((fastify) => {
      sockets = new WSAdapter(
        live,
        {
          server: fastify.server,
          path: '/api/live',
          allowedOrigins: config.server.corsOrigins.length > 0 ? config.server.corsOrigins : undefined,
          authenticate: async (token, request) => {
            try {
              const identity = await authenticate({ headers: { ...request.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: undefined, params: {}, query: {}, method: 'GET', url: request.url ?? '', routePath: '/api/live', ip: request.socket.remoteAddress ?? '' });
              if (!identity) return null;
              const actor = await people.actor({ traceId: 'live', userId: identity.userId, tenantId: identity.tenantId, scopes: [], identityType: 'session', logger });
              return { userId: actor.signedInId, tenantId: identity.tenantId };
            } catch {
              return null;
            }
          },
        },
        { logger, tracer, metrics },
      );
      void sockets.connect();
    });
  }

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
