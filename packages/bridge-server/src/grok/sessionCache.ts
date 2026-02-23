export type CachedSource = {
  url: string;
  title?: string;
  description?: string;
  provider?: string;
};

type Entry = {
  expiresAtMs: number;
  sources: CachedSource[];
};

export class GrokSessionCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly store = new Map<string, Entry>();

  constructor(opts?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = Math.max(64, opts?.maxEntries ?? 512);
    this.ttlMs = Math.max(60_000, opts?.ttlMs ?? 30 * 60_000);
  }

  set(sessionId: string, sources: CachedSource[]): void {
    const now = Date.now();
    this.prune(now);
    this.store.set(sessionId, {
      expiresAtMs: now + this.ttlMs,
      sources
    });

    if (this.store.size <= this.maxEntries) return;
    const oldestKey = this.store.keys().next().value as string | undefined;
    if (oldestKey) this.store.delete(oldestKey);
  }

  get(sessionId: string): CachedSource[] | null {
    const now = Date.now();
    const entry = this.store.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAtMs <= now) {
      this.store.delete(sessionId);
      return null;
    }
    return entry.sources;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.store) {
      if (entry.expiresAtMs <= now) {
        this.store.delete(key);
      }
    }
  }
}

