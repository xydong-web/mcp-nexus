import type { PrismaClient } from '@mcp-nexus/db';
import { parseTavilyKeySelectionStrategy, parseSearchSourceMode, type TavilyKeySelectionStrategy, type SearchSourceMode } from '@mcp-nexus/core';
import { decryptAes256Gcm, encryptAes256Gcm } from '../crypto/crypto.js';

const REFRESH_MS = Number(process.env.SERVER_SETTINGS_REFRESH_MS ?? '5000');
const KEY_TAVILY_STRATEGY = 'tavilyKeySelectionStrategy';
const KEY_SEARCH_SOURCE_MODE = 'searchSourceMode';
const KEY_RESEARCH_ENABLED = 'researchEnabled';
const KEY_GROK_SEARCH_ENABLED = 'grokSearchEnabled';
const KEY_GROK_MODEL_DEFAULT = 'grokModelDefault';
const KEY_GROK_EXTRA_SOURCES_DEFAULT = 'grokExtraSourcesDefault';
const KEY_GROK_SOURCE_MODE = 'grokSearchSourceMode';
const KEY_GROK_STRATEGY = 'grokKeySelectionStrategy';
const KEY_GROK_PROVIDER_BASE_URL = 'grokProviderBaseUrl';
const KEY_GROK_PROVIDER_API_KEY_ENCRYPTED = 'grokProviderApiKeyEncrypted';
const KEY_GROK_PROVIDER_API_KEY_MASKED = 'grokProviderApiKeyMasked';
const KEY_REGISTRATION_AUTOMATION_ENABLED = 'registrationAutomationEnabled';
const DEFAULT_GROK_PROVIDER_BASE_URL = 'https://api.x.ai/v1';

type GrokProviderSource = 'database' | 'env' | 'none';

export type GrokProviderPublicConfig = {
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string | null;
  source: GrokProviderSource;
};

export type GrokProviderRuntimeConfig = {
  baseUrl: string;
  apiKey: string | null;
  source: GrokProviderSource;
};

