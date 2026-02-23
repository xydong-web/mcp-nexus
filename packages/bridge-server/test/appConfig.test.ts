import { describe, expect, it } from 'vitest';
import { createBridgeApp, resolveBridgeHost } from '../src/app.js';

describe('createBridgeApp (config)', () => {
  it('does not throw when required env vars are missing', () => {
    const prevDb = process.env.DATABASE_URL;
    const prevKey = process.env.KEY_ENCRYPTION_SECRET;

    delete process.env.DATABASE_URL;
    delete process.env.KEY_ENCRYPTION_SECRET;

    expect(() => createBridgeApp()).not.toThrow();

    if (typeof prevDb === 'string') process.env.DATABASE_URL = prevDb;
    else delete process.env.DATABASE_URL;
    if (typeof prevKey === 'string') process.env.KEY_ENCRYPTION_SECRET = prevKey;
    else delete process.env.KEY_ENCRYPTION_SECRET;
  });

  it('defaults HOST to 0.0.0.0 when unset', () => {
    const prevHost = process.env.HOST;
    delete process.env.HOST;

    expect(resolveBridgeHost()).toBe('0.0.0.0');

    if (typeof prevHost === 'string') process.env.HOST = prevHost;
    else delete process.env.HOST;
  });

  it('honors explicit host override over environment host', () => {
    const prevHost = process.env.HOST;
    process.env.HOST = '127.0.0.1';

    expect(resolveBridgeHost('0.0.0.0')).toBe('0.0.0.0');

    if (typeof prevHost === 'string') process.env.HOST = prevHost;
    else delete process.env.HOST;
  });
});
