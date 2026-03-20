import 'dotenv/config';

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: process.env.PORT ?? '8080',
  DATABASE_URL: process.env.DATABASE_URL ?? '',

  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
  CLERK_JWT_AUDIENCE: process.env.CLERK_JWT_AUDIENCE ?? '',
  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET ?? '',

  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? '',
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY ?? '',
  PAYSTACK_PRO_PLAN_CODE: process.env.PAYSTACK_PRO_PLAN_CODE ?? '',
  PAYSTACK_ONE_TIME_AMOUNT_KOBO: process.env.PAYSTACK_ONE_TIME_AMOUNT_KOBO ?? '0',

  // MetaAPI (trading accounts)
  METAAPI_TOKEN: process.env.METAAPI_TOKEN ?? '',
  METAAPI_ACCOUNT_ID: process.env.METAAPI_ACCOUNT_ID ?? '',

  // Redis (streaming + account WebSocket)
  REDIS_URL: process.env.REDIS_URL ?? '',
  /** Max MetaAPI streaming connections in the central streaming service. */
  METAAPI_STREAMING_MAX_CONNECTIONS: parseInt(
    process.env.METAAPI_STREAMING_MAX_CONNECTIONS ?? '2000',
    10
  ),
  /** Grace period in ms before closing a streaming connection after last unsubscribe. */
  METAAPI_STREAMING_GRACE_PERIOD_MS: parseInt(
    process.env.METAAPI_STREAMING_GRACE_PERIOD_MS ?? '60000',
    10
  ),
  STREAMING_SERVICE_ENABLED: (process.env.STREAMING_SERVICE_ENABLED ?? 'true') === 'true',
  /** When true, run streaming connection manager in the API process. Set false when using a separate Background Worker. */
  STREAMING_IN_PROCESS: (process.env.STREAMING_IN_PROCESS ?? 'true') === 'true',
  ACCOUNT_WS_ENABLED: (process.env.ACCOUNT_WS_ENABLED ?? 'true') === 'true',

  // Unified external Market Data API
  MARKET_API_BASE_URL: process.env.MARKET_API_BASE_URL ?? '',
  MARKET_API_KEY: process.env.MARKET_API_KEY ?? '',
  MARKET_DATA_PROVIDER: (process.env.MARKET_DATA_PROVIDER ?? 'alpha_vantage') as
    | 'dummy'
    | 'real'
    | 'alpha_vantage',

  // Alpha Vantage API
  ALPHAVANTAGE_API_KEY: process.env.ALPHAVANTAGE_API_KEY ?? '',
  ALPHAVANTAGE_BASE_URL: process.env.ALPHAVANTAGE_BASE_URL ?? 'https://www.alphavantage.co/query',
  /** Min ms between requests (free tier: 1 req/s = 1000). Set to 0 to disable when using premium. */
  ALPHAVANTAGE_MIN_INTERVAL_MS: parseInt(process.env.ALPHAVANTAGE_MIN_INTERVAL_MS ?? '1000', 10),
  /**
   * Second Alpha Vantage request per snapshot: GLOBAL_QUOTE (equities) or CURRENCY_EXCHANGE_RATE (FX/crypto)
   * to align last price and timestamp with spot/global quote. Set ALPHAVANTAGE_ENRICH_QUOTES=false to save quota.
   */
  ALPHAVANTAGE_ENRICH_QUOTES: (process.env.ALPHAVANTAGE_ENRICH_QUOTES ?? 'true').toLowerCase() !== 'false',
  /** NEWS_SENTIMENT article limit (Alpha Vantage allows up to 1000). */
  ALPHAVANTAGE_NEWS_LIMIT: Math.min(
    1000,
    Math.max(1, parseInt(process.env.ALPHAVANTAGE_NEWS_LIMIT ?? '100', 10))
  ),

  // Crypto Fear & Greed Index API
  CRYPTO_FG_API_BASE_URL: process.env.CRYPTO_FG_API_BASE_URL ?? 'https://api.alternative.me/fng/',
  CRYPTO_FG_API_KEY: process.env.CRYPTO_FG_API_KEY ?? '',

  // Finnhub (sentiment: news-sentiment + general news)
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY ?? '',
  FINNHUB_BASE_URL: process.env.FINNHUB_BASE_URL ?? 'https://finnhub.io/api/v1',
  SENTIMENT_ENABLE_FINNHUB_EQUITY: process.env.SENTIMENT_ENABLE_FINNHUB_EQUITY ?? '',
  SENTIMENT_ENABLE_FINNHUB_GENERAL: process.env.SENTIMENT_ENABLE_FINNHUB_GENERAL ?? '',
  /** Price WebSocket: max symbols (free tier = 50). */
  FINNHUB_WS_SYMBOL_LIMIT: parseInt(process.env.FINNHUB_WS_SYMBOL_LIMIT ?? '50', 10),
  /** Optional: comma-separated symbols override (e.g. "AAPL,MSFT,BINANCE:BTCUSDT"). */
  FINNHUB_WS_SYMBOLS: process.env.FINNHUB_WS_SYMBOLS ?? '',
  /** Price WebSocket snapshot interval in ms (enriched data: pct change, SMA). Default 2000. */
  FINNHUB_WS_SNAPSHOT_INTERVAL_MS: parseInt(
    process.env.FINNHUB_WS_SNAPSHOT_INTERVAL_MS ?? '1000',
    10
  ),

  // Sentiment snapshot config (optional overrides)
  SENTIMENT_WINDOW_MINUTES: process.env.SENTIMENT_WINDOW_MINUTES ?? '',
  SENTIMENT_MIN_SIGNALS: process.env.SENTIMENT_MIN_SIGNALS ?? '',
  SENTIMENT_NEUTRAL_THRESHOLD: process.env.SENTIMENT_NEUTRAL_THRESHOLD ?? '',
  SENTIMENT_STRONG_THRESHOLD: process.env.SENTIMENT_STRONG_THRESHOLD ?? '',

  // Groq AI
  GROQ_API_KEY: process.env.GROQ_API_KEY ?? '',
  GROQ_MODEL: process.env.GROQ_MODEL ?? 'groq/compound',
  GROQ_TIMEOUT: parseInt(process.env.GROQ_TIMEOUT ?? '30000', 10),
  GROQ_TEMPERATURE: parseFloat(process.env.GROQ_TEMPERATURE ?? '0.7'),
  GROQ_MAX_TOKENS: parseInt(process.env.GROQ_MAX_TOKENS ?? '2000', 10),
  /** Max retries when Groq returns 429 (rate limit); waits per API hint or backoff. */
  GROQ_429_MAX_RETRIES: (() => {
    const n = parseInt(process.env.GROQ_429_MAX_RETRIES || '4', 10);
    if (!Number.isFinite(n)) return 4;
    return Math.min(10, Math.max(1, n));
  })(),

  // Conversation context (history + summarization)
  CONVERSATION_HISTORY_MAX_MESSAGES: parseInt(
    process.env.CONVERSATION_HISTORY_MAX_MESSAGES ?? '24',
    10
  ),
  CONVERSATION_HISTORY_MAX_TOKENS: parseInt(
    process.env.CONVERSATION_HISTORY_MAX_TOKENS ?? '4096',
    10
  ),
  CONVERSATION_HISTORY_MAX_TOKENS_COACHING: process.env.CONVERSATION_HISTORY_MAX_TOKENS_COACHING
    ? parseInt(process.env.CONVERSATION_HISTORY_MAX_TOKENS_COACHING, 10)
    : undefined,
  CONVERSATION_SUMMARIZE_WHEN_MESSAGES_OVER: parseInt(
    process.env.CONVERSATION_SUMMARIZE_WHEN_MESSAGES_OVER ?? '8',
    10
  ),
  CONVERSATION_LAST_K_FULL_MESSAGES: parseInt(
    process.env.CONVERSATION_LAST_K_FULL_MESSAGES ?? '4',
    10
  ),
  CONVERSATION_CHARS_PER_TOKEN: parseInt(process.env.CONVERSATION_CHARS_PER_TOKEN ?? '4', 10),
  CONVERSATION_SUMMARIZE_WHEN_TOKENS_OVER: process.env.CONVERSATION_SUMMARIZE_WHEN_TOKENS_OVER
    ? parseInt(process.env.CONVERSATION_SUMMARIZE_WHEN_TOKENS_OVER, 10)
    : undefined,

  // Context cache TTL in seconds. Set CONTEXT_CACHE_ENABLED=false to disable.
  CONTEXT_CACHE_TTL_SECONDS: parseInt(process.env.CONTEXT_CACHE_TTL_SECONDS ?? '90', 10),
  CONTEXT_CACHE_ENABLED: (process.env.CONTEXT_CACHE_ENABLED ?? 'true') === 'true',

  /** Overall chat request timeout in ms (e.g. 55000). On timeout return 504. */
  CHAT_REQUEST_TIMEOUT_MS: parseInt(process.env.CHAT_REQUEST_TIMEOUT_MS ?? '55000', 10),

  // Signal confirmer (Python FastAPI)
  // Frontend calls the Node monolith; monolith forwards to the Python service.
  SIGNAL_CONFIRMER_BASE_URL: process.env.SIGNAL_CONFIRMER_BASE_URL ?? '',
  // Path on the Python service (keep /confirm-signal for backward compatibility)
  SIGNAL_CONFIRMER_ENDPOINT: process.env.SIGNAL_CONFIRMER_ENDPOINT ?? '/confirm-signal',
  // Must stay within the 5s end-to-end budget for production usage.
  SIGNAL_CONFIRMER_TIMEOUT_MS: parseInt(process.env.SIGNAL_CONFIRMER_TIMEOUT_MS ?? '4500', 10),

  // Storage (S3/R2)
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? 's3',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
  S3_REGION: process.env.S3_REGION ?? 'auto',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ?? '',
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL ?? '',

  ENABLE_JOBS: (process.env.ENABLE_JOBS ?? 'true') === 'true',

  // RapidAPI Economic Calendar
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY ?? '',
  RAPIDAPI_ECONOMIC_CALENDAR_HOST:
    process.env.RAPIDAPI_ECONOMIC_CALENDAR_HOST ?? 'economic-calendar-api.p.rapidapi.com',
};
