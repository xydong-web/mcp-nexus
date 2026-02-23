import type { PrismaClient } from '@mcp-nexus/db';
import { parseTavilyKeySelectionStrategy, parseSearchSourceMode, type TavilyKeySelectionStrategy, type SearchSourceMode } from '@mcp-nexus/core';

const REFRESH_MS = Number(process.env.SERVER_SETTINGS_REFRESH_MS ?? '5000');
const KEY_TAVILY_STRATEGY = 'tavilyKeySelectionStrategy';
const KEY_SEARCH_SOURCE_MODE = 'searchSourceMode';
const KEY_RESEARCH_ENABLED = 'researchEnabled';
const KEY_GROK_SEARCH_ENABLED = 'grokSearchEnabled';
const KEY_GROK_MODEL_DEFAULT = 'grokModelDefault';
const KEY_GROK_EXTRA_SOURCES_DEFAULT = 'grokExtraSourcesDefault';
const KEY_GROK_SOURCE_MODE = 'grokSearchSourceMode';
const KEY_GROK_STRATEGY = 'grokKeySelectionStrategy';

function clampExtraSources(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

export class ServerSettings {
  private readonly prisma: PrismaClient;
  private readonly fallbackStrategy: TavilyKeySelectionStrategy;
  private readonly fallbackSearchSourceMode: SearchSourceMode;
  private readonly fallbackResearchEnabled: boolean;
  private readonly fallbackGrokSearchEnabled: boolean;
  private readonly fallbackGrokModelDefault: string;
  private readonly fallbackGrokExtraSourcesDefault: number;
  private readonly fallbackGrokSearchSourceMode: SearchSourceMode;
  private readonly fallbackGrokStrategy: TavilyKeySelectionStrategy;
  private cached: { strategy: TavilyKeySelectionStrategy; expiresAtMs: number } | null = null;
  private cachedSearchSourceMode: { mode: SearchSourceMode; expiresAtMs: number } | null = null;
  private cachedResearchEnabled: { enabled: boolean; expiresAtMs: number } | null = null;
  private cachedGrokSearchEnabled: { enabled: boolean; expiresAtMs: number } | null = null;
  private cachedGrokModelDefault: { model: string; expiresAtMs: number } | null = null;
  private cachedGrokExtraSourcesDefault: { value: number; expiresAtMs: number } | null = null;
  private cachedGrokSourceMode: { mode: SearchSourceMode; expiresAtMs: number } | null = null;
  private cachedGrokStrategy: { strategy: TavilyKeySelectionStrategy; expiresAtMs: number } | null = null;
  private inFlight: Promise<TavilyKeySelectionStrategy> | null = null;
  private inFlightSearchSourceMode: Promise<SearchSourceMode> | null = null;
  private inFlightResearchEnabled: Promise<boolean> | null = null;
  private inFlightGrokSearchEnabled: Promise<boolean> | null = null;
  private inFlightGrokModelDefault: Promise<string> | null = null;
  private inFlightGrokExtraSourcesDefault: Promise<number> | null = null;
  private inFlightGrokSourceMode: Promise<SearchSourceMode> | null = null;
  private inFlightGrokStrategy: Promise<TavilyKeySelectionStrategy> | null = null;

  constructor(opts: {
    prisma: PrismaClient;
    fallbackStrategy: TavilyKeySelectionStrategy;
    fallbackSearchSourceMode?: SearchSourceMode;
    fallbackResearchEnabled?: boolean;
    fallbackGrokSearchEnabled?: boolean;
    fallbackGrokModelDefault?: string;
    fallbackGrokExtraSourcesDefault?: number;
    fallbackGrokSearchSourceMode?: SearchSourceMode;
    fallbackGrokStrategy?: TavilyKeySelectionStrategy;
  }) {
    this.prisma = opts.prisma;
    this.fallbackStrategy = opts.fallbackStrategy;
    this.fallbackSearchSourceMode = opts.fallbackSearchSourceMode ?? 'brave_prefer_tavily_fallback';
    this.fallbackResearchEnabled = opts.fallbackResearchEnabled ?? true;
    this.fallbackGrokSearchEnabled = opts.fallbackGrokSearchEnabled ?? (process.env.GROK_SEARCH_ENABLED === 'true');
    this.fallbackGrokModelDefault = (opts.fallbackGrokModelDefault ?? process.env.GROK_MODEL_DEFAULT ?? 'grok-4-latest').trim() || 'grok-4-latest';
    this.fallbackGrokExtraSourcesDefault = clampExtraSources(
      opts.fallbackGrokExtraSourcesDefault ?? Number(process.env.GROK_EXTRA_SOURCES_DEFAULT ?? '0')
    );
    this.fallbackGrokSearchSourceMode =
      opts.fallbackGrokSearchSourceMode ?? parseSearchSourceMode(process.env.GROK_SEARCH_SOURCE_MODE, 'combined');
    this.fallbackGrokStrategy = opts.fallbackGrokStrategy ?? opts.fallbackStrategy;
  }

  async getTavilyKeySelectionStrategy(): Promise<TavilyKeySelectionStrategy> {
    const now = Date.now();
    if (this.cached && now < this.cached.expiresAtMs) return this.cached.strategy;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_TAVILY_STRATEGY } });
        const parsed = parseTavilyKeySelectionStrategy(row?.value, this.fallbackStrategy);
        this.cached = { strategy: parsed, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return parsed;
      } catch {
        const fallback = this.cached?.strategy ?? this.fallbackStrategy;
        this.cached = { strategy: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  async setTavilyKeySelectionStrategy(next: TavilyKeySelectionStrategy): Promise<TavilyKeySelectionStrategy> {
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_TAVILY_STRATEGY },
      create: { key: KEY_TAVILY_STRATEGY, value: next },
      update: { value: next }
    });
    this.cached = { strategy: next, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return next;
  }

  async getSearchSourceMode(): Promise<SearchSourceMode> {
    const now = Date.now();
    if (this.cachedSearchSourceMode && now < this.cachedSearchSourceMode.expiresAtMs) {
      return this.cachedSearchSourceMode.mode;
    }
    if (this.inFlightSearchSourceMode) return this.inFlightSearchSourceMode;

    this.inFlightSearchSourceMode = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_SEARCH_SOURCE_MODE } });
        const parsed = parseSearchSourceMode(row?.value, this.fallbackSearchSourceMode);
        this.cachedSearchSourceMode = { mode: parsed, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return parsed;
      } catch {
        const fallback = this.cachedSearchSourceMode?.mode ?? this.fallbackSearchSourceMode;
        this.cachedSearchSourceMode = { mode: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightSearchSourceMode = null;
      }
    })();

    return this.inFlightSearchSourceMode;
  }

  async setSearchSourceMode(next: SearchSourceMode): Promise<SearchSourceMode> {
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_SEARCH_SOURCE_MODE },
      create: { key: KEY_SEARCH_SOURCE_MODE, value: next },
      update: { value: next }
    });
    this.cachedSearchSourceMode = { mode: next, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return next;
  }

  async getResearchEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.cachedResearchEnabled && now < this.cachedResearchEnabled.expiresAtMs) {
      return this.cachedResearchEnabled.enabled;
    }
    if (this.inFlightResearchEnabled) return this.inFlightResearchEnabled;

    this.inFlightResearchEnabled = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_RESEARCH_ENABLED } });
        const enabled = row?.value === 'false' ? false : (row?.value === 'true' ? true : this.fallbackResearchEnabled);
        this.cachedResearchEnabled = { enabled, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return enabled;
      } catch {
        const fallback = this.cachedResearchEnabled?.enabled ?? this.fallbackResearchEnabled;
        this.cachedResearchEnabled = { enabled: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightResearchEnabled = null;
      }
    })();

    return this.inFlightResearchEnabled;
  }

  async setResearchEnabled(next: boolean): Promise<boolean> {
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_RESEARCH_ENABLED },
      create: { key: KEY_RESEARCH_ENABLED, value: String(next) },
      update: { value: String(next) }
    });
    this.cachedResearchEnabled = { enabled: next, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return next;
  }

  async getGrokSearchEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.cachedGrokSearchEnabled && now < this.cachedGrokSearchEnabled.expiresAtMs) {
      return this.cachedGrokSearchEnabled.enabled;
    }
    if (this.inFlightGrokSearchEnabled) return this.inFlightGrokSearchEnabled;

    this.inFlightGrokSearchEnabled = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_SEARCH_ENABLED } });
        const enabled = row?.value === 'true'
          ? true
          : row?.value === 'false'
            ? false
            : this.fallbackGrokSearchEnabled;
        this.cachedGrokSearchEnabled = { enabled, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return enabled;
      } catch {
        const fallback = this.cachedGrokSearchEnabled?.enabled ?? this.fallbackGrokSearchEnabled;
        this.cachedGrokSearchEnabled = { enabled: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightGrokSearchEnabled = null;
      }
    })();

    return this.inFlightGrokSearchEnabled;
  }

  async setGrokSearchEnabled(next: boolean): Promise<boolean> {
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_GROK_SEARCH_ENABLED },
      create: { key: KEY_GROK_SEARCH_ENABLED, value: String(next) },
      update: { value: String(next) }
    });
    this.cachedGrokSearchEnabled = { enabled: next, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return next;
  }

  async getGrokModelDefault(): Promise<string> {
    const now = Date.now();
    if (this.cachedGrokModelDefault && now < this.cachedGrokModelDefault.expiresAtMs) {
      return this.cachedGrokModelDefault.model;
    }
    if (this.inFlightGrokModelDefault) return this.inFlightGrokModelDefault;

    this.inFlightGrokModelDefault = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_MODEL_DEFAULT } });
        const model = (row?.value ?? this.fallbackGrokModelDefault).trim() || this.fallbackGrokModelDefault;
        this.cachedGrokModelDefault = { model, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return model;
      } catch {
        const fallback = this.cachedGrokModelDefault?.model ?? this.fallbackGrokModelDefault;
        this.cachedGrokModelDefault = { model: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightGrokModelDefault = null;
      }
    })();

    return this.inFlightGrokModelDefault;
  }

  async setGrokModelDefault(next: string): Promise<string> {
    const normalized = next.trim() || this.fallbackGrokModelDefault;
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_GROK_MODEL_DEFAULT },
      create: { key: KEY_GROK_MODEL_DEFAULT, value: normalized },
      update: { value: normalized }
    });
    this.cachedGrokModelDefault = { model: normalized, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return normalized;
  }

  async getGrokExtraSourcesDefault(): Promise<number> {
    const now = Date.now();
    if (this.cachedGrokExtraSourcesDefault && now < this.cachedGrokExtraSourcesDefault.expiresAtMs) {
      return this.cachedGrokExtraSourcesDefault.value;
    }
    if (this.inFlightGrokExtraSourcesDefault) return this.inFlightGrokExtraSourcesDefault;

    this.inFlightGrokExtraSourcesDefault = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_EXTRA_SOURCES_DEFAULT } });
        const parsed = clampExtraSources(row?.value ? Number(row.value) : this.fallbackGrokExtraSourcesDefault);
        this.cachedGrokExtraSourcesDefault = { value: parsed, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return parsed;
      } catch {
        const fallback = this.cachedGrokExtraSourcesDefault?.value ?? this.fallbackGrokExtraSourcesDefault;
        this.cachedGrokExtraSourcesDefault = { value: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightGrokExtraSourcesDefault = null;
      }
    })();

    return this.inFlightGrokExtraSourcesDefault;
  }

  async setGrokExtraSourcesDefault(next: number): Promise<number> {
    const normalized = clampExtraSources(next);
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_GROK_EXTRA_SOURCES_DEFAULT },
      create: { key: KEY_GROK_EXTRA_SOURCES_DEFAULT, value: String(normalized) },
      update: { value: String(normalized) }
    });
    this.cachedGrokExtraSourcesDefault = { value: normalized, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return normalized;
  }

  async getGrokSearchSourceMode(): Promise<SearchSourceMode> {
    const now = Date.now();
    if (this.cachedGrokSourceMode && now < this.cachedGrokSourceMode.expiresAtMs) {
      return this.cachedGrokSourceMode.mode;
    }
    if (this.inFlightGrokSourceMode) return this.inFlightGrokSourceMode;

    this.inFlightGrokSourceMode = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_SOURCE_MODE } });
        const parsed = parseSearchSourceMode(row?.value, this.fallbackGrokSearchSourceMode);
        this.cachedGrokSourceMode = { mode: parsed, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return parsed;
      } catch {
        const fallback = this.cachedGrokSourceMode?.mode ?? this.fallbackGrokSearchSourceMode;
        this.cachedGrokSourceMode = { mode: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightGrokSourceMode = null;
      }
    })();

    return this.inFlightGrokSourceMode;
  }

  async setGrokSearchSourceMode(next: SearchSourceMode): Promise<SearchSourceMode> {
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_GROK_SOURCE_MODE },
      create: { key: KEY_GROK_SOURCE_MODE, value: next },
      update: { value: next }
    });
    this.cachedGrokSourceMode = { mode: next, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return next;
  }

  async getGrokKeySelectionStrategy(): Promise<TavilyKeySelectionStrategy> {
    const now = Date.now();
    if (this.cachedGrokStrategy && now < this.cachedGrokStrategy.expiresAtMs) {
      return this.cachedGrokStrategy.strategy;
    }
    if (this.inFlightGrokStrategy) return this.inFlightGrokStrategy;

    this.inFlightGrokStrategy = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_STRATEGY } });
        const parsed = parseTavilyKeySelectionStrategy(row?.value, this.fallbackGrokStrategy);
        this.cachedGrokStrategy = { strategy: parsed, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return parsed;
      } catch {
        const fallback = this.cachedGrokStrategy?.strategy ?? this.fallbackGrokStrategy;
        this.cachedGrokStrategy = { strategy: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightGrokStrategy = null;
      }
    })();

    return this.inFlightGrokStrategy;
  }

  async setGrokKeySelectionStrategy(next: TavilyKeySelectionStrategy): Promise<TavilyKeySelectionStrategy> {
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_GROK_STRATEGY },
      create: { key: KEY_GROK_STRATEGY, value: next },
      update: { value: next }
    });
    this.cachedGrokStrategy = { strategy: next, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
    return next;
  }
}
