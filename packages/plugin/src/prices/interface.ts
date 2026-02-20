export type AssetType = 'stock' | 'etf' | 'crypto' | 'bond' | 'other';

export interface PriceResult {
  symbol: string;
  price: number;
  currency: 'USD';
  asOf: Date;
  source: string;
}

export interface PriceProvider {
  readonly name: string;
  readonly supportedAssetTypes: AssetType[];
  getPrice(symbol: string, assetType: AssetType): Promise<PriceResult>;
}
