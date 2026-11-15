export * from './activities';
export * from './assistant';
export * from './capture';
export * from './email';
export * from './files';
export * from './notifications';
export * from './objects';
export * from './people';
export * from './records';
export * from './reports';
export * from './roles';
export * from './sales';
export * from './sequences';
export * from './teams';
export * from './workflows';
// Events are written in the same transaction as the change they describe, then relayed by the worker.
export { eventOutboxTable } from '@mariachi/events/outbox';
// Agents sign in with keys. Only a key's hash is stored.
export { apiKeysTable } from '@mariachi/auth/schema';
// Every change, kept in a table that only accepts new rows.
export { auditLogsTable } from '@mariachi/audit/schema';
