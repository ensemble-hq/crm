import { type StorageClient, createStorage } from '@mariachi/storage';
import type { CrmSettings } from './config';

/**
 * Where this instance keeps files. A folder on disk by default, which is right for one instance
 * on its own machine; any S3-compatible store (S3, R2, MinIO) by setting `FILES_STORE=s3` and the
 * bucket's details; memory for tests. Nothing else in the CRM knows which.
 */
export function createFileStorage(settings: CrmSettings): StorageClient {
  switch (settings.filesStore) {
    case 'memory':
      return createStorage({ adapter: 'memory' });
    case 's3':
      return createStorage({
        adapter: 's3',
        bucket: settings.filesBucket,
        region: settings.filesRegion,
        endpoint: settings.filesEndpoint,
        forcePathStyle: Boolean(settings.filesEndpoint),
        ...(settings.filesAccessKeyId && settings.filesSecretAccessKey ? { credentials: { accessKeyId: settings.filesAccessKeyId, secretAccessKey: settings.filesSecretAccessKey } } : {}),
      });
    case 'local':
      return createStorage({ adapter: 'local', basePath: settings.filesDir, signingSecret: settings.secretsKey });
  }
}
