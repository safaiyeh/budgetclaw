import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the provider search modules before importing connect-bank
const mockStartPlaidLink = vi.fn();
const mockCompletePlaidLink = vi.fn();
const mockStartFinicityLink = vi.fn();
const mockCompleteFinicityLink = vi.fn();

vi.mock('./plaid-link.js', () => ({
  startPlaidLink: (...args: unknown[]) => mockStartPlaidLink(...args),
  completePlaidLink: (...args: unknown[]) => mockCompletePlaidLink(...args),
}));

vi.mock('./finicity-link.js', () => ({
  startFinicityLink: (...args: unknown[]) => mockStartFinicityLink(...args),
  completeFinicityLink: (...args: unknown[]) => mockCompleteFinicityLink(...args),
}));

// Mock the provider clients used for institution search
vi.mock('../../providers/plaid/client.js', () => ({
  getPlaidClient: vi.fn(),
}));

vi.mock('../../providers/finicity/client.js', () => ({
  FinicityClient: vi.fn(),
}));

// Must import after mocks are set up
import { connectBank, completeConnectBank } from './connect-bank.js';
import { getPlaidClient } from '../../providers/plaid/client.js';
import { FinicityClient } from '../../providers/finicity/client.js';
import type { ProviderRegistry } from '../../providers/registry.js';

const mockDb = {} as Parameters<typeof connectBank>[0];
const mockRegistry = {} as ProviderRegistry;

describe('connectBank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupPlaidSearch(result: { institution_id: string; name: string } | null) {
    const mockClient = {
      institutionsSearch: vi.fn().mockResolvedValue({
        data: {
          institutions: result ? [result] : [],
        },
      }),
    };
    vi.mocked(getPlaidClient).mockReturnValue(mockClient as unknown as ReturnType<typeof getPlaidClient>);
  }

  function setupFinicitySearch(result: { id: number; name: string } | null) {
    const mockClient = {
      searchInstitutions: vi.fn().mockResolvedValue(result ? [result] : []),
    };
    vi.mocked(FinicityClient).mockImplementation(() => mockClient as unknown as InstanceType<typeof FinicityClient>);
  }

  it('prefers Plaid when both providers support the institution', async () => {
    setupPlaidSearch({ institution_id: 'ins_1', name: 'Chase' });
    setupFinicitySearch({ id: 101, name: 'Chase Bank' });
    mockStartPlaidLink.mockResolvedValue({ link_url: 'https://plaid.link/abc', link_token: 'lt-123' });

    const result = await connectBank(mockDb, mockRegistry, { institution_name: 'Chase' });

    expect(result.provider).toBe('plaid');
    expect(result.link_url).toBe('https://plaid.link/abc');
    expect(result.completion_token).toBe('lt-123');
    expect(result.plaid_match).toBe('Chase');
    expect(result.finicity_match).toBe('Chase Bank');
    expect(mockStartPlaidLink).toHaveBeenCalled();
    expect(mockStartFinicityLink).not.toHaveBeenCalled();
  });

  it('uses Plaid when only Plaid supports the institution', async () => {
    setupPlaidSearch({ institution_id: 'ins_2', name: 'Wells Fargo' });
    setupFinicitySearch(null);
    mockStartPlaidLink.mockResolvedValue({ link_url: 'https://plaid.link/def', link_token: 'lt-456' });

    const result = await connectBank(mockDb, mockRegistry, { institution_name: 'Wells Fargo' });

    expect(result.provider).toBe('plaid');
    expect(result.plaid_match).toBe('Wells Fargo');
    expect(result.finicity_match).toBeNull();
  });

  it('uses Finicity when only Finicity supports the institution', async () => {
    setupPlaidSearch(null);
    setupFinicitySearch({ id: 201, name: 'Local Credit Union' });
    mockStartFinicityLink.mockResolvedValue({ connect_url: 'https://finicity.link/xyz', customer_id: 'cust-789' });

    const result = await connectBank(mockDb, mockRegistry, { institution_name: 'Local Credit Union' });

    expect(result.provider).toBe('finicity');
    expect(result.link_url).toBe('https://finicity.link/xyz');
    expect(result.completion_token).toBe('cust-789');
    expect(result.plaid_match).toBeNull();
    expect(result.finicity_match).toBe('Local Credit Union');
    expect(mockStartFinicityLink).toHaveBeenCalled();
    expect(mockStartPlaidLink).not.toHaveBeenCalled();
  });

  it('throws when neither provider supports the institution', async () => {
    setupPlaidSearch(null);
    setupFinicitySearch(null);

    await expect(
      connectBank(mockDb, mockRegistry, { institution_name: 'NonExistent Bank' }),
    ).rejects.toThrow('Could not find "NonExistent Bank"');
  });

  it('falls back to Finicity when Plaid throws an error', async () => {
    vi.mocked(getPlaidClient).mockImplementation(() => {
      throw new Error('Missing env var: PLAID_CLIENT_ID');
    });
    setupFinicitySearch({ id: 301, name: 'Some Bank' });
    mockStartFinicityLink.mockResolvedValue({ connect_url: 'https://finicity.link/abc', customer_id: 'cust-111' });

    const result = await connectBank(mockDb, mockRegistry, { institution_name: 'Some Bank' });

    expect(result.provider).toBe('finicity');
    expect(result.plaid_match).toBeNull();
  });
});

describe('completeConnectBank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes to completePlaidLink for plaid provider', async () => {
    const expectedResult = { status: 'complete', connection_id: 'conn-1' };
    mockCompletePlaidLink.mockResolvedValue(expectedResult);

    const result = await completeConnectBank(mockDb, mockRegistry, {
      provider: 'plaid',
      completion_token: 'lt-123',
      institution_name: 'Chase',
    });

    expect(result).toEqual(expectedResult);
    expect(mockCompletePlaidLink).toHaveBeenCalledWith(
      mockDb,
      mockRegistry,
      { link_token: 'lt-123', institution_name: 'Chase' },
    );
    expect(mockCompleteFinicityLink).not.toHaveBeenCalled();
  });

  it('routes to completeFinicityLink for finicity provider', async () => {
    const expectedResult = { status: 'complete', connections: [] };
    mockCompleteFinicityLink.mockResolvedValue(expectedResult);

    const result = await completeConnectBank(mockDb, mockRegistry, {
      provider: 'finicity',
      completion_token: 'cust-789',
    });

    expect(result).toEqual(expectedResult);
    expect(mockCompleteFinicityLink).toHaveBeenCalledWith(
      mockDb,
      mockRegistry,
      { customer_id: 'cust-789' },
    );
    expect(mockCompletePlaidLink).not.toHaveBeenCalled();
  });

  it('throws for unknown provider', async () => {
    await expect(
      completeConnectBank(mockDb, mockRegistry, {
        provider: 'unknown' as 'plaid',
        completion_token: 'token',
      }),
    ).rejects.toThrow('Unknown provider: unknown');
  });
});
