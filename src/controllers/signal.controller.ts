import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import type { AxiosError } from 'axios';
import { confirmSignal, type SignalConfirmationRequest } from '../services/signal/signalConfirmerClient';
import { logger } from '../config/logger';

type ErrorPayload = {
  detail?: unknown;
  message?: string;
  errors?: unknown;
};

function extractPythonValidationError(data: any): { message: string; errors?: unknown } {
  // FastAPI default shape for HTTPException(detail=...) is: { "detail": { ... } }
  const detail = data?.detail ?? data;
  if (detail && typeof detail === 'object') {
    const message = typeof (detail as any).message === 'string' ? (detail as any).message : 'Validation failed';
    const errors = (detail as any).errors;
    return { message, errors };
  }
  return { message: 'Validation failed' };
}

export const signalController = {
  confirmSignal: async (req: Request, res: Response) => {
    try {
      // Ensure the request is associated with a known user in the monolith.
      // (The Python confirmer is stateless and should not persist results.)
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      }

      const payload = req.body as SignalConfirmationRequest;
      const result = await confirmSignal(payload);
      return res.json(result);
    } catch (err: unknown) {
      const maybeStatus = (err as any)?.status;
      if (typeof maybeStatus === 'number') {
        return res.status(maybeStatus).json({
          error: { code: 'SERVICE_UNAVAILABLE', message: (err as any)?.message ?? 'Unavailable' },
        });
      }

      const axiosErr = err as AxiosError<ErrorPayload>;
      const status = axiosErr?.response?.status;
      const data = axiosErr?.response?.data;

      if (status === 422) {
        const { message, errors } = extractPythonValidationError(data);
        return res.status(422).json({
          error: { code: 'VALIDATION_ERROR', message, details: errors ?? data?.detail ?? data },
        });
      }

      const code = (axiosErr as any)?.code;
      const isTimeout = code === 'ECONNABORTED' || axiosErr.message?.toLowerCase().includes('timeout');
      if (isTimeout) {
        return res.status(504).json({
          error: { code: 'SIGNAL_CONFIRMER_TIMEOUT', message: 'Signal confirmation timed out' },
        });
      }

      logger.warn('Signal confirmer call failed', {
        status,
        message: axiosErr.message,
      });

      return res.status(status ?? 502).json({
        error: { code: 'SIGNAL_CONFIRMER_UPSTREAM_ERROR', message: 'Signal confirmation failed' },
      });
    }
  },
};

