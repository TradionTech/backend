import { resolveModelId, InvalidModelForPlanError } from '../modelResolver';
import { Usage } from '../../../usage/usage';

jest.mock('../../../usage/usage');

const mockedUsage = Usage as jest.Mocked<typeof Usage>;

describe('modelResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveModelId', () => {
    it('should return default model for plan when no model_id requested', async () => {
      mockedUsage.getPlan.mockResolvedValueOnce('free');

      const result = await resolveModelId('user-1');

      expect(result).toBe('groq/compound');
      expect(mockedUsage.getPlan).toHaveBeenCalledWith('user-1');
    });

    it('should return default for pro plan when no model_id requested', async () => {
      mockedUsage.getPlan.mockResolvedValueOnce('pro');

      const result = await resolveModelId('user-2');

      expect(result).toBe('groq/compound');
    });

    it('should return requested model when it is allowed for plan', async () => {
      mockedUsage.getPlan.mockResolvedValueOnce('pro');
      const result = await resolveModelId('user-3', 'groq/compound');
      expect(result).toBe('groq/compound');
    });

    it('should throw InvalidModelForPlanError when requested model not on plan', async () => {
      mockedUsage.getPlan.mockResolvedValue('free');
      await expect(resolveModelId('user-4', 'groq/llama-3.1-70b')).rejects.toThrow(
        InvalidModelForPlanError
      );
      try {
        await resolveModelId('user-4', 'groq/llama-3.1-70b');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidModelForPlanError);
        expect((err as InvalidModelForPlanError).requestedModelId).toBe('groq/llama-3.1-70b');
        expect((err as InvalidModelForPlanError).plan).toBe('free');
      }
    });

    it('should trim and use requested model when allowed', async () => {
      mockedUsage.getPlan.mockResolvedValueOnce('free');
      const result = await resolveModelId('user-5', '  groq/compound  ');
      expect(result).toBe('groq/compound');
    });

    it('should treat null/empty as no preference and return default', async () => {
      mockedUsage.getPlan.mockResolvedValueOnce('pro');
      expect(await resolveModelId('user-6', null)).toBe('groq/compound');
      mockedUsage.getPlan.mockResolvedValueOnce('pro');
      expect(await resolveModelId('user-7', '')).toBe('groq/compound');
    });
  });
});
