/**
 * Chart Vision Provider Interface
 *
 * Abstraction for vision analysis providers (Groq, OpenAI, etc.)
 */

import type { ChartVisionFeatures, ChartMetadata } from './chartTypes';

export interface ChartVisionRequest {
  chartId: string;
  imageUrl: string;
  metadataHint?: ChartMetadata;
}

export interface ChartVisionProvider {
  /**
   * Analyze a chart image and extract structured features
   */
  analyzeChart(req: ChartVisionRequest): Promise<ChartVisionFeatures>;
}
