/**
 * Tests for GroqChartVisionProvider
 */

import axios from 'axios';
import { GroqChartVisionProvider } from '../providers/groqChartVisionProvider';
import { env } from '../../../config/env';

jest.mock('axios');
jest.mock('../../../config/env', () => ({
  env: {
    GROQ_API_KEY: 'test-api-key',
    GROQ_TIMEOUT: 30000,
  },
}));

describe('GroqChartVisionProvider', () => {
  let provider: GroqChartVisionProvider;
  let mockAxiosPost: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GroqChartVisionProvider();
    mockAxiosPost = axios.post as jest.Mock;
  });

  describe('analyzeChart', () => {
    it('should analyze chart and return structured features', async () => {
      const mockResponse = {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
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
                    },
                  ],
                  indicators: [],
                  notableEvents: [],
                  notes: [],
                }),
              },
            },
          ],
        },
      };

      mockAxiosPost.mockResolvedValue(mockResponse);

      const result = await provider.analyzeChart({
        chartId: 'chart-123',
        imageUrl: 'https://example.com/chart.png',
      });

      expect(result.metadata.symbol).toBe('EURUSD');
      expect(result.primaryTrend).toBe('up');
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].code).toBe('TREND_UP');
      expect(result.keyLevels).toHaveLength(1);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.objectContaining({
          model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
          response_format: { type: 'json_object' },
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'image_url',
                  image_url: { url: 'https://example.com/chart.png' },
                }),
              ]),
            }),
          ]),
        }),
        expect.any(Object)
      );
    });

    it('should handle malformed JSON response', async () => {
      const mockResponse = {
        data: {
          choices: [
            {
              message: {
                content: 'Some text before {\n  "primaryTrend": "up"\n} and after',
              },
            },
          ],
        },
      };

      mockAxiosPost.mockResolvedValue(mockResponse);

      const result = await provider.analyzeChart({
        chartId: 'chart-123',
        imageUrl: 'https://example.com/chart.png',
      });

      expect(result.primaryTrend).toBe('up');
    });

    it('should normalize and validate response data', async () => {
      const mockResponse = {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  primaryTrend: 'invalid_trend',
                  patterns: [
                    {
                      code: 'TREND_UP',
                      confidence: 1.5, // Invalid: > 1.0
                      description: 'Test',
                    },
                  ],
                  keyLevels: [
                    {
                      type: 'invalid_type',
                      price: 'not-a-number',
                    },
                  ],
                  indicators: [],
                  notableEvents: [],
                  notes: [],
                }),
              },
            },
          ],
        },
      };

      mockAxiosPost.mockResolvedValue(mockResponse);

      const result = await provider.analyzeChart({
        chartId: 'chart-123',
        imageUrl: 'https://example.com/chart.png',
      });

      expect(result.primaryTrend).toBe('unclear'); // Normalized
      expect(result.patterns[0].confidence).toBe(1.0); // Clamped to 1.0
      expect(result.keyLevels).toHaveLength(0); // Invalid level filtered out
    });

    it('should throw error when API key is missing', async () => {
      (env as any).GROQ_API_KEY = '';
      const providerWithoutKey = new GroqChartVisionProvider();

      await expect(
        providerWithoutKey.analyzeChart({
          chartId: 'chart-123',
          imageUrl: 'https://example.com/chart.png',
        })
      ).rejects.toThrow('GROQ_API_KEY is not configured');
    });

    it('should handle API errors gracefully', async () => {
      const axiosError = {
        response: {
          status: 429,
          data: {
            error: {
              message: 'Rate limit exceeded',
            },
          },
        },
      };

      mockAxiosPost.mockRejectedValue(axiosError);

      await expect(
        provider.analyzeChart({
          chartId: 'chart-123',
          imageUrl: 'https://example.com/chart.png',
        })
      ).rejects.toThrow('Groq vision API error (429)');
    });
  });
});
