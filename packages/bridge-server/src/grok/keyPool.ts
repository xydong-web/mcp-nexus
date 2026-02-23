import type { GrokKey, PrismaClient } from '@mcp-nexus/db';
import { orderKeyCandidates, type TavilyKeySelectionStrategy } from '@mcp-nexus/core';
import { decryptAes256Gcm } from '../crypto/crypto.js';

export type EligibleGrokKey = GrokKey & { apiKey: string };

class Mutex {
  private current: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.current;
    this.current = prev.then(() => next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class GrokKeyPool {
  private readonly prisma: PrismaClient;
  private readonly encryptionKey: Buffer;
  private readonly getSelectionStrategy: () => Promise<TavilyKeySelectionStrategy>;
  private readonly mutex = new Mutex();

  constructor(opts: {
    prisma: PrismaClient;
    encryptionKey: Buffer;
    getSelectionStrategy: () => Promise<TavilyKeySelectionStrategy>;
  }) {
    this.prisma = opts.prisma;
    this.encryptionKey = opts.encryptionKey;
    this.getSelectionStrategy = opts.getSelectionStrategy;
  }

  async selectEligibleKey(): Promise<EligibleGrokKey | null> {
    return await this.mutex.runExclusive(async () => {
      const strategy = await this.getSelectionStrategy();
      const now = new Date();
      const keys = await this.prisma.grokKey.findMany({
        where: {
          status: { in: ['active', 'cooldown'] },
          OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }]
        },
        orderBy: [{ lastUsedAt: 'asc' }, { createdAt: 'asc' }],
        take: 20
      });
      if (keys.length === 0) return null;

      const candidate = orderKeyCandidates(keys, strategy)[0];
      if (!candidate) return null;

      const updateData =
        candidate.status === 'cooldown'
          ? { lastUsedAt: now, status: 'active' as const, cooldownUntil: null }
          : { lastUsedAt: now };

      const updated = await this.prisma.grokKey.update({
        where: { id: candidate.id },
        data: updateData
      });
      const apiKey = decryptAes256Gcm(Buffer.from(updated.keyEncrypted), this.encryptionKey);
      return { ...updated, apiKey };
    });
  }

  async preflightEligible(): Promise<{ ok: true } | { ok: false; retryAfterMs?: number; error: string }> {
    const now = new Date();
    const healthy = await this.prisma.grokKey.findFirst({
      where: {
        status: { in: ['active', 'cooldown'] },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }]
      },
      select: { id: true }
    });
    if (healthy) return { ok: true };

    const nextCooldown = await this.prisma.grokKey.findFirst({
      where: { status: 'cooldown', cooldownUntil: { gt: now } },
      orderBy: { cooldownUntil: 'asc' },
      select: { cooldownUntil: true }
    });

    const retryAfterMs =
      nextCooldown?.cooldownUntil instanceof Date
        ? Math.max(0, nextCooldown.cooldownUntil.getTime() - now.getTime())
        : undefined;

    return {
      ok: false,
      retryAfterMs,
      error: 'No healthy Grok API keys available'
    };
  }

  async markCooldown(keyId: string, cooldownUntil: Date): Promise<void> {
    await this.prisma.grokKey.update({
      where: { id: keyId },
      data: {
        status: 'cooldown',
        cooldownUntil,
        failureScore: { increment: 1 }
      }
    });
  }

  async markInvalid(keyId: string): Promise<void> {
    await this.prisma.grokKey.update({
      where: { id: keyId },
      data: { status: 'invalid', failureScore: { increment: 1 } }
    });
  }

  async markActive(keyId: string): Promise<void> {
    await this.prisma.grokKey.update({
      where: { id: keyId },
      data: { status: 'active', cooldownUntil: null }
    });
  }
}

