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
  /** Which email service sends and receives. `dev` keeps mail in the database. See `email/provider.ts`. */
  emailProvider: z.enum(['dev']).default('dev'),
  /** Shared secret a provider signs inbound deliveries with (HMAC-SHA256 of the body, hex, in `x-signature`). */
  inboundSecret: z.string().min(16).default('dev-inbound-secret-change-me'),
  /** How often the worker sweeps for anything the first path missed. */
  sweepSeconds: z.number().int().min(1).default(15),
  /** Encrypts secrets the CRM stores, such as the assistant's model key. At least 32 characters; set a real one in production. */
  secretsKey: z.string().min(32).default('dev-only-secrets-key-change-me-0123456789'),
  /** Where people reach the app, for links in email such as unsubscribe. */
  appOrigin: z.string().url().default('http://localhost:5185'),
  /** Where files are kept: a folder on this machine, an S3-compatible bucket, or memory (tests). See `files.ts`. */
  filesStore: z.enum(['local', 's3', 'memory']).default('local'),
  filesDir: z.string().default('.data/files'),
  filesBucket: z.string().optional(),
  filesRegion: z.string().optional(),
  filesEndpoint: z.string().optional(),
  filesAccessKeyId: z.string().optional(),
  filesSecretAccessKey: z.string().optional(),
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
    emailProvider: optional(read('EMAIL_PROVIDER')),
    inboundSecret: optional(read('EMAIL_INBOUND_SECRET')),
    sweepSeconds: optional(read('EMAIL_SWEEP_SECONDS')) === undefined ? undefined : Number(read('EMAIL_SWEEP_SECONDS')),
    secretsKey: optional(read('CRM_SECRETS_KEY')),
    appOrigin: optional(read('APP_ORIGIN')),
    filesStore: optional(read('FILES_STORE')),
    filesDir: optional(read('FILES_DIR')),
    filesBucket: optional(read('FILES_BUCKET')),
    filesRegion: optional(read('FILES_REGION')),
    filesEndpoint: optional(read('FILES_ENDPOINT')),
    filesAccessKeyId: optional(read('FILES_ACCESS_KEY_ID')),
    filesSecretAccessKey: optional(read('FILES_SECRET_ACCESS_KEY')),
    migrateOnStart: optional(read('MIGRATE_ON_START')) === undefined ? undefined : read('MIGRATE_ON_START') === 'true',
  }),
});
