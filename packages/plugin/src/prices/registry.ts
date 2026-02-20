import type { AssetType, PriceProvider, PriceResult } from './interface.js';
import { YahooFinanceProvider } from './yahoo.js';
import { CoinGeckoProvider } from './coingecko.js';
import { ManualProvider } from './manual.js';

/**
 * Default fallback chain per asset type:
 *   stock/etf  → yahoo → manual
 *   crypto     → coingecko → manual
 *   bond/other → manual
 */
const FALLBACK_CHAINS: Record<AssetType, string[]> = {
  stock: ['yahoo', 'manual'],
  etf:   ['yahoo', 'manual'],
  crypto: ['coingecko', 'manual'],
  bond:  ['manual'],
  other: ['manual'],
};

export class PriceRegistry {
  private providers: Map<string, PriceProvider> = new Map();

  constructor() {
    this.register(new YahooFinanceProvider());
    this.register(new CoinGeckoProvider());
    // ManualProvider is created per-call with the current stored price
  }

  register(provider: PriceProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Fetch a price using the fallback chain for the given asset type.
   * Returns the first successful result.
   */
  async getPrice(
    symbol: string,
    assetType: AssetType,
    storedPrice?: number
  ): Promise<PriceResult> {
    const chain = FALLBACK_CHAINS[assetType] ?? ['manual'];
    const errors: string[] = [];

    for (const providerName of chain) {
      try {
        if (providerName === 'manual') {
          const manual = new ManualProvider(storedPrice);
          return await manual.getPrice(symbol, assetType);
        }

        const provider = this.providers.get(providerName);
        if (!provider) continue;

        return await provider.getPrice(symbol, assetType);
      } catch (err) {
        errors.push(`${providerName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // All providers failed — fall back to manual with stored price
    const manual = new ManualProvider(storedPrice);
    return manual.getPrice(symbol, assetType);
  }
}

// Singleton registry
export const priceRegistry = new PriceRegistry();
