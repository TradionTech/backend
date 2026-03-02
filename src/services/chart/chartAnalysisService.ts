/**
 * Chart Analysis Service
 *
 * Orchestrates chart vision analysis, storage, and market context enrichment
 */

import { ChartUpload } from '../../db/models/ChartUpload';
import { getStorageService } from '../storage';
import { marketContextService } from '../market/marketContextService';
import type { ChartVisionProvider } from './chartVisionProvider';
import type {
  ChartContextForLLM,
  ChartSource,
  ChartAnalysisRequest,
  ChartMarketContextSummary,
  ChartUncertainty,
} from './chartTypes';
import { logger } from '../../config/logger';

export class ChartAnalysisService {
  constructor(
    private visionProvider: ChartVisionProvider,
    private storageService = getStorageService()
  ) {}

  /**
   * Analyze a chart and build complete context for LLM
   */
  async analyzeChart(req: ChartAnalysisRequest): Promise<ChartContextForLLM> {
    const { source, chartId, symbolHint, timeframeHint, userId, rawQuery } = req;

    const uncertainty: ChartUncertainty = {
      fromVision: [],
      fromMarketData: [],
    };

    let visionFeatures;
    let resolvedSymbol: string | undefined;
    let resolvedTimeframe: string | undefined;

    // Step 1: Get vision features if source is upload
    if (source === 'upload' && chartId) {
      try {
        // Look up ChartUpload record
        const chartUpload = await ChartUpload.findByPk(chartId);
        if (!chartUpload) {
          throw new Error(`ChartUpload not found: ${chartId}`);
        }

        // Verify ownership if userId provided
        if (userId && chartUpload.userId !== userId) {
          throw new Error(`ChartUpload does not belong to user: ${userId}`);
        }

        // Get image URL from storage
        const imageUrl = await this.storageService.getChartImageUrl(chartUpload.storageKey);

        // Build metadata hint from chart upload
        const metadataHint = {
          symbol: chartUpload.symbolHint || undefined,
          timeframeLabel: chartUpload.timeframeHint || undefined,
        };

        // Call vision provider
        visionFeatures = await this.visionProvider.analyzeChart({
          chartId,
          imageUrl,
          metadataHint,
        });

        // Resolve symbol and timeframe (preference: vision > hints > request)
        resolvedSymbol =
          visionFeatures.metadata.symbol || chartUpload.symbolHint || symbolHint || undefined;
        resolvedTimeframe =
          visionFeatures.metadata.timeframeLabel ||
          chartUpload.timeframeHint ||
          timeframeHint ||
          undefined;

        logger.debug('Chart vision analysis completed', {
          chartId,
          resolvedSymbol,
          resolvedTimeframe,
          patternsCount: visionFeatures.patterns.length,
        });
      } catch (error) {
        logger.error('Chart vision analysis failed', {
          error: (error as Error).message,
          chartId,
        });
        uncertainty.fromVision.push('vision_analysis_failed');
        // Create minimal vision features as fallback
        visionFeatures = {
          metadata: {
            symbol: symbolHint || undefined,
            timeframeLabel: timeframeHint || undefined,
          },
          primaryTrend: 'unclear' as const,
          patterns: [],
          keyLevels: [],
          indicators: [],
          notableEvents: [],
          notes: [],
        };
      }
    } else {
      // For generated or external_link sources, create minimal vision features
      uncertainty.fromVision.push('no_direct_chart_vision_used');
      visionFeatures = {
        metadata: {
          symbol: symbolHint || undefined,
          timeframeLabel: timeframeHint || undefined,
        },
        primaryTrend: 'unclear' as const,
        patterns: [],
        keyLevels: [],
        indicators: [],
        notableEvents: [],
        notes: [],
      };
      resolvedSymbol = symbolHint;
      resolvedTimeframe = timeframeHint;
    }

    // Step 2: Enrich with market context if symbol is available
    let marketContextSummary: ChartMarketContextSummary | undefined;

    if (resolvedSymbol) {
      try {
        const marketContextResult = await marketContextService.getContext({
          userId,
          symbol: resolvedSymbol,
          timeframeHint: resolvedTimeframe,
          rawQuery,
        });

        if (marketContextResult.contextAvailable && marketContextResult.context) {
          const context = marketContextResult.context;

          marketContextSummary = {
            trendSignals: context.trendSignals
              ? {
                  trend: context.trendSignals.trend,
                  basis: context.trendSignals.basis,
                }
              : undefined,
            volatilitySignals: context.volatilitySignals
              ? {
                  volatilityLevel: context.volatilitySignals.volatilityLevel,
                  metric: context.volatilitySignals.metric,
                  value: context.volatilitySignals.value,
                }
              : undefined,
            dataQuality: {
              isFresh: context.dataQuality.isFresh,
              ageSeconds: context.dataQuality.ageSeconds,
              source: context.dataQuality.source,
              issues: context.dataQuality.issues,
            },
          };

          // Track data quality issues
          if (!context.dataQuality.isFresh) {
            uncertainty.fromMarketData.push('market_data_stale');
          }
          if (context.dataQuality.issues && context.dataQuality.issues.length > 0) {
            uncertainty.fromMarketData.push(...context.dataQuality.issues);
          }

          logger.debug('Market context enriched', {
            chartId,
            symbol: resolvedSymbol,
            isFresh: context.dataQuality.isFresh,
          });
        } else {
          uncertainty.fromMarketData.push('market_context_unavailable');
        }
      } catch (error) {
        logger.warn('Market context enrichment failed', {
          error: (error as Error).message,
          symbol: resolvedSymbol,
        });
        uncertainty.fromMarketData.push('market_context_fetch_failed');
      }
    } else {
      uncertainty.fromMarketData.push('no_symbol_for_market_context');
    }

    // Step 3: Build complete ChartContextForLLM
    const chartContext: ChartContextForLLM = {
      source,
      chartId,
      symbol: resolvedSymbol,
      timeframeLabel: resolvedTimeframe,
      visionFeatures,
      marketContextSummary,
      uncertainty,
    };

    return chartContext;
  }
}
