/**
 * Storage Configuration
 *
 * Helper for reading storage configuration from environment variables
 */

import { env } from '../../config/env';

export interface StorageConfig {
  provider: 's3' | 'local'; // Future: add 'local' for development
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl?: string;
}

/**
 * Get storage configuration from environment variables
 */
export function getStorageConfig(): StorageConfig {
  const provider = (env.STORAGE_PROVIDER || 's3') as 's3' | 'local';

  if (provider === 's3') {
    return {
      provider,
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION || 'auto',
      accessKeyId: env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
      bucketName: env.S3_BUCKET_NAME || '',
      publicBaseUrl: env.S3_PUBLIC_BASE_URL || undefined,
    };
  }

  // Future: local storage config
  throw new Error(`Storage provider "${provider}" is not yet implemented`);
}
