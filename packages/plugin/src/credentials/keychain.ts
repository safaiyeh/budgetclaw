/**
 * Keychain wrapper using `keytar` for cross-platform OS keychain access.
 *
 * Credentials are stored in the OS keychain under:
 *   service: "budgetclaw"
 *   account: <keychain_key>
 *
 * This means tokens are NEVER written to the SQLite database — only a
 * reference key (keychain_key) is stored in provider_connections.
 */

const SERVICE = 'budgetclaw';

let _keytar: typeof import('keytar') | null = null;

async function getKeytar(): Promise<typeof import('keytar')> {
  if (!_keytar) {
    try {
      _keytar = await import('keytar');
    } catch {
      throw new Error(
        'keytar is not available. Install it with: bun add keytar\n' +
        'Note: keytar requires native bindings and may need build tools.'
      );
    }
  }
  return _keytar;
}

/**
 * Store a credential in the OS keychain.
 */
export async function setCredential(key: string, value: string): Promise<void> {
  const keytar = await getKeytar();
  await keytar.setPassword(SERVICE, key, value);
}

/**
 * Retrieve a credential from the OS keychain.
 * Returns null if not found.
 */
export async function getCredential(key: string): Promise<string | null> {
  const keytar = await getKeytar();
  return keytar.getPassword(SERVICE, key);
}

/**
 * Delete a credential from the OS keychain.
 */
export async function deleteCredential(key: string): Promise<boolean> {
  const keytar = await getKeytar();
  return keytar.deletePassword(SERVICE, key);
}