function clampExtraSources(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

function maskGrokProviderApiKey(apiKey: string): string {
  const raw = apiKey.trim();
  if (!raw) return '';
  if (raw.length <= 10) {
    const start = raw.slice(0, Math.min(3, raw.length));
    const end = raw.slice(Math.max(0, raw.length - 2));
    return `${start}...${end}`;
  }
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function normalizeBaseUrlWithFallback(raw: string | null | undefined, fallback: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function normalizeExplicitBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('grokProviderBaseUrl must use http:// or https://');
  }
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
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
  private readonly fallbackGrokProviderBaseUrl: string;
  private readonly fallbackGrokProviderApiKey: string | null;
  private readonly fallbackRegistrationAutomationEnabled: boolean;
  private readonly encryptionKey: Buffer | null;
  private cached: { strategy: TavilyKeySelectionStrategy; expiresAtMs: number } | null = null;
  private cachedSearchSourceMode: { mode: SearchSourceMode; expiresAtMs: number } | null = null;
  private cachedResearchEnabled: { enabled: boolean; expiresAtMs: number } | null = null;
  private cachedGrokSearchEnabled: { enabled: boolean; expiresAtMs: number } | null = null;
  private cachedGrokModelDefault: { model: string; expiresAtMs: number } | null = null;
  private cachedGrokExtraSourcesDefault: { value: number; expiresAtMs: number } | null = null;
  private cachedGrokSourceMode: { mode: SearchSourceMode; expiresAtMs: number } | null = null;
  private cachedGrokStrategy: { strategy: TavilyKeySelectionStrategy; expiresAtMs: number } | null = null;
  private cachedGrokProvider: { config: GrokProviderRuntimeConfig & { apiKeyMasked: string | null; apiKeyConfigured: boolean }; expiresAtMs: number } | null = null;
  private cachedRegistrationAutomationEnabled: { enabled: boolean; expiresAtMs: number } | null = null;
  private inFlight: Promise<TavilyKeySelectionStrategy> | null = null;
  private inFlightSearchSourceMode: Promise<SearchSourceMode> | null = null;
  private inFlightResearchEnabled: Promise<boolean> | null = null;
  private inFlightGrokSearchEnabled: Promise<boolean> | null = null;
  private inFlightGrokModelDefault: Promise<string> | null = null;
  private inFlightGrokExtraSourcesDefault: Promise<number> | null = null;
  private inFlightGrokSourceMode: Promise<SearchSourceMode> | null = null;
  private inFlightGrokStrategy: Promise<TavilyKeySelectionStrategy> | null = null;
  private inFlightGrokProvider: Promise<GrokProviderRuntimeConfig & { apiKeyMasked: string | null; apiKeyConfigured: boolean }> | null = null;
  private inFlightRegistrationAutomationEnabled: Promise<boolean> | null = null;

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
    fallbackGrokProviderBaseUrl?: string;
    fallbackGrokProviderApiKey?: string | null;
    fallbackRegistrationAutomationEnabled?: boolean;
    encryptionKey?: Buffer;
  }) {
    this.prisma = opts.prisma;
    this.fallbackStrategy = opts.fallbackStrategy;
    this.fallbackSearchSourceMode = opts.fallbackSearchSourceMode ?? 'brave_prefer_tavily_fallback';
    this.fallbackResearchEnabled = opts.fallbackResearchEnabled ?? true;
    this.fallbackGrokSearchEnabled = opts.fallbackGrokSearchEnabled ?? (process.env.GROK_SEARCH_ENABLED === 'true');
    this.fallbackGrokModelDefault = (opts.fallbackGrokModelDefault ?? process.env.GROK_MODEL_DEFAULT ?? 'grok-4.2-beta').trim() || 'grok-4.2-beta';
    this.fallbackGrokExtraSourcesDefault = clampExtraSources(
      opts.fallbackGrokExtraSourcesDefault ?? Number(process.env.GROK_EXTRA_SOURCES_DEFAULT ?? '0')
    );
    this.fallbackGrokSearchSourceMode =
      opts.fallbackGrokSearchSourceMode ?? parseSearchSourceMode(process.env.GROK_SEARCH_SOURCE_MODE, 'combined');
    this.fallbackGrokStrategy = opts.fallbackGrokStrategy ?? opts.fallbackStrategy;
    this.fallbackGrokProviderBaseUrl = normalizeBaseUrlWithFallback(
      opts.fallbackGrokProviderBaseUrl ?? process.env.GROK_API_URL ?? DEFAULT_GROK_PROVIDER_BASE_URL,
      DEFAULT_GROK_PROVIDER_BASE_URL
    );
    const fallbackProviderApiKey = (opts.fallbackGrokProviderApiKey ?? process.env.GROK_API_KEY ?? '').trim();
    this.fallbackGrokProviderApiKey = fallbackProviderApiKey || null;
    this.encryptionKey = opts.encryptionKey ?? null;
    this.fallbackRegistrationAutomationEnabled =
      opts.fallbackRegistrationAutomationEnabled ?? (process.env.REGISTRATION_AUTOMATION_ENABLED === 'true');
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

  async getRegistrationAutomationEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.cachedRegistrationAutomationEnabled && now < this.cachedRegistrationAutomationEnabled.expiresAtMs) {
      return this.cachedRegistrationAutomationEnabled.enabled;
    }
    if (this.inFlightRegistrationAutomationEnabled) return this.inFlightRegistrationAutomationEnabled;

    this.inFlightRegistrationAutomationEnabled = (async () => {
      try {
        const row = await this.prisma.serverSetting.findUnique({ where: { key: KEY_REGISTRATION_AUTOMATION_ENABLED } });
        const enabled = row?.value === 'true'
          ? true
          : row?.value === 'false'
            ? false
            : this.fallbackRegistrationAutomationEnabled;
        this.cachedRegistrationAutomationEnabled = { enabled, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return enabled;
      } catch {
        const fallback = this.cachedRegistrationAutomationEnabled?.enabled ?? this.fallbackRegistrationAutomationEnabled;
        this.cachedRegistrationAutomationEnabled = { enabled: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightRegistrationAutomationEnabled = null;
      }
    })();

    return this.inFlightRegistrationAutomationEnabled;
  }

  async setRegistrationAutomationEnabled(next: boolean): Promise<boolean> {
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_REGISTRATION_AUTOMATION_ENABLED },
      create: { key: KEY_REGISTRATION_AUTOMATION_ENABLED, value: String(next) },
      update: { value: String(next) }
    });
    this.cachedRegistrationAutomationEnabled = { enabled: next, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
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

  private invalidateGrokProviderCache(): void {
    this.cachedGrokProvider = null;
    this.inFlightGrokProvider = null;
  }

  private async readGrokProviderConfig(): Promise<GrokProviderRuntimeConfig & { apiKeyConfigured: boolean; apiKeyMasked: string | null }> {
    const [baseUrlRow, keyEncryptedRow, keyMaskedRow] = await this.prisma.$transaction([
      this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_PROVIDER_BASE_URL } }),
      this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_PROVIDER_API_KEY_ENCRYPTED } }),
      this.prisma.serverSetting.findUnique({ where: { key: KEY_GROK_PROVIDER_API_KEY_MASKED } })
    ]);

    const baseUrl = normalizeBaseUrlWithFallback(baseUrlRow?.value, this.fallbackGrokProviderBaseUrl);
    const encryptedValue = keyEncryptedRow?.value?.trim() ?? '';
    const maskedValue = keyMaskedRow?.value?.trim() || null;
    if (encryptedValue) {
      if (!this.encryptionKey) {
        return {
          baseUrl,
          apiKey: null,
          apiKeyConfigured: true,
          apiKeyMasked: maskedValue,
          source: 'database'
        };
      }
      try {
        const decrypted = decryptAes256Gcm(Buffer.from(encryptedValue, 'base64'), this.encryptionKey).trim();
        if (decrypted) {
          return {
            baseUrl,
            apiKey: decrypted,
            apiKeyConfigured: true,
            apiKeyMasked: maskedValue ?? maskGrokProviderApiKey(decrypted),
            source: 'database'
          };
        }
      } catch {
        // fall back to env below
      }
    }

    if (this.fallbackGrokProviderApiKey) {
      return {
        baseUrl,
        apiKey: this.fallbackGrokProviderApiKey,
        apiKeyConfigured: true,
        apiKeyMasked: maskGrokProviderApiKey(this.fallbackGrokProviderApiKey),
        source: 'env'
      };
    }

    return {
      baseUrl,
      apiKey: null,
      apiKeyConfigured: false,
      apiKeyMasked: null,
      source: 'none'
    };
  }

  private async getGrokProviderResolved(): Promise<GrokProviderRuntimeConfig & { apiKeyConfigured: boolean; apiKeyMasked: string | null }> {
    const now = Date.now();
    if (this.cachedGrokProvider && now < this.cachedGrokProvider.expiresAtMs) {
      return this.cachedGrokProvider.config;
    }
    if (this.inFlightGrokProvider) return this.inFlightGrokProvider;

    this.inFlightGrokProvider = (async () => {
      try {
        const config = await this.readGrokProviderConfig();
        this.cachedGrokProvider = { config, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return config;
      } catch {
        const fallbackApiKey = this.fallbackGrokProviderApiKey;
        const fallback: GrokProviderRuntimeConfig & { apiKeyConfigured: boolean; apiKeyMasked: string | null } = {
          baseUrl: this.fallbackGrokProviderBaseUrl,
          apiKey: fallbackApiKey,
          apiKeyConfigured: Boolean(fallbackApiKey),
          apiKeyMasked: fallbackApiKey ? maskGrokProviderApiKey(fallbackApiKey) : null,
          source: fallbackApiKey ? 'env' : 'none'
        };
        this.cachedGrokProvider = { config: fallback, expiresAtMs: Date.now() + Math.max(250, REFRESH_MS) };
        return fallback;
      } finally {
        this.inFlightGrokProvider = null;
      }
    })();

    return this.inFlightGrokProvider;
  }

  async getGrokProviderPublicConfig(): Promise<GrokProviderPublicConfig> {
    const resolved = await this.getGrokProviderResolved();
    return {
      baseUrl: resolved.baseUrl,
      apiKeyConfigured: resolved.apiKeyConfigured,
      apiKeyMasked: resolved.apiKeyMasked,
      source: resolved.source
    };
  }

  async getGrokProviderRuntimeConfig(): Promise<GrokProviderRuntimeConfig> {
    const resolved = await this.getGrokProviderResolved();
    return {
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      source: resolved.source
    };
  }

  async setGrokProviderBaseUrl(next: string): Promise<string> {
    const trimmed = next.trim();
    if (!trimmed) {
      await this.prisma.serverSetting.deleteMany({
        where: { key: KEY_GROK_PROVIDER_BASE_URL }
      });
      this.invalidateGrokProviderCache();
      return this.fallbackGrokProviderBaseUrl;
    }
    const normalized = normalizeExplicitBaseUrl(trimmed);
    await this.prisma.serverSetting.upsert({
      where: { key: KEY_GROK_PROVIDER_BASE_URL },
      create: { key: KEY_GROK_PROVIDER_BASE_URL, value: normalized },
      update: { value: normalized }
    });
    this.invalidateGrokProviderCache();
    return normalized;
  }

  async setGrokProviderApiKey(next: string): Promise<{ configured: boolean; maskedKey: string }> {
    if (!this.encryptionKey) {
      throw new Error('KEY_ENCRYPTION_SECRET is required to store Grok provider API key');
    }
    const normalized = next.trim();
    if (!normalized) {
      throw new Error('grokProviderApiKey must be a non-empty string');
    }
    const encrypted = encryptAes256Gcm(normalized, this.encryptionKey);
    const encryptedB64 = Buffer.from(encrypted).toString('base64');
    const masked = maskGrokProviderApiKey(normalized);

    await this.prisma.$transaction([
      this.prisma.serverSetting.upsert({
        where: { key: KEY_GROK_PROVIDER_API_KEY_ENCRYPTED },
        create: { key: KEY_GROK_PROVIDER_API_KEY_ENCRYPTED, value: encryptedB64 },
        update: { value: encryptedB64 }
      }),
      this.prisma.serverSetting.upsert({
        where: { key: KEY_GROK_PROVIDER_API_KEY_MASKED },
        create: { key: KEY_GROK_PROVIDER_API_KEY_MASKED, value: masked },
        update: { value: masked }
      })
    ]);
    this.invalidateGrokProviderCache();
    return { configured: true, maskedKey: masked };
  }

  async clearGrokProviderApiKey(): Promise<void> {
    await this.prisma.serverSetting.deleteMany({
      where: {
        key: {
          in: [KEY_GROK_PROVIDER_API_KEY_ENCRYPTED, KEY_GROK_PROVIDER_API_KEY_MASKED]
        }
      }
    });
    this.invalidateGrokProviderCache();
  }
}
