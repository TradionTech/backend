/**
 * Groq Chart Vision Provider
 *
 * Uses Groq's multimodal model to analyze chart images
 */

import axios, { AxiosError } from 'axios';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import type { ChartVisionProvider, ChartVisionRequest } from '../chartVisionProvider';
import type { ChartVisionFeatures } from '../chartTypes';

const MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct';
const BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Groq implementation of ChartVisionProvider
 */
export class GroqChartVisionProvider implements ChartVisionProvider {
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor() {
    this.apiKey = env.GROQ_API_KEY;
    this.timeout = env.GROQ_TIMEOUT || 30000;

    if (!this.apiKey) {
      logger.warn('GROQ_API_KEY not set - Groq vision provider will fail on API calls');
    }
  }

  /**
   * Analyze chart image using Groq's vision model
   */
  async analyzeChart(req: ChartVisionRequest): Promise<ChartVisionFeatures> {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const systemPrompt = `You are a trading chart analysis expert. Analyze the provided chart image and return ONLY valid JSON with the following structure:

{
  "metadata": {
    "symbol": "string or null (e.g., EURUSD, BTC, AAPL)",
    "timeframeLabel": "string or null (e.g., 1H, 4H, Daily, Weekly)",
    "providerHint": "string or null (e.g., TradingView, MT4, MT5)"
  },
  "primaryTrend": "up" | "down" | "sideways" | "unclear",
  "patterns": [
    {
      "code": "TREND_UP" | "TREND_DOWN" | "RANGE" | "HEAD_AND_SHOULDERS" | "DOUBLE_TOP" | "DOUBLE_BOTTOM" | "TRIANGLE" | "FLAG" | "CHANNEL" | "SUPPORT_RESISTANCE_CLUSTER" | "UNKNOWN_PATTERN",
      "confidence": 0.0-1.0,
      "description": "string",
      "region": {"fromTs": "ISO timestamp", "toTs": "ISO timestamp"} or null
    }
  ],
  "keyLevels": [
    {
      "type": "support" | "resistance",
      "price": number,
      "confidence": 0.0-1.0,
      "label": "string or null"
    }
  ],
  "indicators": [
    {
      "name": "MA" | "RSI" | "MACD" | "BBANDS" | "OTHER",
      "parameters": {"key": "value"} or null,
      "observation": "string"
    }
  ],
  "notableEvents": ["string"],
  "notes": ["string"]
}

Important:
- Return ONLY valid JSON, no markdown, no code blocks
- If you cannot detect something, use null or empty arrays
- Confidence scores should be realistic (0.0-1.0)
- Be conservative with pattern detection - only include high-confidence patterns
- If symbol/timeframe cannot be determined, set to null`;

    const userPrompt = `Analyze this trading chart image and extract all relevant features.`;

    try {
      logger.debug('Calling Groq vision API', {
        chartId: req.chartId,
        model: MODEL,
        imageUrl: req.imageUrl.substring(0, 100) + '...',
      });

      const response = await axios.post(
        `${BASE_URL}/chat/completions`,
        {
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: userPrompt,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: req.imageUrl,
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: 2048,
          temperature: 0.3, // Lower temperature for more consistent structured output
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }
      );

      const content = response.data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No response content from Groq API');
      }

      // Parse JSON response
      let parsed: any;
      try {
        parsed = JSON.parse(content.trim());
      } catch (parseError) {
        // Try to extract JSON from text if model added extra text
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          logger.warn('Failed to parse Groq vision response', {
            chartId: req.chartId,
            content: content.substring(0, 200),
          });
          throw new Error('Invalid JSON response from vision model');
        }
      }

      // Validate and normalize response
      const visionFeatures = this.normalizeVisionFeatures(parsed, req.metadataHint);

      logger.debug('Chart vision analysis completed', {
        chartId: req.chartId,
        hasSymbol: !!visionFeatures.metadata.symbol,
        patternsCount: visionFeatures.patterns.length,
        levelsCount: visionFeatures.keyLevels.length,
      });

      return visionFeatures;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const status = axiosError.response.status;
        const errorData = axiosError.response.data as any;
        logger.error('Groq vision API error', {
          status,
          error: errorData?.error?.message || axiosError.message,
          chartId: req.chartId,
        });
        throw new Error(
          `Groq vision API error (${status}): ${errorData?.error?.message || axiosError.message}`
        );
      } else if (axiosError.request) {
        logger.error('Groq vision API network error', {
          message: axiosError.message,
          chartId: req.chartId,
        });
        throw new Error(`Groq vision API network error: ${axiosError.message}`);
      } else {
        logger.error('Groq vision API request setup error', {
          message: axiosError.message,
          chartId: req.chartId,
        });
        throw new Error(`Groq vision API error: ${axiosError.message}`);
      }
    }
  }

  /**
   * Normalize and validate vision features from API response
   */
  private normalizeVisionFeatures(
    parsed: any,
    metadataHint?: ChartMetadata
  ): ChartVisionFeatures {
    // Merge metadata hint if provided
    const metadata = {
      symbol: parsed.metadata?.symbol || metadataHint?.symbol || null,
      timeframeLabel: parsed.metadata?.timeframeLabel || metadataHint?.timeframeLabel || null,
      providerHint: parsed.metadata?.providerHint || metadataHint?.providerHint || null,
    };

    // Normalize primary trend
    const validTrends = ['up', 'down', 'sideways', 'unclear'];
    const primaryTrend = validTrends.includes(parsed.primaryTrend)
      ? parsed.primaryTrend
      : 'unclear';

    // Normalize patterns
    const patterns = Array.isArray(parsed.patterns)
      ? parsed.patterns
          .filter((p: any) => p && p.code && typeof p.confidence === 'number')
          .map((p: any) => ({
            code: p.code,
            confidence: Math.max(0, Math.min(1, p.confidence)),
            description: p.description || '',
            region: p.region || null,
          }))
      : [];

    // Normalize key levels
    const keyLevels = Array.isArray(parsed.keyLevels)
      ? parsed.keyLevels
          .filter(
            (l: any) =>
              l &&
              (l.type === 'support' || l.type === 'resistance') &&
              typeof l.price === 'number' &&
              typeof l.confidence === 'number'
          )
          .map((l: any) => ({
            type: l.type,
            price: l.price,
            confidence: Math.max(0, Math.min(1, l.confidence)),
            label: l.label || undefined,
          }))
      : [];

    // Normalize indicators
    const indicators = Array.isArray(parsed.indicators)
      ? parsed.indicators
          .filter((i: any) => i && i.name && i.observation)
          .map((i: any) => ({
            name: i.name,
            parameters: i.parameters || undefined,
            observation: i.observation,
          }))
      : [];

    // Normalize arrays
    const notableEvents = Array.isArray(parsed.notableEvents)
      ? parsed.notableEvents.filter((e: any) => typeof e === 'string')
      : [];
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((n: any) => typeof n === 'string')
      : [];

    return {
      metadata,
      primaryTrend,
      patterns,
      keyLevels,
      indicators,
      notableEvents,
      notes,
    };
  }
}
