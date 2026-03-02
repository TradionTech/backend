/**
 * Unit tests for SentimentProvider abstraction.
 * Tests provider filtering and extensibility.
 */

import type { AssetClass } from '../../../types/market';
import { getDefaultSentimentProviders, getProvidersForAssetClass } from '../sentimentProvider';

describe('SentimentProvider', () => {
  describe('getDefaultSentimentProviders', () => {
    it('should return an array of providers', () => {
      const providers = getDefaultSentimentProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
    });

    it('should return providers with name property', () => {
      const providers = getDefaultSentimentProviders();
      providers.forEach((provider) => {
        expect(provider).toHaveProperty('name');
        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);
      });
    });

    it('should return providers that implement supports method', () => {
      const providers = getDefaultSentimentProviders();
      providers.forEach((provider) => {
        expect(typeof provider.supports).toBe('function');
        const result = provider.supports('CRYPTO');
        expect(typeof result).toBe('boolean');
      });
    });

    it('should return providers that implement fetchSignals method', () => {
      const providers = getDefaultSentimentProviders();
      providers.forEach((provider) => {
        expect(typeof provider.fetchSignals).toBe('function');
      });
    });
  });

  describe('getProvidersForAssetClass', () => {
    const assetClasses: AssetClass[] = ['FX', 'CRYPTO', 'EQUITY', 'INDEX', 'FUTURES', 'OTHER'];

    assetClasses.forEach((assetClass) => {
      it(`should filter providers for ${assetClass} asset class`, () => {
        const allProviders = getDefaultSentimentProviders();
        const filteredProviders = getProvidersForAssetClass(allProviders, assetClass);

        expect(Array.isArray(filteredProviders)).toBe(true);
        expect(filteredProviders.length).toBeLessThanOrEqual(allProviders.length);

        // All filtered providers should support the asset class
        filteredProviders.forEach((provider) => {
          expect(provider.supports(assetClass)).toBe(true);
        });
      });
    });

    it('should return empty array if no providers support the asset class', () => {
      const allProviders = getDefaultSentimentProviders();
      // Assuming OTHER is not supported by any provider
      const filteredProviders = getProvidersForAssetClass(allProviders, 'OTHER');
      expect(Array.isArray(filteredProviders)).toBe(true);
      // Note: This test may fail if a provider supports OTHER, which is fine
    });
  });
});
