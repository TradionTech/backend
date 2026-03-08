import { JournalService } from '../journalService';
import { MetaApiAccount } from '../../../db/models/MetaApiAccount';
import { JournalEntry } from '../../../db/models/JournalEntry';
import { getUserProfileMetrics } from '../../profile/profileService';
import * as metaapi from '../../brokers/metaapi';

jest.mock('../../../db/models/MetaApiAccount');
jest.mock('../../../db/models/JournalEntry');
jest.mock('../../profile/profileService');
jest.mock('../../brokers/metaapi', () => ({
  getHistoryDealsByTimeRange: jest.fn(),
  getOpenPositions: jest.fn(),
}));

describe('JournalService', () => {
  let journalService: JournalService;

  beforeEach(() => {
    journalService = new JournalService();
    jest.clearAllMocks();
    (metaapi.getOpenPositions as jest.Mock).mockResolvedValue([]);
  });

  describe('buildJournalContext', () => {
    it('should build context with no accounts', async () => {
      (MetaApiAccount.findAll as jest.Mock).mockResolvedValue([]);

      const context = await journalService.buildJournalContext({
        userId: 'test-user',
      });

      expect(context.userId).toBe('test-user');
      expect(context.window.tradeCount).toBe(0);
      expect(context.dataQuality.enoughTrades).toBe(false);
      expect(context.dataQuality.missingFields).toContain('no_trades');
      expect(context.dataQuality.missingFields).toContain('no_accounts');
    });

    it('should build context with trades from MetaAPI', async () => {
      (MetaApiAccount.findAll as jest.Mock).mockResolvedValue([
        { id: 1, metaapiAccountId: 'meta-account-1' },
      ]);
      (metaapi.getHistoryDealsByTimeRange as jest.Mock).mockResolvedValue([
        {
          id: 'deal-in',
          type: 'DEAL_TYPE_BUY',
          entryType: 'DEAL_ENTRY_IN',
          symbol: 'EURUSD',
          volume: 1,
          price: 1.1,
          profit: 0,
          time: '2024-01-01T10:00:00.000Z',
          brokerTime: '2024-01-01 10:00:00',
          platform: 'mt5',
          positionId: 'pos-1',
          stopLoss: 1.05,
        },
        {
          id: 'deal-out',
          type: 'DEAL_TYPE_SELL',
          entryType: 'DEAL_ENTRY_OUT',
          symbol: 'EURUSD',
          volume: 1,
          price: 1.15,
          profit: 50,
          commission: 0,
          swap: 0,
          time: '2024-01-02T10:00:00.000Z',
          brokerTime: '2024-01-02 10:00:00',
          platform: 'mt5',
          positionId: 'pos-1',
        },
      ]);
      (getUserProfileMetrics as jest.Mock).mockResolvedValue(null);
      (JournalEntry.findAll as jest.Mock).mockResolvedValue([]);

      const context = await journalService.buildJournalContext({
        userId: 'test-user',
      });

      expect(context.userId).toBe('test-user');
      expect(context.window.tradeCount).toBeGreaterThan(0);
    });
  });
});
