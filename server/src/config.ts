import { registerConfigSection } from '@mariachi/config';
import { z } from 'zod';

/** The CRM's own settings, read from the environment by `@mariachi/config`. */
export const CRM_CONFIG = 'crm';

/** One instance serves one customer, so every row carries the same tenant. */
export const TENANT_ID = 'crm';

const crmSchema = z.object({
  /** Who answers "who is this request from?". See `auth.ts`. */
  authProvider: z.enum(['dev', 'jwt']).default('dev'),
  /** The person every request is signed in as under the `dev` provider. */
  devUserId: z.string().default('usr_maya'),
  /** Apply pending migrations when the server starts, as a hosted instance does. */
  migrateOnStart: z.boolean().default(true),
});
export type CrmSettings = z.infer<typeof crmSchema>;

const optional = (value: string | undefined) => (value ? value : undefined);

registerConfigSection(CRM_CONFIG, {
  schema: crmSchema,
  fromEnv: (read) => ({
    authProvider: optional(read('AUTH_PROVIDER')),
    devUserId: optional(read('DEV_USER_ID')),
    migrateOnStart: optional(read('MIGRATE_ON_START')) === undefined ? undefined : read('MIGRATE_ON_START') === 'true',
  }),
});
