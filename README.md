# TradionAI Backend (Express + TypeScript + Sequelize + Groq)

A production-ready TypeScript + Express + Sequelize + Groq backend scaffold that implements PRD features, Clerk auth, Paystack payments, usage limits (Free vs Pro), and market/sentiment API services (Binance, CoinGecko, Finnhub, CryptoPanic).

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

- `POST /api/chat` – AI chat (streaming by default). See [Chat streaming – Frontend guide](docs/chat-streaming-client.md) for consuming the stream and progress events.
- `POST /api/chat/no-stream` – AI chat (single JSON response, no streaming).
- `POST /api/risk/calculate` – risk calculator
- `POST /api/journal/entries` – log a trade
- `POST /api/journal/analyze` – AI feedback
- `GET /api/sentiment?symbol=BTC` – sentiment snapshot
- `POST /api/billing/initiate` – start Paystack payment
- `GET /api/billing/verify?reference=...` – verify payment
- `POST /api/billing/webhook/paystack` – webhook handler

### Live price WebSocket

- **URL**: `ws://<host>/api/ws` (e.g. `ws://localhost:8080/api/ws`)
- **Provider**: [Finnhub WebSocket Trades](https://finnhub.io/docs/api/websocket-trades) (stocks, forex, crypto).
- **Requires**: `FINNHUB_API_KEY` in the backend env (same key as sentiment). If missing, the WebSocket server is not attached.
- **Free tier**: 50 symbols per connection ([Finnhub pricing](https://finnhub.io/pricing)). The server subscribes to a fixed priority list of the most commonly traded symbols; clients receive all trade data and filter on the dashboard.

**Server → client messages**

- **Symbol list** (sent once on connect so the dashboard knows what symbols are streamed):
  ```json
  { "type": "symbols", "symbols": ["AAPL", "MSFT", ...], "limit": 50, "snapshotIntervalMs": 2000 }
  ```
- **Trades** (forwarded from Finnhub; filter by `data[].s` on the dashboard):
  ```json
  { "type": "trade", "data": [ { "s": "AAPL", "p": 175.5, "v": 100, "t": 1234567890000000000 } ] }
  ```
  - `s` = symbol, `p` = price, `v` = volume, `t` = timestamp (nanoseconds).
- **Snapshot** (periodic, enriched): last price, % change vs day open, SMA5/SMA20 per symbol.

**Configuration**

- `FINNHUB_WS_SYMBOL_LIMIT` (default `50`): max symbols to subscribe to (free tier = 50).
- `FINNHUB_WS_SYMBOLS`: optional comma-separated override (e.g. `AAPL,MSFT,BINANCE:BTCUSDT`). If set, replaces the default priority list (still capped by limit).
- `FINNHUB_WS_SNAPSHOT_INTERVAL_MS` (default `2000`): interval in ms between enriched snapshot messages.

For full client usage (message shapes, filtering, and examples), see **[Price WebSocket – Client Guide](docs/price-websocket-client.md)**.

### Account WebSocket (real-time dashboard)

- **URL**: `ws://<host>/api/ws/account` (e.g. `ws://localhost:8080/api/ws/account`)
- **Auth**: Pass Clerk session token as query `?token=<session_token>` or header `Authorization: Bearer <session_token>`.
- **Requires**: `REDIS_URL` and `ACCOUNT_WS_ENABLED=true`. The API server does not hold MetaAPI connections; a separate **streaming service** process does (see below).
- **Client messages**: Send JSON. `{ "action": "subscribe", "accountIds": ["<metaapiAccountId>", ...] }` to receive real-time updates. `{ "action": "unsubscribe", "accountIds": [...] }` to stop. Only accounts linked to the authenticated user are allowed.
- **Server to client**: Event-driven JSON, e.g. `{ "type": "account_info", "accountId": "...", "data": { "balance", "equity", ... } }`, `{ "type": "positions", "accountId": "...", "data": [...] }`, `{ "type": "synchronized", "accountId": "..." }`. See **[Account streaming migration (frontend)](docs/account-streaming-migration-frontend.md)** for moving from REST to WebSocket.

### Central streaming service

Run the streaming service as a separate process so real-time account updates work. It holds MetaAPI streaming connections and publishes to Redis; the API server forwards Redis messages to WebSocket clients.

- **Run**: `npm run streaming:run` (or `tsx src/streaming/streamingService.ts`).
- **Requires**: `REDIS_URL`, `METAAPI_TOKEN`, `DATABASE_URL`, `STREAMING_SERVICE_ENABLED=true`.
- **Config**: `METAAPI_STREAMING_MAX_CONNECTIONS` (default 2000), `METAAPI_STREAMING_GRACE_PERIOD_MS` (default 60000).

**In-process mode (single Web Service):** If you run only one API instance (e.g. Render free plan without Background Workers), the streaming logic runs inside the API process automatically. Set `REDIS_URL` and `METAAPI_TOKEN`; the server subscribes to Redis and manages MetaAPI connections in-process. No separate `streaming:run` process needed. Use a separate Background Worker when you scale to multiple API instances. Set `STREAMING_IN_PROCESS=false` on the API when the worker runs streaming.

**MetaAPI "Failed to subscribe TimeoutError":** The MetaAPI SDK can log this when the broker connection is briefly lost. MetaAPI states this is expected occasionally (MT terminal uptime is not perfect). The backend retries connect/sync up to 3 times with delay; if it still happens rarely, streaming usually continues to work. If it is frequent, check broker/MetaAPI account connectivity or contact MetaAPI support.

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
  - **Provider selection**: User-facing `model_id` selects **provider and model** (e.g. `groq/compound`). `getChatLLM(modelId)` returns the client for that provider; only Groq is wired today—add OpenAI/Claude by implementing `IChatLLMClient`, registering in `src/services/ai/llm/chatLLM.ts`, and adding ids (e.g. `openai/gpt-4o`) to `CHAT_MODELS_*`.
  - **Plan-based model selection**: Free and Pro plans can have different allowed model ids (`CHAT_MODELS_FREE`, `CHAT_MODELS_PRO`). Invalid `model_id` returns 400 `INVALID_MODEL`.
  - Intent detection (education, analysis, clarification, validation)
  - User level assessment (novice, intermediate, advanced)
  - Structured responses (Facts, Interpretation, Risk & Uncertainty)
  - Conversation continuity with message history
  - Safety guardrails to prevent unsafe advice
  - Adaptive tone based on user experience level
  - Supportive companion framing and optional “You might also ask…” suggestions
  - Economic calendar context (upcoming events) when relevant to the conversation
- Journal analysis with AI feedback
- Market context integration

### Market Data

- Binance API for crypto data and long/short ratios
- CoinGecko for price data
- Finnhub for **live price WebSocket** (stocks, forex, crypto) at `/api/ws`
- **Economic calendar**: [RapidAPI Economic Calendar API](https://rapidapi.com/yasimpratama88/api/economic-calendar-api). Set `RAPIDAPI_KEY` and optionally `RAPIDAPI_ECONOMIC_CALENDAR_HOST` (default: `economic-calendar-api.p.rapidapi.com`). Calendar data is synced to the database once or twice daily and included in chat context when relevant.
- CryptoPanic for news sentiment

### Payments

- Paystack integration for Nigerian payments
- Support for both one-time and subscription payments
- Webhook handling for payment verification

### Background Jobs

When `ENABLE_JOBS=true` (default), the scheduler runs:

- **syncTradingData** (every 10 minutes): Syncs MetaAPI account state, positions, and trade history to the database for journal and risk features.
- **syncEconomicCalendar** (twice daily at 06:00 and 18:00): Fetches the next 14 days of economic calendar events from RapidAPI and upserts them into the database for chat context.

Configurable via `ENABLE_JOBS` environment variable.

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
- **Finnhub (live prices)**: Same `FINNHUB_API_KEY` is used for the price WebSocket at `/api/ws`. If the key is not set, the WebSocket server is disabled.
- **Feature Flags**: Enable/disable background jobs

### Chat and conversation tuning

- `CONVERSATION_HISTORY_MAX_MESSAGES` (default `24`): Max number of recent messages to include in context.
- `CONVERSATION_HISTORY_MAX_TOKENS` (default `4096`): Token budget for conversation history (uses tokenizer with char-based fallback).
- `CONVERSATION_SUMMARIZE_WHEN_MESSAGES_OVER` (default `8`): When message count exceeds this, older messages are summarized.
- `CONVERSATION_LAST_K_FULL_MESSAGES` (default `4`): Number of most recent messages kept in full when summarizing.
- `CONVERSATION_CHARS_PER_TOKEN` (default `4`): Used for token fallback when tokenizer is unavailable.
- `CONVERSATION_SUMMARIZE_WHEN_TOKENS_OVER`: Optional. When set, summarization also runs when estimated history tokens exceed this value.
- `GROQ_TIMEOUT` (default `30000`): Groq API request timeout in ms.
- `GROQ_MAX_TOKENS` (default `2000`): Max completion tokens per chat call.
- `GROQ_MODEL` (default `groq/compound`): Default Groq model id for chat and internal calls. Can be overridden per request via the optional `model_id` body field (validated against the user's plan allowlist).
- `CHAT_MODELS_FREE`: Optional comma-separated list of model ids allowed for free plan (default: `groq/compound`). Used when the client sends `model_id`.
- `CHAT_MODELS_PRO`: Optional comma-separated list of model ids allowed for pro plan (default: `groq/compound`). Pro can list additional models (e.g. `groq/compound,groq/llama-3.1-70b-versatile`).
- `CHAT_REQUEST_TIMEOUT_MS` (default `55000`): Overall chat request timeout; on timeout the API returns 504 with code `TIMEOUT`.
- `CONTEXT_CACHE_TTL_SECONDS` (default `90`): TTL for market/sentiment context cache.
- `CONTEXT_CACHE_ENABLED` (default `true`): Set to `false` to disable context cache.

Increasing token/history limits improves long conversations but increases cost and latency.

### API error codes (chat and common endpoints)

Error responses use the shape `{ error: { code: string, message: string, details?: string } }`. Codes:

- `UNAUTHORIZED` (401): Missing or invalid auth.
- `VALIDATION_ERROR` (400): Invalid request body (e.g. empty message).
- `INVALID_MODEL` (400): The requested `model_id` is not available on the user's plan.
- `RATE_LIMIT` (402): Free plan daily chat limit reached.
- `CONTEXT_TOO_LONG` (413): Conversation or message too long; suggest starting a new chat.
- `TIMEOUT` (504): Chat request timed out.
- `PROVIDER_ERROR` (500): Server or provider error; optional `details` in development.

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
