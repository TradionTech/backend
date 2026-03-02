import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import multer from 'multer';
import { ChartUpload } from '../db/models/ChartUpload';
import { getStorageService } from '../services/storage';
import { logger } from '../config/logger';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    // Accept only image files
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PNG, JPEG, JPG, and WEBP images are allowed.'));
    }
  },
});

export const chartController = {
  /**
   * Upload a chart image
   * POST /api/charts/upload
   */
  uploadChart: [
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const { userId } = getAuth(req);
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const file = req.file;

        if (!file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        // Get optional hints from form data
        const symbolHint = (req.body.symbolHint as string) || null;
        const timeframeHint = (req.body.timeframeHint as string) || null;

        // Upload to storage
        const storageService = getStorageService();
        const uploadResult = await storageService.uploadChartImage({
          userId,
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname,
        });

        // Create database record
        const chartUpload = await ChartUpload.create({
          userId,
          storageKey: uploadResult.key,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          symbolHint,
          timeframeHint,
        });

        logger.info('Chart uploaded', {
          chartId: chartUpload.id,
          userId,
          storageKey: uploadResult.key,
          size: file.size,
        });

        return res.status(201).json({
          chartId: chartUpload.id,
          symbolHint: chartUpload.symbolHint,
          timeframeHint: chartUpload.timeframeHint,
          previewUrl: uploadResult.url,
        });
      } catch (error) {
        logger.error('Chart upload error', {
          error: (error as Error).message,
          stack: (error as Error).stack,
        });

        return res.status(500).json({
          error: 'Failed to upload chart',
          message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
        });
      }
    },
  ],
};
