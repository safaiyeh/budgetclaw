import type { PriceProvider, PriceResult, AssetType } from './interface.js';

// CoinGecko free tier: no API key, ~10-15 requests/minute
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Common symbol → CoinGecko coin ID mappings
const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  DOT: 'polkadot',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  UNI: 'uniswap',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  SHIB: 'shiba-inu',
  BNB: 'binancecoin',
  USDC: 'usd-coin',
  USDT: 'tether',
};

/**
 * CoinGeckoProvider — uses the free CoinGecko REST API (no key required).
 * Supports crypto assets.
 */
export class CoinGeckoProvider implements PriceProvider {
  readonly name = 'coingecko';
  readonly supportedAssetTypes: AssetType[] = ['crypto'];

  async getPrice(symbol: string, _assetType: AssetType): Promise<PriceResult> {
    const upperSymbol = symbol.toUpperCase();
    const coinId = SYMBOL_TO_ID[upperSymbol] ?? symbol.toLowerCase();

    const url = `${COINGECKO_API}/simple/price?ids=${coinId}&vs_currencies=usd`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Record<string, { usd?: number }>;

    if (!data[coinId]?.usd) {
      throw new Error(
        `No price found for "${symbol}" (CoinGecko ID: "${coinId}"). ` +
        `If this is a less common coin, try setting the price manually.`
      );
    }

    return {
      symbol,
      price: data[coinId].usd!,
      currency: 'USD',
      asOf: new Date(),
      source: 'coingecko',
    };
  }
}
