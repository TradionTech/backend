/**
 * S3-Compatible Storage Service Implementation
 *
 * Supports Cloudflare R2 and AWS S3 via S3-compatible API
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import type { StorageService, FileUploadResult } from './storageService';
import { getStorageConfig } from './storageConfig';
import { logger } from '../../config/logger';

export class S3StorageService implements StorageService {
  private s3Client: S3Client;
  private bucketName: string;
  private publicBaseUrl?: string;

  constructor() {
    const config = getStorageConfig();

    if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
      throw new Error(
        'S3 storage configuration incomplete. Required: S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME'
      );
    }

    this.bucketName = config.bucketName;
    this.publicBaseUrl = config.publicBaseUrl;

    // Create S3 client with custom endpoint (for R2) or default AWS endpoint
    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Force path-style for R2 compatibility
      forcePathStyle: true,
    });

    logger.info('S3StorageService initialized', {
      endpoint: config.endpoint,
      bucketName: this.bucketName,
      hasPublicBaseUrl: !!this.publicBaseUrl,
    });
  }

  /**
   * Upload a chart image to S3/R2
   */
  async uploadChartImage(params: {
    userId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<FileUploadResult> {
    const { userId, buffer, mimeType, filename } = params;

    // Generate unique key: charts/{userId}/{uuid}.{ext}
    const ext = extname(filename).toLowerCase() || '.png';
    const uuid = randomUUID();
    const key = `charts/${userId}/${uuid}${ext}`;

    try {
      // Upload to S3/R2
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Make publicly readable if publicBaseUrl is configured
        // Otherwise, we'll use signed URLs
        ...(this.publicBaseUrl ? { ACL: 'public-read' } : {}),
      });

      await this.s3Client.send(command);

      logger.debug('Chart image uploaded', {
        key,
        size: buffer.length,
        mimeType,
      });

      // Build public URL if configured
      const url = this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : undefined;

      return {
        key,
        url,
      };
    } catch (error) {
      logger.error('Failed to upload chart image', {
        error: (error as Error).message,
        key,
      });
      throw new Error(`Failed to upload chart image: ${(error as Error).message}`);
    }
  }

  /**
   * Get a public or signed URL for a chart image
   */
  async getChartImageUrl(key: string): Promise<string> {
    // If public base URL is configured, use it
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${key}`;
    }

    // Otherwise, generate a signed URL (valid for 1 hour)
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600, // 1 hour
      });

      return signedUrl;
    } catch (error) {
      logger.error('Failed to generate signed URL', {
        error: (error as Error).message,
        key,
      });
      throw new Error(`Failed to get chart image URL: ${(error as Error).message}`);
    }
  }
}
