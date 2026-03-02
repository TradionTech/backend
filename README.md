# TradionAI Backend (Express + TypeScript + Sequelize)

A production-ready TypeScript + Express + Sequelize backend scaffold that implements PRD features, Clerk auth, Paystack payments, usage limits (Free vs Pro), and market/sentiment API services (Binance, CoinGecko, Finnhub, CryptoPanic).

## Quickstart

1. Copy environment variables:

   ```bash
   cp env.sample .env
   ```

2. Fill in your environment variables in `.env`:
   - Database connection string
   - Clerk authentication keys
   - Paystack payment keys
   - Market data API keys

3. Install dependencies:

   ```bash
   npm install
   ```

4. Sync database:

   ```bash
   npm run db:sync
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

## Key Endpoints

- `POST /api/chat` – AI chat (text)
- `POST /api/risk/calculate` – risk calculator
- `POST /api/journal/entries` – log a trade
- `POST /api/journal/analyze` – AI feedback
- `GET /api/sentiment?symbol=BTC` – sentiment snapshot
- `POST /api/billing/initiate` – start Paystack payment
- `GET /api/billing/verify?reference=...` – verify payment
- `POST /api/billing/webhook/paystack` – webhook handler

## API Documentation

- Swagger UI is available at `http://localhost:8080/api/docs` once the server is running.
- The raw OpenAPI document can be fetched at `http://localhost:8080/api/docs.json`.
- Endpoints are grouped by feature (Chat, Risk, Journal, Billing, Accounts, etc.) with request/response schemas and auth requirements for frontend integration.

## Plans & Usage

- **Free Plan**: Limited daily chat (20) and analyses (3)
- **Pro Plan**: Unlimited usage
- Usage counters reset daily automatically
- See `src/services/plans/limits.ts` for configuration

## Features

### Authentication

- Clerk integration for user management
- Automatic user creation on first login
- JWT-based authentication

### AI Services

- **Chat LLM Integration**: Full Groq Compound model integration with:
  - Intent detection (education, analysis, clarification, validation)
  - User level assessment (novice, intermediate, advanced)
  - Structured responses (Facts, Interpretation, Risk & Uncertainty)
  - Conversation continuity with message history
  - Safety guardrails to prevent unsafe advice
  - Adaptive tone based on user experience level
- Journal analysis with AI feedback
- Market context integration (placeholder for future enhancement)

### Market Data

- Binance API for crypto data and long/short ratios
- CoinGecko for price data
- Finnhub for economic calendar
- CryptoPanic for news sentiment

### Payments

- Paystack integration for Nigerian payments
- Support for both one-time and subscription payments
- Webhook handling for payment verification

### Background Jobs

- Price data fetching
- Sentiment analysis
- Economic calendar updates
- Configurable via `ENABLE_JOBS` environment variable

## Database Models

- **User**: Clerk user integration with plan management
- **ChatSession/ChatMessage**: AI chat history
- **RiskCalculation**: Risk management calculations (includes chat integration fields: `chat_session_id`, `message_id`, `correlation_id`)
- **JournalEntry**: Trading journal with AI feedback
- **SentimentScore**: Market sentiment tracking
- **Payment/Subscription**: Billing management
- **UsageStat**: Daily usage tracking
- **MetaApiAccount/TradingPosition/TradeHistory/AccountEquitySnapshot**: Broker integration models
- **UserProfileMetrics**: Computed trading profile metrics

See [Database Schema Documentation](docs/database-schema.md) for complete schema details, relationships, and field descriptions.

## Development

```bash
# Run with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run database sync
npm run db:sync

# Run background jobs
npm run jobs:run

# Lint code
npm run lint

# Format code
npm run format
```

## Environment Variables

See `env.sample` for all required environment variables:

- **Database**: PostgreSQL connection string
- **Clerk**: Authentication keys and audience
- **Paystack**: Payment processing keys
- **APIs**: Binance, CoinGecko, Finnhub, CryptoPanic keys
- **Alpha Vantage**: `ALPHAVANTAGE_API_KEY` (for news sentiment), `ALPHAVANTAGE_BASE_URL` (optional)
- **Crypto Fear & Greed**: `CRYPTO_FG_API_BASE_URL` (optional, defaults to Alternative.me), `CRYPTO_FG_API_KEY` (optional)
- **Finnhub (sentiment)**: `FINNHUB_API_KEY`, `FINNHUB_BASE_URL` (optional). Set `SENTIMENT_ENABLE_FINNHUB_EQUITY=true` and/or `SENTIMENT_ENABLE_FINNHUB_GENERAL=true` to enable equity news sentiment and FX/crypto general news.
- **Feature Flags**: Enable/disable background jobs

## Deployment

Ready for deployment on:

- **Render**: Single service deployment
- **Vercel**: Serverless functions
- **Railway**: Container deployment

All environment variables should be configured in your deployment platform.

## Notes

- Groq Compound model is fully integrated - set `GROQ_API_KEY` in environment
- Respect API provider rate limits
- Adjust job schedules in `src/jobs/scheduler.ts` based on your needs
- Implement proper webhook signature verification for production
- Add admin role checks for admin endpoints in production

## Chat System Architecture

The chat system uses a layered architecture:

1. **API Layer** (`chat.controller.ts`): Handles HTTP requests, usage limits, validation
2. **Orchestrator** (`chatOrchestrator.ts`): Coordinates all components
3. **Intent Detection** (`intentDetector.ts`): Classifies user intent and experience level
4. **Groq Client** (`groqCompoundClient.ts`): Wraps Groq's OpenAI-compatible API
5. **Prompt Builder** (`promptBuilder.ts`): Constructs system prompts with safety rules
6. **Safety Guard** (`safetyGuard.ts`): Post-processes responses for safety
7. **Conversation Store** (`conversationStore.ts`): Manages message history and sessions

All responses are structured into three sections: Facts, Interpretation, and Risk & Uncertainty. The system adapts its tone based on detected user level and intent.
