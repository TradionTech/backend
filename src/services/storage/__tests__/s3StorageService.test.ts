/**
 * Tests for S3StorageService
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { S3StorageService } from '../s3StorageService';
import { getStorageConfig } from '../storageConfig';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/image.png'),
}));

// Mock config
jest.mock('../storageConfig', () => ({
  getStorageConfig: jest.fn(() => ({
    provider: 's3',
    endpoint: 'https://test.r2.cloudflarestorage.com',
    region: 'auto',
    accessKeyId: 'test-key-id',
    secretAccessKey: 'test-secret-key',
    bucketName: 'test-bucket',
    publicBaseUrl: 'https://test-bucket.r2.dev',
  })),
}));

describe('S3StorageService', () => {
  let storageService: S3StorageService;
  let mockS3Client: jest.Mocked<S3Client>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Client = {
      send: jest.fn(),
    } as any;
    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(() => mockS3Client);
    storageService = new S3StorageService();
  });

  describe('uploadChartImage', () => {
    it('should upload image and return key and URL', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      mockS3Client.send = jest.fn().mockResolvedValue({});

      const result = await storageService.uploadChartImage({
        userId: 'user-123',
        buffer: mockBuffer,
        mimeType: 'image/png',
        filename: 'chart.png',
      });

      expect(result.key).toMatch(/^charts\/user-123\/[a-f0-9-]+\.png$/);
      expect(result.url).toMatch(/^https:\/\/test-bucket\.r2\.dev\/charts\/user-123\/.+/);
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: expect.stringMatching(/^charts\/user-123\/.+/),
            Body: mockBuffer,
            ContentType: 'image/png',
            ACL: 'public-read',
          }),
        })
      );
    });

    it('should handle different file extensions', async () => {
      mockS3Client.send = jest.fn().mockResolvedValue({});

      const result = await storageService.uploadChartImage({
        userId: 'user-123',
        buffer: Buffer.from('fake'),
        mimeType: 'image/jpeg',
        filename: 'chart.jpg',
      });

      expect(result.key).toMatch(/\.jpg$/);
    });

    it('should throw error on upload failure', async () => {
      mockS3Client.send = jest.fn().mockRejectedValue(new Error('Upload failed'));

      await expect(
        storageService.uploadChartImage({
          userId: 'user-123',
          buffer: Buffer.from('fake'),
          mimeType: 'image/png',
          filename: 'chart.png',
        })
      ).rejects.toThrow('Failed to upload chart image');
    });
  });

  describe('getChartImageUrl', () => {
    it('should return public URL when publicBaseUrl is configured', async () => {
      const url = await storageService.getChartImageUrl('charts/user-123/image.png');

      expect(url).toBe('https://test-bucket.r2.dev/charts/user-123/image.png');
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });

    it('should generate signed URL when publicBaseUrl is not configured', async () => {
      // Create service without publicBaseUrl
      (getStorageConfig as jest.Mock).mockReturnValueOnce({
        provider: 's3',
        endpoint: 'https://test.r2.cloudflarestorage.com',
        region: 'auto',
        accessKeyId: 'test-key-id',
        secretAccessKey: 'test-secret-key',
        bucketName: 'test-bucket',
        publicBaseUrl: undefined,
      });

      const serviceWithoutPublic = new S3StorageService();
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

      const url = await serviceWithoutPublic.getChartImageUrl('charts/user-123/image.png');

      expect(url).toBe('https://signed-url.example.com/image.png');
      expect(getSignedUrl).toHaveBeenCalled();
    });
  });
});
