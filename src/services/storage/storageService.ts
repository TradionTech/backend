/**
 * Storage Service Interface
 *
 * Abstraction for file storage operations (R2, S3, etc.)
 */

export interface FileUploadResult {
  key: string; // Opaque storage key (path)
  url?: string; // Optional public URL if known
}

export interface StorageService {
  /**
   * Upload a chart image to storage
   */
  uploadChartImage(params: {
    userId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<FileUploadResult>;

  /**
   * Get a public or signed URL for a chart image
   */
  getChartImageUrl(key: string): Promise<string>;
}
