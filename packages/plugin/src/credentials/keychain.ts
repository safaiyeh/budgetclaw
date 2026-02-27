/**
 * Credential store facade.
 *
 * Default backend: encrypted file store (~/.budgetclaw/credentials.json.enc).
 * Opt-in to OS keychain (keytar) by setting:
 *   BUDGETCLAW_CREDENTIAL_BACKEND=keytar
 */

import * as fileStore from './file-store.js';

const SERVICE = 'budgetclaw';

type Backend = {
  setCredential(key: string, value: string): Promise<void>;
  getCredential(key: string): Promise<string | null>;
  deleteCredential(key: string): Promise<boolean>;
};

let _keytarBackend: Backend | null = null;

async function getKeytarBackend(): Promise<Backend> {
  if (!_keytarBackend) {
    let keytar: typeof import('keytar');
    try {
      keytar = await import('keytar');
    } catch {
      throw new Error(
        'keytar is not available. Install it with: pnpm add keytar\n' +
        'Or remove BUDGETCLAW_CREDENTIAL_BACKEND=keytar to use the default file store.'
      );
    }
    _keytarBackend = {
      async setCredential(key, value) { await keytar.setPassword(SERVICE, key, value); },
      async getCredential(key) { return keytar.getPassword(SERVICE, key); },
      async deleteCredential(key) { return keytar.deletePassword(SERVICE, key); },
    };
  }
  return _keytarBackend;
}

function useKeytar(): boolean {
  return process.env['BUDGETCLAW_CREDENTIAL_BACKEND'] === 'keytar';
}

async function getBackend(): Promise<Backend> {
  return useKeytar() ? getKeytarBackend() : fileStore;
}

export async function setCredential(key: string, value: string): Promise<void> {
  const backend = await getBackend();
  await backend.setCredential(key, value);
}

export async function getCredential(key: string): Promise<string | null> {
  const backend = await getBackend();
  return backend.getCredential(key);
}

export async function deleteCredential(key: string): Promise<boolean> {
  const backend = await getBackend();
  return backend.deleteCredential(key);
}
