import swaggerJsdoc from 'swagger-jsdoc';

const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'TradionAI API',
    version: '1.0.0',
    description:
      'REST API for TradionAI backend covering chat, risk management, billing, journal, trading accounts, and webhooks.',
  },
  servers: [
    {
      url: '/api',
      description:
        'Relative base URL (replace with https://backend-5vek.onrender.com/api in production)',
    },
  ],
  tags: [
    { name: 'Chat', description: 'LLM assistant endpoints' },
    { name: 'Risk', description: 'Risk calculator tools' },
    { name: 'Journal', description: 'Trading journal entries and AI analysis' },
    { name: 'Sentiment', description: 'Market sentiment snapshots' },
    { name: 'Billing', description: 'Paystack payments and billing hooks' },
    { name: 'Accounts', description: 'Linked MetaAPI trading accounts' },
    { name: 'Admin', description: 'Operational health endpoints' },
    { name: 'Users', description: 'User provisioning helpers' },
    { name: 'Webhooks', description: 'Inbound webhook handlers' },
    { name: 'Auth', description: 'Authentication helpers' },
    { name: 'Charts', description: 'Chart image upload and analysis' },
    { name: 'Profiles', description: 'User profile and trading metrics' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Clerk session JWT (Authorization: Bearer <token>).',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'validation_error' },
          message: { type: 'string', example: 'Detailed explanation of the failure.' },
        },
      },
      LimitError: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            example: 'Free plan daily chat limit reached. Upgrade to Pro.',
          },
        },
      },
      ChatRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          session_id: { type: 'string', format: 'uuid' },
          message: { type: 'string', maxLength: 2000 },
          message_type: { type: 'string', enum: ['text'], default: 'text' },
          metadata: {
            type: 'object',
            properties: {
              instrument: { type: 'string' },
              timeframe: { type: 'string' },
              chartId: { type: 'string', format: 'uuid' },
            },
          },
          images: {
            type: 'array',
            items: { type: 'string', description: 'Base64 or data URL (data:image/...;base64,...)' },
            maxItems: 10,
            description: 'Optional images for chart analysis',
          },
        },
      },
      ChatResponse: {
        type: 'object',
        properties: {
          response_id: { type: 'string', example: 'resp_abcd1234' },
          text: { type: 'string' },
          sources: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      RiskRequest: {
        type: 'object',
        required: ['account_balance', 'risk_percent', 'entry', 'stop_loss', 'symbol'],
        properties: {
          account_balance: { type: 'number', example: 10000 },
          risk_percent: { type: 'number', example: 1.5 },
          entry: { type: 'number', example: 1.2345 },
          stop_loss: { type: 'number', example: 1.2305 },
          take_profit: { type: 'number', nullable: true, example: 1.245 },
          symbol: { type: 'string', example: 'EURUSD' },
        },
      },
      RiskResult: {
        type: 'object',
        properties: {
          lot_size: { type: 'number', example: 1.2 },
          monetary_risk: { type: 'number', example: 150 },
          risk_reward_ratio: { type: 'number', nullable: true, example: 2.5 },
          pip_risk: { type: 'number', example: 0.004 },
          monetary_gain: { type: 'number', nullable: true, example: 375 },
          new_balance_sl: { type: 'number', example: 9850 },
          new_balance_tp: { type: 'number', nullable: true, example: 10375 },
        },
      },
      RiskEvaluationRequest: {
        type: 'object',
        required: ['userContext', 'accountState', 'tradeIntent', 'marketSnapshot'],
        properties: {
          userContext: {
            type: 'object',
            required: ['userId', 'riskProfile', 'experienceLevel', 'typicalRiskPerTradePct', 'typicalPositionSizeUsd'],
            properties: {
              userId: { type: 'string' },
              riskProfile: { type: 'string', enum: ['conservative', 'moderate', 'aggressive'] },
              experienceLevel: { type: 'string', enum: ['novice', 'intermediate', 'advanced'] },
              typicalRiskPerTradePct: { type: 'number', minimum: 0 },
              typicalPositionSizeUsd: { type: 'number', minimum: 0 },
            },
          },
          accountState: {
            type: 'object',
            required: ['accountId', 'equityUsd', 'availableMarginUsd', 'openRiskUsd', 'openPositions'],
            properties: {
              accountId: { type: 'string' },
              equityUsd: { type: 'number', minimum: 0 },
              availableMarginUsd: { type: 'number' },
              openRiskUsd: { type: 'number', minimum: 0 },
              openPositions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { symbol: { type: 'string' }, riskUsd: { type: 'number', minimum: 0 } },
                },
              },
            },
          },
          tradeIntent: {
            type: 'object',
            required: ['symbol', 'side', 'entryPrice', 'stopPrice', 'quantity', 'timeframe', 'orderType'],
            properties: {
              symbol: { type: 'string' },
              side: { type: 'string', enum: ['long', 'short'] },
              entryPrice: { type: 'number' },
              stopPrice: { type: 'number' },
              targetPrice: { type: 'number', nullable: true },
              quantity: { type: 'number' },
              leverage: { type: 'number', nullable: true },
              timeframe: { type: 'string', enum: ['scalp', 'intraday', 'swing', 'position'] },
              orderType: { type: 'string', enum: ['market', 'limit'] },
            },
          },
          marketSnapshot: {
            type: 'object',
            required: ['symbol', 'currentPrice'],
            properties: {
              symbol: { type: 'string' },
              currentPrice: { type: 'number' },
              atr: { type: 'number', nullable: true },
              tickSize: { type: 'number', nullable: true },
              minNotional: { type: 'number', nullable: true },
              maxLeverageAllowed: { type: 'number', nullable: true },
              sessionVolatilityPct: { type: 'number', nullable: true },
            },
          },
        },
      },
      JournalCoachingRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          coachingIntent: {
            type: 'string',
            enum: ['overview', 'recent_performance', 'pattern_detection', 'risk_discipline', 'emotional_control'],
          },
        },
      },
      JournalEntryInput: {
        type: 'object',
        required: ['symbol', 'direction', 'entry_price'],
        properties: {
          symbol: { type: 'string', example: 'BTCUSD' },
          direction: { type: 'string', enum: ['LONG', 'SHORT'] },
          entry_price: { type: 'number', example: 42000 },
          exit_price: { type: 'number', nullable: true, example: 43000 },
          notes: { type: 'string', nullable: true },
        },
      },
      JournalEntry: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string' },
          symbol: { type: 'string' },
          direction: { type: 'string', enum: ['LONG', 'SHORT'] },
          entryPrice: { type: 'number' },
          exitPrice: { type: 'number', nullable: true },
          notes: { type: 'string', nullable: true },
          aiFeedback: { type: 'object', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      JournalAnalysisInput: {
        allOf: [{ $ref: '#/components/schemas/JournalEntryInput' }],
      },
      JournalAnalysis: {
        type: 'object',
        properties: {
          score: { type: 'integer', example: 8 },
          strengths: { type: 'array', items: { type: 'string' } },
          mistakes: { type: 'array', items: { type: 'string' } },
          tip: { type: 'string' },
        },
      },
      SentimentSnapshot: {
        type: 'object',
        properties: {
          score: { type: 'number', example: 62 },
          trend: { type: 'string', example: 'bullish' },
          top_drivers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                impact: { type: 'number', example: 0.33 },
              },
            },
          },
        },
      },
      BillingInitiateRequest: {
        type: 'object',
        required: ['amountKobo', 'email'],
        properties: {
          amountKobo: { type: 'integer', example: 500000 },
          email: { type: 'string', format: 'email' },
          isSubscription: { type: 'boolean', default: false },
        },
      },
      BillingInitiateResponse: {
        type: 'object',
        properties: {
          authorization_url: { type: 'string', format: 'uri' },
          reference: { type: 'string' },
        },
      },
      BillingVerifyResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'success' },
        },
      },
      PaystackWebhookEvent: {
        type: 'object',
        description: 'Full Paystack event payload (see Paystack docs).',
        properties: {
          event: { type: 'string', example: 'charge.success' },
          data: { type: 'object' },
        },
      },
      MetaApiAccount: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 12 },
          userId: { type: 'string' },
          metaapiAccountId: { type: 'string' },
          name: { type: 'string', nullable: true },
          platform: { type: 'string', nullable: true, enum: ['mt4', 'mt5'] },
          region: { type: 'string', nullable: true },
          state: { type: 'string', nullable: true, description: 'MetaAPI deployment state: DEPLOYED, UNDEPLOYED, etc.' },
          connectionStatus: { type: 'string', nullable: true, description: 'CONNECTED, DISCONNECTED, DISCONNECTED_FROM_BROKER' },
          login: { type: 'string', nullable: true },
          server: { type: 'string', nullable: true },
          accountType: { type: 'string', nullable: true, description: 'e.g. cloud-g2' },
          isActive: { type: 'boolean' },
          connectedAt: { type: 'string', format: 'date-time', nullable: true },
          lastSyncedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MetaApiAccountSummary: {
        type: 'object',
        properties: {
          accountInfo: {
            type: 'object',
            properties: {
              balance: { type: 'number' },
              equity: { type: 'number' },
              margin: { type: 'number', nullable: true },
              freeMargin: { type: 'number', nullable: true },
              currency: { type: 'string' },
            },
          },
          positions: {
            type: 'array',
            items: { $ref: '#/components/schemas/MetaPosition' },
          },
        },
      },
      MetaPosition: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          symbol: { type: 'string' },
          type: { type: 'string', example: 'POSITION_TYPE_BUY' },
          volume: { type: 'number' },
          openPrice: { type: 'number' },
          profit: { type: 'number' },
          comment: { type: 'string', nullable: true },
        },
      },
      MetaHistoryOrder: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          symbol: { type: 'string' },
          type: { type: 'string' },
          lots: { type: 'number' },
          openTime: { type: 'string', format: 'date-time' },
          closeTime: { type: 'string', format: 'date-time' },
          profit: { type: 'number' },
        },
      },
      AccountBalance: {
        type: 'object',
        properties: {
          balance: { type: 'number' },
          equity: { type: 'number' },
          currency: { type: 'string', example: 'USD' },
        },
      },
      EnsureUserRequest: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Clerk user ID' },
          email: { type: 'string', format: 'email', nullable: true },
        },
      },
      ClerkWebhookEvent: {
        type: 'object',
        properties: {
          type: { type: 'string', example: 'user.created' },
          data: { type: 'object' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
        },
      },
      MetricsResponse: {
        type: 'object',
        properties: {
          users: { type: 'string', example: 'TODO' },
          metrics: { type: 'object' },
        },
      },
    },
  },
  paths: {
    '/chat': {
      post: {
        tags: ['Chat'],
        summary: 'Send a message to the AI assistant',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ChatRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Assistant response',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ChatResponse' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          402: {
            description: 'Free plan limit reached',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/LimitError' } },
            },
          },
          422: {
            description: 'Validation error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/risk/calculate': {
      post: {
        tags: ['Risk'],
        summary: 'Calculate lot size and risk metrics',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RiskRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Risk calculation result',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/RiskResult' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          422: {
            description: 'Invalid calculation inputs',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/risk/evaluate': {
      post: {
        tags: ['Risk'],
        summary: 'Evaluate trade risk (orchestration)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RiskEvaluationRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Risk evaluation result',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/RiskResult' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          422: {
            description: 'Validation error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/journal/entries': {
      post: {
        tags: ['Journal'],
        summary: 'Create a manual journal entry',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/JournalEntryInput' } },
          },
        },
        responses: {
          201: {
            description: 'Entry created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/JournalEntry' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/journal/analyze': {
      post: {
        tags: ['Journal'],
        summary: 'Request AI feedback for a trade idea',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/JournalAnalysisInput' } },
          },
        },
        responses: {
          200: {
            description: 'AI analysis payload',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/JournalAnalysis' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          402: {
            description: 'Free plan limit reached',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/LimitError' } },
            },
          },
        },
      },
    },
    '/journal/analysis/{userId}': {
      get: {
        tags: ['Journal'],
        summary: 'Get journal analysis for a user',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string' }, description: 'Clerk user ID' },
        ],
        responses: {
          200: {
            description: 'Journal analysis data',
            content: {
              'application/json': { schema: { type: 'object', description: 'Analysis payload' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/journal/coaching': {
      post: {
        tags: ['Journal'],
        summary: 'Request AI coaching based on journal/trades',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/JournalCoachingRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Coaching response',
            content: {
              'application/json': { schema: { type: 'object', description: 'AI coaching message and insights' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          402: {
            description: 'Free plan limit reached',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/LimitError' } },
            },
          },
        },
      },
    },
    '/sentiment': {
      get: {
        tags: ['Sentiment'],
        summary: 'Get aggregated sentiment for a symbol',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'query',
            name: 'symbol',
            schema: { type: 'string', example: 'BTC' },
            required: false,
            description: 'Defaults to BTC when omitted.',
          },
        ],
        responses: {
          200: {
            description: 'Sentiment snapshot',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SentimentSnapshot' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/sentiment/snapshot/{symbol}': {
      get: {
        tags: ['Sentiment'],
        summary: 'Get sentiment snapshot for a specific symbol',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'symbol', required: true, schema: { type: 'string', example: 'BTC' } },
        ],
        responses: {
          200: {
            description: 'Sentiment snapshot for symbol',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SentimentSnapshot' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/billing/initiate': {
      post: {
        tags: ['Billing'],
        summary: 'Initialize a Paystack payment',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/BillingInitiateRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Authorization URL issued',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BillingInitiateResponse' },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/billing/verify': {
      get: {
        tags: ['Billing'],
        summary: 'Verify a Paystack payment after redirect',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'query',
            name: 'reference',
            schema: { type: 'string' },
            required: true,
            description: 'Paystack transaction reference.',
          },
        ],
        responses: {
          200: {
            description: 'Verification result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BillingVerifyResponse' },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Reference does not exist',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/billing/webhook/paystack': {
      post: {
        tags: ['Billing'],
        summary: 'Paystack webhook receiver',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PaystackWebhookEvent' } },
          },
        },
        responses: {
          200: {
            description: 'Event processed',
          },
        },
      },
    },
    '/accounts/provision': {
      post: {
        tags: ['Accounts'],
        summary: 'Provision a new MetaAPI account and link it to the current user',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['login', 'password', 'name', 'server', 'platform', 'magic'],
                properties: {
                  login: { type: 'string', description: 'Trading account number (digits only)' },
                  password: { type: 'string', description: 'MT account password (not stored)' },
                  name: { type: 'string', description: 'Human-readable account name' },
                  server: { type: 'string', description: 'Trading server name' },
                  platform: { type: 'string', enum: ['mt4', 'mt5'] },
                  magic: { type: 'number', description: 'Magic value (0 if manual trades)' },
                  region: { type: 'string', nullable: true },
                  type: { type: 'string', enum: ['cloud-g1', 'cloud-g2'], nullable: true },
                  provisioning_profile_id: { type: 'string', nullable: true },
                  transaction_id: { type: 'string', nullable: true, description: 'For retry after 202' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Account provisioned and linked',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MetaApiAccount' } },
            },
          },
          202: {
            description: 'Creation in progress; retry with same body + transaction_id',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    transaction_id: { type: 'string' },
                    retry_after_seconds: { type: 'number' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error (missing/invalid fields)',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/accounts': {
      post: {
        tags: ['Accounts'],
        summary: 'Link an existing MetaAPI account to the current user',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  metaapi_account_id: { type: 'string', description: 'Required, or provide account._id' },
                  name: { type: 'string', nullable: true },
                  platform: { type: 'string', enum: ['mt4', 'mt5'], nullable: true },
                  region: { type: 'string', nullable: true },
                  account: {
                    type: 'object',
                    description: 'Optional JSON from MetaAPI dashboard (state, connectionStatus, region, name, login, server, type)',
                    properties: {
                      _id: { type: 'string' },
                      state: { type: 'string' },
                      connectionStatus: { type: 'string' },
                      region: { type: 'string' },
                      name: { type: 'string' },
                      login: { type: 'string' },
                      server: { type: 'string' },
                      type: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Account linked',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MetaApiAccount' } },
            },
          },
          400: {
            description: 'Missing metaapi_account_id',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
      get: {
        tags: ['Accounts'],
        summary: 'List linked MetaAPI accounts',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Array of accounts',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/MetaApiAccount' },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/accounts/{id}/sync-state': {
      post: {
        tags: ['Accounts'],
        summary: 'Sync account state from MetaAPI to DB (state, connectionStatus, region, etc.)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Updated account',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MetaApiAccount' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Account not found in MetaAPI or DB',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/accounts/{id}': {
      delete: {
        tags: ['Accounts'],
        summary: 'Unlink a MetaAPI account by MetaAPI account id',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', description: 'MetaAPI account id (metaapiAccountId), not internal DB id' },
          },
        ],
        responses: {
          204: { description: 'Account removed' },
          400: {
            description: 'MetaAPI account id required',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Account not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/accounts/{id}/summary': {
      get: {
        tags: ['Accounts'],
        summary: 'Get account info and open positions',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Summary payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MetaApiAccountSummary' },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Account not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/accounts/{id}/balance': {
      get: {
        tags: ['Accounts'],
        summary: 'Get latest balance snapshot',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Balance snapshot',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AccountBalance' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Account not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/accounts/{id}/positions': {
      get: {
        tags: ['Accounts'],
        summary: 'List open positions',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Open positions',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/MetaPosition' } },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Account not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/accounts/{id}/history': {
      get: {
        tags: ['Accounts'],
        summary: 'Get historical orders for an account',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'integer' } },
          {
            in: 'query',
            name: 'from',
            schema: { type: 'string', format: 'date-time' },
            required: false,
          },
          {
            in: 'query',
            name: 'to',
            schema: { type: 'string', format: 'date-time' },
            required: false,
          },
        ],
        responses: {
          200: {
            description: 'Historical orders',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/MetaHistoryOrder' } },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Account not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/admin/health': {
      get: {
        tags: ['Admin'],
        summary: 'Health probe',
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } },
            },
          },
        },
      },
    },
    '/admin/metrics': {
      get: {
        tags: ['Admin'],
        summary: 'Aggregate metrics for admins',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Metrics payload',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MetricsResponse' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/auth/info': {
      get: {
        tags: ['Auth'],
        summary: 'Get current authenticated user info',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user info (e.g. userId, email from token)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    userId: { type: 'string' },
                    email: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/charts/upload': {
      post: {
        tags: ['Charts'],
        summary: 'Upload a chart image for analysis',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'Chart image file' },
                  symbol_hint: { type: 'string', nullable: true },
                  timeframe_hint: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Chart uploaded; returns storage key and metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    storage_key: { type: 'string' },
                    original_filename: { type: 'string' },
                    symbol_hint: { type: 'string', nullable: true },
                    timeframe_hint: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/profiles/{userId}': {
      get: {
        tags: ['Profiles'],
        summary: 'Get user profile and trading metrics',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string' }, description: 'Clerk user ID' },
        ],
        responses: {
          200: {
            description: 'Profile and metrics (typical risk %, position size, avg RR, etc.)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    userId: { type: 'string' },
                    typicalRiskPerTradePct: { type: 'number' },
                    typicalPositionSizeUsd: { type: 'number' },
                    avgRrRatio: { type: 'number', nullable: true },
                    maxDrawdownPct: { type: 'number', nullable: true },
                    lastComputedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          404: {
            description: 'Profile not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/profiles/recompute/{userId}': {
      post: {
        tags: ['Profiles'],
        summary: 'Recompute profile metrics for a user',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string' }, description: 'Clerk user ID' },
        ],
        responses: {
          200: {
            description: 'Metrics recomputed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'Updated profile metrics',
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/users/ensure': {
      post: {
        tags: ['Users'],
        summary: 'Fallback user provisioning',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/EnsureUserRequest' } },
          },
        },
        responses: {
          204: { description: 'User ensured' },
          400: {
            description: 'Missing id',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          401: {
            description: 'Caller mismatch',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/webhooks/clerk': {
      post: {
        tags: ['Webhooks'],
        summary: 'Clerk webhook for provisioning users',
        parameters: [
          { in: 'header', name: 'svix-id', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'svix-timestamp', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'svix-signature', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ClerkWebhookEvent' } },
          },
        },
        responses: {
          204: { description: 'Event accepted' },
          400: {
            description: 'Signature verification failed or malformed payload',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
  },
};

export const swaggerSpec = swaggerJsdoc({
  definition: swaggerDefinition,
  apis: [],
});
