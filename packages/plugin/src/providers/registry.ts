/**
 * ProviderRegistry — maps provider names to factory functions.
 *
 * Each factory receives the decrypted credential (from OS keychain) and
 * connection metadata, and returns a DataProvider instance.
 *
 * Usage:
 *   defaultRegistry.register('plaid', (credential, conn) => new PlaidDataProvider(credential, conn));
 *   const provider = defaultRegistry.create('plaid', credential, conn);
 */

import type { DataProvider } from './interface.js';
import type { ProviderConnectionRow } from '../db/types.js';

export type ProviderConnectionMeta = Pick<
  ProviderConnectionRow,
  'item_id' | 'institution_id' | 'institution_name'
>;

export type ProviderFactory = (
  credential: string,
  connection: ProviderConnectionMeta,
) => DataProvider;

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  register(providerName: string, factory: ProviderFactory): void {
    this.factories.set(providerName, factory);
  }

  create(providerName: string, credential: string, connection: ProviderConnectionMeta): DataProvider {
    const factory = this.factories.get(providerName);
    if (!factory) {
      const available = [...this.factories.keys()];
      throw new Error(
        `No provider registered for "${providerName}". ` +
        (available.length > 0
          ? `Available: ${available.join(', ')}`
          : 'No providers are registered yet.'),
      );
    }
    return factory(credential, connection);
  }

  get registeredProviders(): string[] {
    return [...this.factories.keys()];
  }
}

/** Singleton registry used by the default plugin registration. */
export const defaultRegistry = new ProviderRegistry();
