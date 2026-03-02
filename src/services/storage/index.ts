/**
 * Storage Service Factory
 *
 * Creates the appropriate storage service implementation based on configuration
 */

import type { StorageService } from './storageService';
import { S3StorageService } from './s3StorageService';
import { getStorageConfig } from './storageConfig';
import { logger } from '../../config/logger';

let storageServiceInstance: StorageService | null = null;

/**
 * Get or create the storage service instance
 */
export function getStorageService(): StorageService {
  if (storageServiceInstance) {
    return storageServiceInstance;
  }

  const config = getStorageConfig();

  if (config.provider === 's3') {
    storageServiceInstance = new S3StorageService();
  } else {
    throw new Error(`Storage provider "${config.provider}" is not yet implemented`);
  }

  logger.info('Storage service initialized', {
    provider: config.provider,
  });

  return storageServiceInstance;
}
