/**
 * Encrypted file-based credential store using AES-256-GCM.
 *
 * Credentials are stored at ~/.budgetclaw/credentials.json.enc (mode 0o600).
 * The encryption key is derived from:
 *   1. BUDGETCLAW_CREDENTIAL_KEY env var (recommended for headless/remote setups)
 *   2. A machine-derived key based on hostname + homedir (fallback)
 *
 * This replaces the keytar/OS-keychain approach so that BudgetClaw works
 * on headless servers, remote Mac Minis, Docker containers, etc.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname } from 'node:os';

const STORE_DIR = join(homedir(), '.budgetclaw');
const STORE_PATH = join(STORE_DIR, 'credentials.json.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const envKey = process.env['BUDGETCLAW_CREDENTIAL_KEY'];
  const passphrase = envKey ?? `budgetclaw:${hostname()}:${homedir()}`;
  const salt = createHash('sha256').update('budgetclaw-credential-salt').digest();
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

function encrypt(plaintext: string): Buffer {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [iv (12)] [tag (16)] [ciphertext (...)]
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data: Buffer): string {
  const key = deriveKey();
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

type CredentialMap = Record<string, string>;

function readStore(): CredentialMap {
  if (!existsSync(STORE_PATH)) return {};
  const raw = readFileSync(STORE_PATH);
  if (raw.length === 0) return {};
  const json = decrypt(raw);
  return JSON.parse(json) as CredentialMap;
}

function writeStore(map: CredentialMap): void {
  mkdirSync(STORE_DIR, { recursive: true });
  const json = JSON.stringify(map);
  const encrypted = encrypt(json);
  writeFileSync(STORE_PATH, encrypted, { mode: 0o600 });
}

export async function setCredential(key: string, value: string): Promise<void> {
  const map = readStore();
  map[key] = value;
  writeStore(map);
}

export async function getCredential(key: string): Promise<string | null> {
  const map = readStore();
  return map[key] ?? null;
}

export async function deleteCredential(key: string): Promise<boolean> {
  const map = readStore();
  if (!(key in map)) return false;
  delete map[key];
  writeStore(map);
  return true;
}
