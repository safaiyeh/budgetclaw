import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FinicityDataProvider, mapFinicityAccountType } from './index.js';
import type { FinicityAccount, FinicityTransaction } from './client.js';

// ─── Mock env vars ───────────────────────────────────────────────────────────

vi.stubEnv('FINICITY_PARTNER_ID', 'test-partner');
vi.stubEnv('FINICITY_PARTNER_SECRET', 'test-secret');
vi.stubEnv('FINICITY_APP_KEY', 'test-app-key');

// ─── Mock fetch ──────────────────────────────────────────────────────────────

function mockAuthResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ token: 'test-token' }),
    text: async () => JSON.stringify({ token: 'test-token' }),
  };
}

function mockAccountsResponse(accounts: Partial<FinicityAccount>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ accounts }),
    text: async () => JSON.stringify({ accounts }),
  };
}

function mockTransactionsResponse(transactions: Partial<FinicityTransaction>[], moreAvailable = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ transactions, moreAvailable: moreAvailable ? 'true' : 'false' }),
    text: async () => JSON.stringify({ transactions, moreAvailable: moreAvailable ? 'true' : 'false' }),
  };
}

function mockDeleteResponse() {
  return {
    ok: true,
    status: 204,
    json: async () => ({}),
    text: async () => '',
  };
}

const CHECKING_ACCOUNT: FinicityAccount = {
  id: '1001',
  number: '1234',
  accountNumberDisplay: '1234',
  name: 'Main Checking',
  type: 'checking',
  status: 'active',
  balance: 5000.50,
  customerId: 'cust-1',
  institutionId: '12345',
  institutionLoginId: 100,
  currency: 'USD',
};

const SAVINGS_ACCOUNT: FinicityAccount = {
  id: '1002',
  number: '5678',
  accountNumberDisplay: '5678',
  name: 'Savings',
  type: 'savings',
  status: 'active',
  balance: 10000.00,
  customerId: 'cust-1',
  institutionId: '12345',
  institutionLoginId: 100,
  currency: 'USD',
};

const CREDIT_CARD: FinicityAccount = {
  id: '1003',
  number: '9012',
  accountNumberDisplay: '9012',
  name: 'Visa Card',
  type: 'creditCard',
  status: 'active',
  balance: -1500.00,
  customerId: 'cust-1',
  institutionId: '12345',
  institutionLoginId: 100,
  currency: 'USD',
};

const OTHER_LOGIN_ACCOUNT: FinicityAccount = {
  id: '2001',
  number: '3456',
  accountNumberDisplay: '3456',
  name: 'Other Bank Checking',
  type: 'checking',
  status: 'active',
  balance: 3000.00,
  customerId: 'cust-1',
  institutionId: '67890',
  institutionLoginId: 200,
  currency: 'USD',
};

