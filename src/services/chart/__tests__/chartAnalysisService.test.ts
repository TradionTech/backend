/**
 * Tests for ChartAnalysisService
 */

import { ChartAnalysisService } from '../chartAnalysisService';
import type { ChartVisionProvider } from '../chartVisionProvider';
import { ChartUpload } from '../../../db/models/ChartUpload';
import { getStorageService } from '../../storage';
import { marketContextService } from '../../market/marketContextService';
import type { ChartVisionFeatures, ChartContextForLLM } from '../chartTypes';

// Mock dependencies
jest.mock('../../../db/models/ChartUpload');
jest.mock('../../storage');
jest.mock('../../market/marketContextService');

describe('ChartAnalysisService', () => {
  let service: ChartAnalysisService;
  let mockVisionProvider: jest.Mocked<ChartVisionProvider>;
  let mockStorageService: any;
  let mockMarketContextService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVisionProvider = {
      analyzeChart: jest.fn(),
    } as any;

    mockStorageService = {
      getChartImageUrl: jest.fn().mockResolvedValue('https://example.com/chart.png'),
    };

    mockMarketContextService = {
      getContext: jest.fn(),
    };

    (getStorageService as jest.Mock).mockReturnValue(mockStorageService);
    (marketContextService.getContext as jest.Mock) = mockMarketContextService.getContext;

    service = new ChartAnalysisService(mockVisionProvider);
  });

  describe('analyzeChart', () => {
    it('should analyze uploaded chart with vision and market context', async () => {
      const mockChartUpload = {
        id: 'chart-123',
        userId: 'user-123',
        storageKey: 'charts/user-123/image.png',
        symbolHint: 'EURUSD',
        timeframeHint: '1H',
      };

      const mockVisionFeatures: ChartVisionFeatures = {
        metadata: {
          symbol: 'EURUSD',
          timeframeLabel: '1H',
        },
        primaryTrend: 'up',
        patterns: [
          {
            code: 'TREND_UP',
            confidence: 0.85,
            description: 'Strong uptrend',
            region: null,
          },
        ],
        keyLevels: [
          {
            type: 'resistance',
            price: 1.1,
            confidence: 0.8,
            label: 'Previous High',
          },
        ],
        indicators: [],
        notableEvents: [],
        notes: [],
      };

      const mockMarketContext = {
        contextAvailable: true,
        context: {
          instrument: { symbol: 'EURUSD', assetClass: 'FX' },
          trendSignals: { trend: 'up', basis: 'short_term' },
          volatilitySignals: { volatilityLevel: 'medium', value: 1.5 },
          dataQuality: { isFresh: true, source: 'test' },
        },
      };

      (ChartUpload.findByPk as jest.Mock).mockResolvedValue(mockChartUpload);
      mockVisionProvider.analyzeChart.mockResolvedValue(mockVisionFeatures);
      mockMarketContextService.getContext.mockResolvedValue(mockMarketContext);

      const result = await service.analyzeChart({
        source: 'upload',
        chartId: 'chart-123',
        userId: 'user-123',
        rawQuery: 'Analyze this chart',
      });

      expect(result).toMatchObject({
        source: 'upload',
        chartId: 'chart-123',
        symbol: 'EURUSD',
        timeframeLabel: '1H',
        visionFeatures: mockVisionFeatures,
        marketContextSummary: expect.objectContaining({
          trendSignals: { trend: 'up', basis: 'short_term' },
        }),
      });

      expect(mockVisionProvider.analyzeChart).toHaveBeenCalledWith({
        chartId: 'chart-123',
        imageUrl: 'https://example.com/chart.png',
        metadataHint: {
          symbol: 'EURUSD',
          timeframeLabel: '1H',
        },
      });

      expect(mockMarketContextService.getContext).toHaveBeenCalledWith({
        userId: 'user-123',
        symbol: 'EURUSD',
        timeframeHint: '1H',
        rawQuery: 'Analyze this chart',
      });
    });

    it('should handle vision analysis failure gracefully', async () => {
      const mockChartUpload = {
        id: 'chart-123',
        userId: 'user-123',
        storageKey: 'charts/user-123/image.png',
        symbolHint: null,
        timeframeHint: null,
      };

      (ChartUpload.findByPk as jest.Mock).mockResolvedValue(mockChartUpload);
      mockVisionProvider.analyzeChart.mockRejectedValue(new Error('Vision API failed'));

      const result = await service.analyzeChart({
        source: 'upload',
        chartId: 'chart-123',
        userId: 'user-123',
      });

      expect(result.uncertainty.fromVision).toContain('vision_analysis_failed');
      expect(result.visionFeatures.primaryTrend).toBe('unclear');
      expect(result.visionFeatures.patterns).toEqual([]);
    });

    it('should handle missing market context', async () => {
      const mockChartUpload = {
        id: 'chart-123',
        userId: 'user-123',
        storageKey: 'charts/user-123/image.png',
        symbolHint: null,
        timeframeHint: null,
      };

      const mockVisionFeatures: ChartVisionFeatures = {
        metadata: {},
        primaryTrend: 'unclear',
        patterns: [],
        keyLevels: [],
        indicators: [],
        notableEvents: [],
        notes: [],
      };

      (ChartUpload.findByPk as jest.Mock).mockResolvedValue(mockChartUpload);
      mockVisionProvider.analyzeChart.mockResolvedValue(mockVisionFeatures);
      mockMarketContextService.getContext.mockResolvedValue({
        contextAvailable: false,
        reason: 'NO_SYMBOL',
      });

      const result = await service.analyzeChart({
        source: 'upload',
        chartId: 'chart-123',
        userId: 'user-123',
      });

      expect(result.uncertainty.fromMarketData).toContain('no_symbol_for_market_context');
      expect(result.marketContextSummary).toBeUndefined();
    });

    it('should handle external_link source without vision', async () => {
      const result = await service.analyzeChart({
        source: 'external_link',
        symbolHint: 'BTC',
        timeframeHint: '4H',
      });

      expect(result.uncertainty.fromVision).toContain('no_direct_chart_vision_used');
      expect(result.visionFeatures.primaryTrend).toBe('unclear');
      expect(mockVisionProvider.analyzeChart).not.toHaveBeenCalled();
    });
  });
});
