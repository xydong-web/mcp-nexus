import { D1Client } from '../db/d1.js';
import { decrypt } from '../crypto/crypto.js';

type KeySelectionStrategy = 'round_robin' | 'random';

/**
 * Simple key pool for Cloudflare Workers
 * Selects an active key using round-robin strategy
 */
export async function selectTavilyKey(
  db: D1Client,
  encryptionSecret: string
): Promise<{ keyId: string; apiKey: string } | null> {
  const key = await db.getActiveTavilyKey();

  if (!key) return null;

  // Update lastUsedAt
  await db.updateTavilyKey(key.id, { lastUsedAt: new Date().toISOString() });

  // Decrypt the key
  const keyEncrypted = new Uint8Array(key.keyEncrypted);
  const apiKey = await decrypt(keyEncrypted, encryptionSecret);

  return { keyId: key.id, apiKey };
}

export async function selectBraveKey(
  db: D1Client,
  encryptionSecret: string
): Promise<{ keyId: string; apiKey: string } | null> {
  const key = await db.getActiveBraveKey();

  if (!key) return null;

  // Update lastUsedAt
  await db.updateBraveKey(key.id, { lastUsedAt: new Date().toISOString() });

  // Decrypt the key
  const keyEncrypted = new Uint8Array(key.keyEncrypted);
  const apiKey = await decrypt(keyEncrypted, encryptionSecret);

  return { keyId: key.id, apiKey };
}

export async function selectGrokKey(
  db: D1Client,
  encryptionSecret: string,
  strategy: KeySelectionStrategy = 'round_robin'
): Promise<{ keyId: string; apiKey: string } | null> {
  const keys = await db.getGrokKeys();
  const nowMs = Date.now();
  const eligible = keys.filter((key) => {
    if (key.status !== 'active') return false;
    if (!key.cooldownUntil) return true;
    const cooldownUntilMs = Date.parse(key.cooldownUntil);
    return !Number.isFinite(cooldownUntilMs) || cooldownUntilMs <= nowMs;
  });

  if (eligible.length === 0) return null;

  const key = strategy === 'random'
    ? eligible[Math.floor(Math.random() * eligible.length)]
    : [...eligible].sort((a, b) => {
      const aLastUsed = a.lastUsedAt ? Date.parse(a.lastUsedAt) : Number.NEGATIVE_INFINITY;
      const bLastUsed = b.lastUsedAt ? Date.parse(b.lastUsedAt) : Number.NEGATIVE_INFINITY;
      return aLastUsed - bLastUsed;
    })[0];

  if (!key) return null;

  // Update lastUsedAt
  await db.updateGrokKey(key.id, { lastUsedAt: new Date().toISOString() });

  // Decrypt the key
  const keyEncrypted = new Uint8Array(key.keyEncrypted);
  const apiKey = await decrypt(keyEncrypted, encryptionSecret);

  return { keyId: key.id, apiKey };
}

export async function markTavilyKeyCooldown(
  db: D1Client,
  keyId: string,
  cooldownMs: number = 5 * 60 * 1000
): Promise<void> {
  await db.updateTavilyKey(keyId, {
    status: 'cooldown',
    cooldownUntil: new Date(Date.now() + cooldownMs).toISOString()
  });
}

export async function markTavilyKeyInvalid(
  db: D1Client,
  keyId: string
): Promise<void> {
  await db.updateTavilyKey(keyId, { status: 'invalid' });
}

export async function markGrokKeyCooldown(
  db: D1Client,
  keyId: string,
  cooldownMs: number = 5 * 60 * 1000
): Promise<void> {
  await db.updateGrokKey(keyId, {
    status: 'cooldown',
    cooldownUntil: new Date(Date.now() + cooldownMs).toISOString()
  });
}

export async function markGrokKeyInvalid(
  db: D1Client,
  keyId: string
): Promise<void> {
  await db.updateGrokKey(keyId, { status: 'invalid' });
}

export async function markBraveKeyInvalid(
  db: D1Client,
  keyId: string
): Promise<void> {
  await db.updateBraveKey(keyId, { status: 'invalid' });
}