function createProvider(loginId = '100'): FinicityDataProvider {
  return new FinicityDataProvider('cust-1', {
    item_id: loginId,
    institution_id: '12345',
    institution_name: 'Test Bank',
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('mapFinicityAccountType', () => {
  it('maps checking type', () => {
    expect(mapFinicityAccountType('checking')).toBe('checking');
  });

  it('maps savings types', () => {
    expect(mapFinicityAccountType('savings')).toBe('savings');
    expect(mapFinicityAccountType('moneyMarket')).toBe('savings');
    expect(mapFinicityAccountType('cd')).toBe('savings');
  });

  it('maps credit types', () => {
    expect(mapFinicityAccountType('creditCard')).toBe('credit');
    expect(mapFinicityAccountType('lineOfCredit')).toBe('credit');
  });

  it('maps investment types', () => {
    expect(mapFinicityAccountType('investment')).toBe('investment');
    expect(mapFinicityAccountType('brokerageAccount')).toBe('investment');
    expect(mapFinicityAccountType('401k')).toBe('investment');
    expect(mapFinicityAccountType('ira')).toBe('investment');
    expect(mapFinicityAccountType('roth')).toBe('investment');
    expect(mapFinicityAccountType('403b')).toBe('investment');
  });

  it('maps loan types', () => {
    expect(mapFinicityAccountType('mortgage')).toBe('loan');
    expect(mapFinicityAccountType('loan')).toBe('loan');
    expect(mapFinicityAccountType('studentLoan')).toBe('loan');
    expect(mapFinicityAccountType('autoLoan')).toBe('loan');
  });

  it('maps unknown types to other', () => {
    expect(mapFinicityAccountType('unknownType')).toBe('other');
    expect(mapFinicityAccountType('')).toBe('other');
  });
});

describe('FinicityDataProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAccounts()', () => {
    it('returns accounts filtered by institutionLoginId', async () => {
      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        return mockAccountsResponse([CHECKING_ACCOUNT, SAVINGS_ACCOUNT, CREDIT_CARD, OTHER_LOGIN_ACCOUNT]) as Response;
      });

      const provider = createProvider();
      const accounts = await provider.getAccounts();

      // Only accounts from loginId 100 (not 200)
      expect(accounts).toHaveLength(3);
      expect(accounts.map((a) => a.external_id)).toEqual(['1001', '1002', '1003']);
    });

    it('maps account types correctly', async () => {
      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        return mockAccountsResponse([CHECKING_ACCOUNT, SAVINGS_ACCOUNT, CREDIT_CARD]) as Response;
      });

      const provider = createProvider();
      const accounts = await provider.getAccounts();

      expect(accounts[0]!.type).toBe('checking');
      expect(accounts[0]!.name).toBe('Main Checking');
      expect(accounts[0]!.balance).toBe(5000.50);

      expect(accounts[1]!.type).toBe('savings');
      expect(accounts[2]!.type).toBe('credit');
    });
  });

  describe('getTransactions()', () => {
    const TX_DEBIT: Partial<FinicityTransaction> = {
      id: 5001,
      amount: 42.50,
      accountId: '1001',
      customerId: 1,
      status: 'active',
      description: 'Coffee Shop',
      memo: '',
      type: 'debit',
      postedDate: 1708992000,       // 2024-02-27
      transactionDate: 1708992000,
      categorization: {
        normalizedPayeeName: 'Starbucks',
        category: 'Food & Dining',
      },
    };

    const TX_CREDIT: Partial<FinicityTransaction> = {
      id: 5002,
      amount: -2000.00,
      accountId: '1001',
      customerId: 1,
      status: 'active',
      description: 'Payroll Deposit',
      memo: '',
      type: 'credit',
      postedDate: 1709078400,       // 2024-02-28
      transactionDate: 1709078400,
    };

    it('fetches and maps transactions with inverted amounts', async () => {
      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        if (url.includes('/transactions')) return mockTransactionsResponse([TX_DEBIT, TX_CREDIT]) as Response;
        return mockAccountsResponse([CHECKING_ACCOUNT]) as Response;
      });

      const provider = createProvider();
      const result = await provider.getTransactions();

      expect(result.added).toHaveLength(2);
      expect(result.modified).toHaveLength(0);
      expect(result.removed).toHaveLength(0);

      // Debit: positive Finicity amount → negative BudgetClaw (outflow)
      expect(result.added[0]!.amount).toBe(-42.50);
      expect(result.added[0]!.external_id).toBe('5001');
      expect(result.added[0]!.description).toBe('Coffee Shop');
      expect(result.added[0]!.merchant).toBe('Starbucks');
      expect(result.added[0]!.category).toBe('Food & Dining');

      // Credit: negative Finicity amount → positive BudgetClaw (inflow)
      expect(result.added[1]!.amount).toBe(2000.00);
      expect(result.added[1]!.external_id).toBe('5002');
    });

    it('uses cursor timestamp as fromDate', async () => {
      let capturedUrl = '';

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        if (url.includes('/transactions')) {
          capturedUrl = url;
          return mockTransactionsResponse([TX_DEBIT]) as Response;
        }
        return mockAccountsResponse([CHECKING_ACCOUNT]) as Response;
      });

      const cursor = '2024-02-01T00:00:00.000Z';
      const provider = createProvider();
      await provider.getTransactions(cursor);

      // fromDate should be epoch seconds of the cursor
      const expectedEpoch = Math.floor(new Date(cursor).getTime() / 1000);
      expect(capturedUrl).toContain(`fromDate=${expectedEpoch}`);
    });

    it('returns correct nextCursor from latest transaction', async () => {
      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        if (url.includes('/transactions')) return mockTransactionsResponse([TX_DEBIT, TX_CREDIT]) as Response;
        return mockAccountsResponse([CHECKING_ACCOUNT]) as Response;
      });

      const provider = createProvider();
      const result = await provider.getTransactions();

      // TX_CREDIT has the later date
      const expectedCursor = new Date(1709078400 * 1000).toISOString();
      expect(result.nextCursor).toBe(expectedCursor);
    });

    it('filters transactions to accounts in the login group', async () => {
      const txFromOtherAccount: Partial<FinicityTransaction> = {
        id: 9999,
        amount: 100,
        accountId: '2001', // belongs to loginId 200
        customerId: 1,
        status: 'active',
        description: 'Other account tx',
        memo: '',
        type: 'debit',
        postedDate: 1708992000,
        transactionDate: 1708992000,
      };

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        if (url.includes('/transactions')) {
          return mockTransactionsResponse([TX_DEBIT, txFromOtherAccount]) as Response;
        }
        return mockAccountsResponse([CHECKING_ACCOUNT, OTHER_LOGIN_ACCOUNT]) as Response;
      });

      const provider = createProvider();
      const result = await provider.getTransactions();

      // Only TX_DEBIT (accountId 1001 → loginId 100)
      expect(result.added).toHaveLength(1);
      expect(result.added[0]!.external_id).toBe('5001');
    });
  });

  describe('getBalances()', () => {
    it('returns balances for accounts in the login group', async () => {
      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        return mockAccountsResponse([CHECKING_ACCOUNT, SAVINGS_ACCOUNT, OTHER_LOGIN_ACCOUNT]) as Response;
      });

      const provider = createProvider();
      const balances = await provider.getBalances();

      // Only loginId 100 accounts
      expect(balances).toHaveLength(2);
      expect(balances[0]!.account_external_id).toBe('1001');
      expect(balances[0]!.balance).toBe(5000.50);
      expect(balances[1]!.account_external_id).toBe('1002');
      expect(balances[1]!.balance).toBe(10000.00);
    });
  });

  describe('disconnect()', () => {
    it('calls deleteInstitutionLogin', async () => {
      let deleteCalled = false;

      fetchSpy.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/partners/authentication')) return mockAuthResponse() as Response;
        if (init?.method === 'DELETE' && url.includes('/institutionLogins/100')) {
          deleteCalled = true;
          return mockDeleteResponse() as Response;
        }
        return mockDeleteResponse() as Response;
      });

      const provider = createProvider();
      await provider.disconnect();

      expect(deleteCalled).toBe(true);
    });
  });
});
