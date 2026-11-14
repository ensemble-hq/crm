import type { DrizzleDb } from '@mariachi/database-postgres';
import type { CrmSettings } from '../config';
import { DevEmailProvider } from './dev.provider';
import type { EmailProvider } from './provider';

/** The email service this instance uses. To add one, implement `EmailProvider` and return it here. */
export function createEmailProvider(settings: CrmSettings, db: DrizzleDb): EmailProvider {
  switch (settings.emailProvider) {
    case 'dev':
      return new DevEmailProvider(db);
  }
}

export * from './provider';
