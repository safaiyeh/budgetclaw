import type { PriceProvider, PriceResult, AssetType } from './interface.js';

/**
 * YahooFinanceProvider — uses yahoo-finance2 (no API key required).
 * Supports stocks and ETFs.
 */
export class YahooFinanceProvider implements PriceProvider {
  readonly name = 'yahoo';
  readonly supportedAssetTypes: AssetType[] = ['stock', 'etf'];

  async getPrice(symbol: string, _assetType: AssetType): Promise<PriceResult> {
    // Dynamic import to avoid loading at startup
    const yahooFinance = await import('yahoo-finance2');
    const yf = yahooFinance.default ?? yahooFinance;

    const quote = await (yf as { quote: (sym: string) => Promise<{ regularMarketPrice?: number; currency?: string }> }).quote(symbol);

    if (!quote || quote.regularMarketPrice == null) {
      throw new Error(`No price found for symbol "${symbol}" via Yahoo Finance`);
    }

    return {
      symbol,
      price: quote.regularMarketPrice,
      currency: 'USD',
      asOf: new Date(),
      source: 'yahoo',
    };
  }
}
