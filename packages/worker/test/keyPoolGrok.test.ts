import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decryptMock } = vi.hoisted(() => ({
  decryptMock: vi.fn(async () => 'decrypted-grok-key')
}));

vi.mock('../src/crypto/crypto.js', () => ({
  decrypt: decryptMock
}));

import { markGrokKeyCooldown, markGrokKeyInvalid, selectGrokKey } from '../src/services/keyPool.js';

function makeGrokKey(input: Partial<Record<string, unknown>> & { id: string }) {
  return {
    id: input.id,
    label: `key-${input.id}`,
    keyEncrypted: new Uint8Array([1, 2, 3]).buffer,
    keyMasked: 'xai-****',
    status: 'active',
    cooldownUntil: null,
    lastUsedAt: null,
    ...input
  };
}

describe('Grok key pool lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects least recently used eligible Grok key in round_robin mode', async () => {
    const updateGrokKey = vi.fn(async () => undefined);
    const db = {
      getGrokKeys: vi.fn(async () => [
        makeGrokKey({ id: 'recent', lastUsedAt: '2026-02-01T00:00:00.000Z' }),
        makeGrokKey({ id: 'oldest', lastUsedAt: '2026-01-01T00:00:00.000Z' }),
        makeGrokKey({ id: 'cooling', status: 'active', cooldownUntil: new Date(Date.now() + 60_000).toISOString() }),
        makeGrokKey({ id: 'invalid', status: 'invalid' })
      ]),
      updateGrokKey
    };

    const selected = await selectGrokKey(db as any, 'secret', 'round_robin');

    expect(selected).toEqual({ keyId: 'oldest', apiKey: 'decrypted-grok-key' });
    expect(updateGrokKey).toHaveBeenCalledWith(
      'oldest',
      expect.objectContaining({ lastUsedAt: expect.any(String) })
    );
    expect(decryptMock).toHaveBeenCalledTimes(1);
  });

  it('supports random selection strategy for eligible Grok keys', async () => {
    const updateGrokKey = vi.fn(async () => undefined);
    const db = {
      getGrokKeys: vi.fn(async () => [
        makeGrokKey({ id: 'first' }),
        makeGrokKey({ id: 'second' })
      ]),
      updateGrokKey
    };

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const selected = await selectGrokKey(db as any, 'secret', 'random');
    randomSpy.mockRestore();

    expect(selected?.keyId).toBe('second');
    expect(updateGrokKey).toHaveBeenCalledWith(
      'second',
      expect.objectContaining({ lastUsedAt: expect.any(String) })
    );
  });

  it('marks Grok keys invalid on auth failures', async () => {
    const db = {
      updateGrokKey: vi.fn(async () => undefined)
    };

    await markGrokKeyInvalid(db as any, 'grok_1');

    expect(db.updateGrokKey).toHaveBeenCalledWith('grok_1', { status: 'invalid' });
  });

  it('marks Grok keys into cooldown with a future cooldownUntil', async () => {
    const db = {
      updateGrokKey: vi.fn(async () => undefined)
    };
    const before = Date.now();

    await markGrokKeyCooldown(db as any, 'grok_1', 30_000);

    expect(db.updateGrokKey).toHaveBeenCalledTimes(1);
    const [, payload] = db.updateGrokKey.mock.calls[0];
    expect(payload.status).toBe('cooldown');
    expect(typeof payload.cooldownUntil).toBe('string');
    expect(Date.parse(payload.cooldownUntil)).toBeGreaterThan(before + 25_000);
  });
});

