import { GroqCompoundClient } from '../groqCompoundClient';
import axios from 'axios';
import { env } from '../../../config/env';

jest.mock('axios');
jest.mock('../../../config/env', () => ({
  env: {
    GROQ_API_KEY: 'test-api-key',
    GROQ_TIMEOUT: 30000,
    GROQ_TEMPERATURE: 0.7,
    GROQ_MAX_TOKENS: 2000,
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GroqCompoundClient', () => {
  let client: GroqCompoundClient;

  beforeEach(() => {
    client = new GroqCompoundClient();
    jest.clearAllMocks();
  });

  describe('completeChat', () => {
    it('should make correct API request to Groq', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                content: 'Test response',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await client.completeChat({
        messages: [
          { role: 'user', content: 'Test message' },
        ],
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.objectContaining({
          model: 'groq/compound',
          messages: [{ role: 'user', content: 'Test message' }],
          max_completion_tokens: 2000,
          temperature: 0.7,
        }),
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        })
      );

      expect(result.id).toBe('chatcmpl-123');
      expect(result.content).toBe('Test response');
      expect(result.finishReason).toBe('stop');
      // Verify usage is mapped from snake_case to camelCase
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should include compound_custom.tools.enabled_tools when tools are provided', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await client.completeChat({
        messages: [{ role: 'user', content: 'Test' }],
        allowedTools: ['web_search', 'code_interpreter'],
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          compound_custom: {
            tools: {
              enabled_tools: ['web_search', 'code_interpreter'],
            },
          },
        }),
        expect.any(Object)
      );
    });

    it('should throw error when API key is missing', async () => {
      const clientWithoutKey = new GroqCompoundClient();
      // Override the apiKey property
      (clientWithoutKey as any).apiKey = '';

      await expect(
        clientWithoutKey.completeChat({
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('GROQ_API_KEY is not configured');
    });

    it('should handle API errors gracefully', async () => {
      const errorResponse = {
        response: {
          status: 401,
          data: {
            error: {
              message: 'Invalid API key',
              type: 'authentication_error',
            },
          },
        },
      };

      mockedAxios.post.mockRejectedValueOnce(errorResponse);

      await expect(
        client.completeChat({
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('Groq API error (401): Invalid API key');
    });
  });

  describe('detectIntent', () => {
    it('should parse intent and user level from JSON response with JSON mode', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                content: '{\n  "intents": [{"intent": "analysis", "confidence": 0.9}],\n  "primaryIntent": "analysis",\n  "user_level": "advanced"\n}',
              },
              finish_reason: 'stop',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await client.detectIntent('What is the best strategy?', []);

      // Verify JSON mode was used
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          response_format: { type: 'json_object' },
        }),
        expect.any(Object)
      );

      expect(result.primaryIntent).toBe('analysis');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('analysis');
      expect(result.user_level).toBe('advanced');
    });

    it('should fallback to defaults on parse error', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                content: 'Invalid JSON response',
              },
              finish_reason: 'stop',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await client.detectIntent('Test', []);

      expect(result.primaryIntent).toBe('education');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('education');
      expect(result.user_level).toBe('intermediate');
    });

    it('should validate intent and user_level values', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                content: '{\n  "intents": [{"intent": "invalid", "confidence": 0.8}],\n  "primaryIntent": "invalid",\n  "user_level": "invalid"\n}',
              },
              finish_reason: 'stop',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await client.detectIntent('Test', []);

      expect(result.primaryIntent).toBe('education');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('education');
      expect(result.user_level).toBe('intermediate');
    });

    it('should handle backward compatibility with old single intent format', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                content: '{\n  "intent": "analysis",\n  "user_level": "advanced"\n}',
              },
              finish_reason: 'stop',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await client.detectIntent('Test', []);

      expect(result.primaryIntent).toBe('analysis');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('analysis');
      expect(result.user_level).toBe('advanced');
    });

    it('should detect multiple intents in a single message', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                content: '{\n  "intents": [{"intent": "education", "confidence": 0.9}, {"intent": "risk_evaluation", "confidence": 0.85}],\n  "primaryIntent": "education",\n  "user_level": "intermediate"\n}',
              },
              finish_reason: 'stop',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await client.detectIntent('Explain what a stop loss is and also confirm if my EURUSD trade is too risky', []);

      expect(result.primaryIntent).toBe('education');
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0].intent).toBe('education');
      expect(result.intents[0].confidence).toBe(0.9);
      expect(result.intents[1].intent).toBe('risk_evaluation');
      expect(result.intents[1].confidence).toBe(0.85);
      expect(result.user_level).toBe('intermediate');
    });
  });
});
