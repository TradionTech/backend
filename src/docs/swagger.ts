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
        required: ['session_id', 'message'],
        properties: {
          session_id: { type: 'string', format: 'uuid' },
          message: { type: 'string', maxLength: 500 },
          message_type: { type: 'string', enum: ['text'], default: 'text' },
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
          state: { type: 'string', nullable: true },
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
    '/accounts': {
      post: {
        tags: ['Accounts'],
        summary: 'Link a MetaAPI account to the current user',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['metaapi_account_id'],
                properties: {
                  metaapi_account_id: { type: 'string' },
                  name: { type: 'string', nullable: true },
                  platform: { type: 'string', enum: ['mt4', 'mt5'], nullable: true },
                  region: { type: 'string', nullable: true },
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
    '/accounts/{id}': {
      delete: {
        tags: ['Accounts'],
        summary: 'Unlink a MetaAPI account',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'integer' },
          },
        ],
        responses: {
          204: { description: 'Account removed' },
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
