import { groqCompoundClient } from '../ai/groqCompoundClient';
import { logger } from '../../config/logger';
import type { MarketContextRequest } from '../../types/market';
import { mapTimeframeHint } from './timeframeMapper';
import { inferAssetClass } from './assetClassInferrer';

/**
 * Extracts market context information (symbol, asset class, timeframe) from user messages.
 * 
 * Uses Groq Compound model to intelligently parse user queries and extract:
 * - Trading symbols (e.g., "EURUSD", "BTC", "AAPL")
 * - Asset class hints
 * - Timeframe hints (e.g., "scalping", "intraday", "swing", "1H", "daily")
 * 
 * This is similar to the intentDetector but focused on market-specific information.
 */
export class MarketContextIntentExtractor {
  /**
   * Extract market context request from user message.
   * 
   * @param message User's message text
   * @param metadata Optional metadata from request (may already contain symbol/timeframe)
   * @returns MarketContextRequest with extracted information
   */
  async extractContextRequest(
    message: string,
    metadata?: { instrument?: string; timeframe?: string; [key: string]: unknown }
  ): Promise<MarketContextRequest> {
    // If metadata already provides symbol/timeframe, use it
    if (metadata?.instrument || metadata?.timeframe) {
      const symbol = metadata.instrument as string | undefined;
      const timeframeHint = metadata.timeframe as string | undefined;
      
      return {
        symbol,
        timeframeHint,
        rawQuery: message,
        assetClass: symbol ? inferAssetClass(symbol) : undefined,
      };
    }

    // Otherwise, use Groq to extract from message
    try {
      const extracted = await this.extractWithGroq(message);
      return {
        ...extracted,
        rawQuery: message,
      };
    } catch (error) {
      logger.warn('Failed to extract market context with Groq', {
        error: (error as Error).message,
        message: message.substring(0, 100),
      });

      // Fallback: return empty request
      return {
        rawQuery: message,
      };
    }
  }

  /**
   * Use Groq Compound to extract symbol and timeframe from message.
   */
  private async extractWithGroq(message: string): Promise<MarketContextRequest> {
    const systemPrompt = `You are a market context extractor for a trading education platform. 
Analyze the user's message and extract any trading-related information:

1. Symbol: Extract any trading symbols mentioned (e.g., EURUSD, BTC, AAPL, SPX, etc.)
   - Look for currency pairs (EURUSD, GBPUSD, USDJPY, etc.)
   - Look for stock tickers (AAPL, MSFT, TSLA, etc.)
   - Look for crypto tickers (BTC, ETH, etc.)
   - Look for index symbols (SPX, DJI, etc.)
   - Return null if no symbol is found

2. Timeframe hint: Extract any timeframe references
   - Look for explicit timeframes (1H, 4H, D1, M15, etc.)
   - Look for trading style terms (scalping, intraday, swing, long term, etc.)
   - Look for duration references (hourly, daily, weekly, etc.)
   - Return null if no timeframe is mentioned

3. Asset class hint: If a symbol is found, infer the asset class
   - FX: currency pairs (EURUSD, GBPUSD, etc.)
   - CRYPTO: cryptocurrency tickers (BTC, ETH, etc.)
   - EQUITY: stock tickers (AAPL, MSFT, etc.)
   - INDEX: index symbols (SPX, DJI, etc.)
   - Return null if uncertain

Respond with valid JSON in this exact format:
{
  "symbol": "EURUSD" or null,
  "timeframeHint": "intraday" or null,
  "assetClass": "FX" or null
}

Only include fields that are actually found in the message. Use null for missing information.`;

    const userMessage = `User message: ${message}\n\nExtract trading symbol, timeframe hint, and asset class if mentioned.`;

    try {
      const response = await groqCompoundClient.completeChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        maxTokens: 200,
        temperature: 0.3, // Lower temperature for more consistent extraction
        responseFormat: { type: 'json_object' }, // Use JSON mode
      });

      // Parse JSON response
      const content = response.content.trim();
      let parsed: Partial<MarketContextRequest>;

      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        // Fallback: try to extract JSON from text if model added extra text
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          logger.warn('Failed to parse market context extraction JSON', { content });
          return {};
        }
      }

      // Validate and return
      const result: MarketContextRequest = {};

      if (parsed.symbol && typeof parsed.symbol === 'string') {
        result.symbol = parsed.symbol.toUpperCase().trim();
        // Infer asset class if not provided
        result.assetClass = parsed.assetClass || inferAssetClass(result.symbol);
      }

      if (parsed.timeframeHint && typeof parsed.timeframeHint === 'string') {
        result.timeframeHint = parsed.timeframeHint.trim();
      }

      // Validate asset class if provided
      if (parsed.assetClass && typeof parsed.assetClass === 'string') {
        const validAssetClasses = ['FX', 'EQUITY', 'CRYPTO', 'FUTURES', 'INDEX', 'OTHER'];
        if (validAssetClasses.includes(parsed.assetClass)) {
          result.assetClass = parsed.assetClass as any;
        }
      }

      return result;
    } catch (error) {
      logger.error('Groq market context extraction failed', {
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

// Export singleton instance
export const marketContextIntentExtractor = new MarketContextIntentExtractor();
