import type { PriceProvider, PriceResult, AssetType } from './interface.js';

/**
 * ManualProvider — always available, falls back to whatever price is already
 * stored in the DB (passed in as currentPrice) or 0 if none.
 *
 * The portfolio refresh flow passes the stored price into getPrice so the
 * "manual" provider simply returns it unchanged, preserving user-set prices.
 */
export class ManualProvider implements PriceProvider {
  readonly name = 'manual';
  readonly supportedAssetTypes: AssetType[] = ['stock', 'etf', 'crypto', 'bond', 'other'];

  private currentPrice?: number;

  constructor(currentPrice?: number) {
    this.currentPrice = currentPrice;
  }

  async getPrice(symbol: string, _assetType: AssetType): Promise<PriceResult> {
    return {
      symbol,
      price: this.currentPrice ?? 0,
      currency: 'USD',
      asOf: new Date(),
      source: 'manual',
    };
  }
}
