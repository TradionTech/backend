import { JournalService } from '../journalService.js';
import { TradeHistory } from '../../../db/models/TradeHistory.js';
import { MetaApiAccount } from '../../../db/models/MetaApiAccount.js';
import { TradingPosition } from '../../../db/models/TradingPosition.js';
import { JournalEntry } from '../../../db/models/JournalEntry.js';
import { getUserProfileMetrics } from '../../profile/profileService.js';

// Mock dependencies
jest.mock('../../../db/models/TradeHistory');
jest.mock('../../../db/models/MetaApiAccount');
jest.mock('../../../db/models/TradingPosition');
jest.mock('../../../db/models/JournalEntry');
jest.mock('../../profile/profileService');

describe('JournalService', () => {
  let journalService: JournalService;

  beforeEach(() => {
    journalService = new JournalService();
    jest.clearAllMocks();
  });

  describe('buildJournalContext', () => {
    it('should build context with no accounts', async () => {
      (MetaApiAccount.findAll as jest.Mock).resolves([]);

      const context = await journalService.buildJournalContext({
        userId: 'test-user',
      });

      expect(context.userId).toBe('test-user');
      expect(context.window.tradeCount).toBe(0);
      expect(context.dataQuality.enoughTrades).toBe(false);
      expect(context.dataQuality.missingFields).toContain('no_trades');
      expect(context.dataQuality.missingFields).toContain('no_accounts');
    });

    it('should build context with trades', async () => {
      const mockAccount = { id: 1, userId: 'test-user' };
      (MetaApiAccount.findAll as jest.Mock).resolves([mockAccount]);

      const mockTrade = {
        id: 1,
        accountId: 1,
        symbol: 'EURUSD',
        type: 'DEAL_TYPE_BUY',
        dealType: 'DEAL_TYPE_BUY',
        volume: 1,
        price: 1.1,
        stopLoss: 1.05,
        takeProfit: 1.2,
        timeOpen: new Date('2024-01-01'),
        timeClose: new Date('2024-01-02'),
        profit: 100,
        commission: 0,
        swap: 0,
        comment: null,
        brokerComment: null,
        entryType: null,
      };

      (TradeHistory.findAll as jest.Mock).resolves([mockTrade]);
      (getUserProfileMetrics as jest.Mock).resolves(null);
      (JournalEntry.findAll as jest.Mock).resolves([]);
      (TradingPosition.count as jest.Mock).resolves(0);

      const context = await journalService.buildJournalContext({
        userId: 'test-user',
      });

      expect(context.userId).toBe('test-user');
      expect(context.window.tradeCount).toBeGreaterThan(0);
    });
  });
});
