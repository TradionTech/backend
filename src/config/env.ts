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

  ENABLE_JOBS: (process.env.ENABLE_JOBS ?? 'true') === 'true',
};
