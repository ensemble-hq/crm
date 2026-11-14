import { type AuthStrategyHandler, bearerStrategy } from '@mariachi/api-facade';
import { JWTAdapter } from '@mariachi/auth';
import { ConfigError } from '@mariachi/core';
import { type CrmSettings, TENANT_ID } from './config';

/**
 * Sign-in is not the CRM's business: it asks a provider "who is this request from?" and gets back a
 * person's id, or nothing. Any provider fits behind `AuthStrategyHandler`, so Ensemble's sign-in,
 * a customer's own identity provider, or a token for an agent are all one adapter each.
 *
 * - `dev`: every request is the configured person, or the one named in an `x-dev-user` header. For
 *   local work only; refused in production.
 * - `jwt`: a bearer token signed with `JWT_SECRET`, whose `sub` is the person's id.
 *
 * To add a provider, return its `AuthStrategyHandler` here (the `@mariachi/auth-*` packages each
 * give a verifier to pass to `bearerStrategy`).
 */
export function createAuthStrategy(settings: CrmSettings, options: { production: boolean; jwtSecret?: string; jwtIssuer?: string; jwtAudience?: string }): AuthStrategyHandler {
  switch (settings.authProvider) {
    case 'dev': {
      if (options.production) throw new ConfigError('crm/dev-auth-in-production', 'AUTH_PROVIDER=dev signs everyone in as one person and cannot be used in production.');
      // An `x-dev-user` header picks someone else, so each role can be tried without signing in and out.
      return async (request) => {
        const asked = request.headers['x-dev-user'];
        return { userId: typeof asked === 'string' && asked ? asked : settings.devUserId, tenantId: TENANT_ID, scopes: [], identityType: 'session' };
      };
    }
    case 'jwt': {
      if (!options.jwtSecret) throw new ConfigError('crm/jwt-secret-required', 'AUTH_PROVIDER=jwt needs JWT_SECRET.');
      return singleTenant(bearerStrategy(new JWTAdapter({ secret: options.jwtSecret, issuer: options.jwtIssuer, audience: options.jwtAudience })));
    }
  }
}

/** Whatever tenant a provider reports, this instance has exactly one. */
function singleTenant(inner: AuthStrategyHandler): AuthStrategyHandler {
  return async (request) => {
    const identity = await inner(request);
    return identity ? { ...identity, tenantId: TENANT_ID } : null;
  };
}
