import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CoinbaseDataProvider } from './index.js';

// ─── Mock fetch ──────────────────────────────────────────────────────────────

function mockCoinbaseAccounts(accounts: object[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      pagination: { next_uri: null },
      data: accounts,
    }),
    text: async () => '',
  };
}

function mockCoinbaseTransactions(transactions: object[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      pagination: { next_uri: null },
      data: transactions,
    }),
    text: async () => '',
  };
}

function mockError(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ errors: [{ message }] }),
    text: async () => JSON.stringify({ errors: [{ message }] }),
  };
}

const BTC_ACCOUNT = {
  id: 'acct-btc',
  name: 'BTC Wallet',
  type: 'wallet',
  currency: { code: 'BTC', name: 'Bitcoin', type: 'crypto' },
  balance: { amount: '1.5', currency: 'BTC' },
  native_balance: { amount: '75000.00', currency: 'USD' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

const ETH_ACCOUNT = {
  id: 'acct-eth',
  name: 'ETH Wallet',
  type: 'wallet',
  currency: { code: 'ETH', name: 'Ethereum', type: 'crypto' },
  balance: { amount: '10.0', currency: 'ETH' },
  native_balance: { amount: '25000.00', currency: 'USD' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

const ZERO_BALANCE_CRYPTO = {
  id: 'acct-doge',
  name: 'DOGE Wallet',
  type: 'wallet',
  currency: { code: 'DOGE', name: 'Dogecoin', type: 'crypto' },
  balance: { amount: '0.00000000', currency: 'DOGE' },
  native_balance: { amount: '0.00', currency: 'USD' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

const USD_ACCOUNT = {
  id: 'acct-usd',
  name: 'USD Wallet',
  type: 'fiat',
  currency: { code: 'USD', name: 'US Dollar', type: 'fiat' },
  balance: { amount: '500.00', currency: 'USD' },
  native_balance: { amount: '500.00', currency: 'USD' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

const ZERO_FIAT_ACCOUNT = {
  id: 'acct-eur',
  name: 'EUR Wallet',
  type: 'fiat',
  currency: { code: 'EUR', name: 'Euro', type: 'fiat' },
  balance: { amount: '0.00', currency: 'EUR' },
  native_balance: { amount: '0.00', currency: 'USD' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

const ALL_ACCOUNTS = [BTC_ACCOUNT, ETH_ACCOUNT, ZERO_BALANCE_CRYPTO, USD_ACCOUNT, ZERO_FIAT_ACCOUNT];

const CREDENTIAL = JSON.stringify({ apiKey: 'test-key', apiSecret: 'test-secret' });

function createProvider(): CoinbaseDataProvider {
  return new CoinbaseDataProvider(CREDENTIAL);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CoinbaseDataProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAccounts()', () => {
    it('aggregates crypto wallets into one account and creates fiat accounts', async () => {
      fetchSpy.mockResolvedValue(mockCoinbaseAccounts(ALL_ACCOUNTS) as Response);

      const provider = createProvider();
      const accounts = await provider.getAccounts();

      // One aggregated crypto + one USD fiat (zero-balance EUR is skipped)
      expect(accounts).toHaveLength(2);

      const crypto = accounts.find((a) => a.type === 'crypto');
      expect(crypto).toBeDefined();
      expect(crypto!.external_id).toBe('coinbase-crypto-aggregate');
      expect(crypto!.name).toBe('Coinbase Crypto');
      expect(crypto!.balance).toBe(100000.00); // 75000 + 25000
      expect(crypto!.institution).toBe('Coinbase');

      const fiat = accounts.find((a) => a.type === 'checking');
      expect(fiat).toBeDefined();
      expect(fiat!.external_id).toBe('acct-usd');
      expect(fiat!.name).toBe('Coinbase USD Wallet');
      expect(fiat!.balance).toBe(500);
    });

    it('skips zero-balance fiat accounts', async () => {
      fetchSpy.mockResolvedValue(mockCoinbaseAccounts([ZERO_FIAT_ACCOUNT]) as Response);

      const provider = createProvider();
      const accounts = await provider.getAccounts();
      expect(accounts).toHaveLength(0);
    });

    it('includes crypto account even if all balances are zero-native-value', async () => {
      fetchSpy.mockResolvedValue(mockCoinbaseAccounts([ZERO_BALANCE_CRYPTO]) as Response);

      const provider = createProvider();
      const accounts = await provider.getAccounts();
      // Still creates the aggregate account because a crypto wallet exists
      expect(accounts).toHaveLength(1);
      expect(accounts[0]!.balance).toBe(0);
    });
  });

  describe('getHoldings()', () => {
    it('maps non-zero crypto wallets to holdings', async () => {
      fetchSpy.mockResolvedValue(mockCoinbaseAccounts(ALL_ACCOUNTS) as Response);

      const provider = createProvider();
      const holdings = await provider.getHoldings();

      // BTC + ETH (DOGE has zero balance, skipped)
      expect(holdings).toHaveLength(2);

      const btc = holdings.find((h) => h.symbol === 'BTC');
      expect(btc).toBeDefined();
      expect(btc!.quantity).toBe(1.5);
      expect(btc!.price).toBe(50000); // 75000 / 1.5
      expect(btc!.value).toBe(75000);
      expect(btc!.asset_type).toBe('crypto');
      expect(btc!.account_external_id).toBe('coinbase-crypto-aggregate');

      const eth = holdings.find((h) => h.symbol === 'ETH');
      expect(eth).toBeDefined();
      expect(eth!.quantity).toBe(10);
      expect(eth!.price).toBe(2500); // 25000 / 10
      expect(eth!.value).toBe(25000);
    });

    it('skips zero-balance crypto wallets', async () => {
      fetchSpy.mockResolvedValue(mockCoinbaseAccounts([ZERO_BALANCE_CRYPTO]) as Response);

      const provider = createProvider();
      const holdings = await provider.getHoldings();
      expect(holdings).toHaveLength(0);
    });
  });

  describe('getTransactions()', () => {
    it('fetches and maps transactions from all wallets', async () => {
      const txns = [
        {
          id: 'tx-1',
          type: 'buy',
          status: 'completed',
          amount: { amount: '0.5', currency: 'BTC' },
          native_amount: { amount: '-25000.00', currency: 'USD' },
          description: null,
          created_at: '2026-02-01T12:00:00Z',
          updated_at: '2026-02-01T12:00:00Z',
          details: { title: 'Bought Bitcoin', subtitle: 'Using USD Wallet' },
        },
        {
          id: 'tx-2',
          type: 'sell',
          status: 'completed',
          amount: { amount: '-0.1', currency: 'BTC' },
          native_amount: { amount: '5000.00', currency: 'USD' },
          description: null,
          created_at: '2026-02-15T12:00:00Z',
          updated_at: '2026-02-15T12:00:00Z',
          details: { title: 'Sold Bitcoin' },
        },
      ];

      let callCount = 0;
      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/accounts?') || (url.includes('/accounts') && !url.includes('/transactions'))) {
          return mockCoinbaseAccounts([BTC_ACCOUNT]) as Response;
        }
        callCount++;
        return mockCoinbaseTransactions(txns) as Response;
      });

      const provider = createProvider();
      const result = await provider.getTransactions();

      expect(result.added).toHaveLength(2);
      expect(result.modified).toHaveLength(0);
      expect(result.removed).toHaveLength(0);

      // Buy transaction: negative native_amount
      expect(result.added[0]!.amount).toBe(-25000);
      expect(result.added[0]!.date).toBe('2026-02-01');
      expect(result.added[0]!.description).toBe('Bought Bitcoin');
      expect(result.added[0]!.account_external_id).toBe('coinbase-crypto-aggregate');

      // Sell transaction: positive native_amount
      expect(result.added[1]!.amount).toBe(5000);

      // nextCursor should be the latest transaction timestamp
      expect(result.nextCursor).toBe('2026-02-15T12:00:00.000Z');
    });

    it('filters transactions by cursor timestamp', async () => {
      const txns = [
        {
          id: 'tx-old',
          type: 'buy',
          status: 'completed',
          amount: { amount: '1.0', currency: 'BTC' },
          native_amount: { amount: '-50000.00', currency: 'USD' },
          description: null,
          created_at: '2026-01-01T12:00:00Z',
          updated_at: '2026-01-01T12:00:00Z',
          details: { title: 'Old Buy' },
        },
        {
          id: 'tx-new',
          type: 'buy',
          status: 'completed',
          amount: { amount: '0.5', currency: 'BTC' },
          native_amount: { amount: '-25000.00', currency: 'USD' },
          description: null,
          created_at: '2026-02-01T12:00:00Z',
          updated_at: '2026-02-01T12:00:00Z',
          details: { title: 'New Buy' },
        },
      ];

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/transactions')) {
          return mockCoinbaseTransactions(txns) as Response;
        }
        return mockCoinbaseAccounts([BTC_ACCOUNT]) as Response;
      });

      const provider = createProvider();
      const result = await provider.getTransactions('2026-01-15T00:00:00.000Z');

      // Only the new transaction should be included
      expect(result.added).toHaveLength(1);
      expect(result.added[0]!.external_id).toBe('tx-new');
    });

    it('skips non-completed transactions', async () => {
      const txns = [
        {
          id: 'tx-pending',
          type: 'send',
          status: 'pending',
          amount: { amount: '0.1', currency: 'BTC' },
          native_amount: { amount: '-5000.00', currency: 'USD' },
          description: null,
          created_at: '2026-02-01T12:00:00Z',
          updated_at: '2026-02-01T12:00:00Z',
          details: { title: 'Pending Send' },
        },
      ];

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/transactions')) {
          return mockCoinbaseTransactions(txns) as Response;
        }
        return mockCoinbaseAccounts([BTC_ACCOUNT]) as Response;
      });

      const provider = createProvider();
      const result = await provider.getTransactions();
      expect(result.added).toHaveLength(0);
    });
  });

  describe('getBalances()', () => {
    it('returns aggregate crypto balance and individual fiat balances', async () => {
      fetchSpy.mockResolvedValue(mockCoinbaseAccounts(ALL_ACCOUNTS) as Response);

      const provider = createProvider();
      const balances = await provider.getBalances();

      expect(balances).toHaveLength(2); // crypto aggregate + USD fiat

      const cryptoBal = balances.find((b) => b.account_external_id === 'coinbase-crypto-aggregate');
      expect(cryptoBal).toBeDefined();
      expect(cryptoBal!.balance).toBe(100000);

      const fiatBal = balances.find((b) => b.account_external_id === 'acct-usd');
      expect(fiatBal).toBeDefined();
      expect(fiatBal!.balance).toBe(500);
    });
  });

  describe('auth errors', () => {
    it('throws on authentication failure', async () => {
      fetchSpy.mockResolvedValue(mockError(401, 'invalid api key') as Response);

      const provider = createProvider();
      await expect(provider.getAccounts()).rejects.toThrow('invalid api key');
    });
  });
});
