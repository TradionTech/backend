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

  // Crypto Fear & Greed Index API
  CRYPTO_FG_API_BASE_URL: process.env.CRYPTO_FG_API_BASE_URL ?? 'https://api.alternative.me/fng/',
  CRYPTO_FG_API_KEY: process.env.CRYPTO_FG_API_KEY ?? '',

  // Finnhub (sentiment: news-sentiment + general news)
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY ?? '',
  FINNHUB_BASE_URL: process.env.FINNHUB_BASE_URL ?? 'https://finnhub.io/api/v1',
  SENTIMENT_ENABLE_FINNHUB_EQUITY: process.env.SENTIMENT_ENABLE_FINNHUB_EQUITY ?? '',
  SENTIMENT_ENABLE_FINNHUB_GENERAL: process.env.SENTIMENT_ENABLE_FINNHUB_GENERAL ?? '',

  // Sentiment snapshot config (optional overrides)
  SENTIMENT_WINDOW_MINUTES: process.env.SENTIMENT_WINDOW_MINUTES ?? '',
  SENTIMENT_MIN_SIGNALS: process.env.SENTIMENT_MIN_SIGNALS ?? '',
  SENTIMENT_NEUTRAL_THRESHOLD: process.env.SENTIMENT_NEUTRAL_THRESHOLD ?? '',
  SENTIMENT_STRONG_THRESHOLD: process.env.SENTIMENT_STRONG_THRESHOLD ?? '',

  // Groq AI
  GROQ_API_KEY: process.env.GROQ_API_KEY ?? '',
  GROQ_TIMEOUT: parseInt(process.env.GROQ_TIMEOUT ?? '30000', 10),
  GROQ_TEMPERATURE: parseFloat(process.env.GROQ_TEMPERATURE ?? '0.7'),
  GROQ_MAX_TOKENS: parseInt(process.env.GROQ_MAX_TOKENS ?? '2000', 10),

  // Conversation context (history + summarization)
  CONVERSATION_HISTORY_MAX_MESSAGES: parseInt(
    process.env.CONVERSATION_HISTORY_MAX_MESSAGES ?? '24',
    10
  ),
  CONVERSATION_HISTORY_MAX_TOKENS: parseInt(
    process.env.CONVERSATION_HISTORY_MAX_TOKENS ?? '4096',
    10
  ),
  CONVERSATION_HISTORY_MAX_TOKENS_COACHING: process.env
    .CONVERSATION_HISTORY_MAX_TOKENS_COACHING
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

  // Storage (S3/R2)
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? 's3',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
  S3_REGION: process.env.S3_REGION ?? 'auto',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ?? '',
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL ?? '',

  ENABLE_JOBS: (process.env.ENABLE_JOBS ?? 'true') === 'true',
};
