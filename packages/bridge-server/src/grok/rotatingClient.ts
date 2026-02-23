import { randomUUID } from 'node:crypto';

import type { BraveClient, GrokSearchClient, SearchSourceMode, TavilyClient } from '@mcp-nexus/core';
import type { PrismaClient } from '@mcp-nexus/db';

import { GrokKeyPool } from './keyPool.js';
import { GrokUpstreamError, isGrokUpstreamError } from './errors.js';
import { createGrokHttpClient, type GrokSource } from './httpClient.js';
import { GrokSessionCache } from './sessionCache.js';
import { logGrokToolUsage } from './usageLog.js';

type SearchEnrichmentResult = {
  sources: GrokSource[];
  degradedProviders: string[];
};

const DEFAULT_GROK_API_URL = 'https://api.x.ai/v1';

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function toCanonicalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.hash = '';
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    const entries = [...url.searchParams.entries()]
      .filter(([k]) => !k.toLowerCase().startsWith('utm_'))
      .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)));
    url.search = '';
    for (const [k, v] of entries) {
      url.searchParams.append(k, v);
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

function mergeSources(primary: GrokSource[], extra: GrokSource[], maxResults?: number): GrokSource[] {
  const seen = new Set<string>();
  const merged: GrokSource[] = [];
  for (const item of [...primary, ...extra]) {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url) continue;
    const canonical = toCanonicalUrl(url);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    merged.push({
      url,
      title: item.title,
      description: item.description,
      provider: item.provider
    });
    if (typeof maxResults === 'number' && maxResults > 0 && merged.length >= maxResults) {
      break;
    }
  }
  return merged;
}

function extractBraveWebResults(raw: unknown): GrokSource[] {
  const results = (raw as any)?.web?.results ?? (raw as any)?.results ?? [];
  if (!Array.isArray(results)) return [];
  return results
    .map((r: any) => ({
      url: String(r?.url ?? '').trim(),
      title: typeof r?.title === 'string' ? r.title : undefined,
      description: typeof r?.description === 'string' ? r.description : undefined,
      provider: 'brave'
    }))
    .filter((r: GrokSource) => Boolean(r.url));
}

function extractTavilyResults(raw: unknown): GrokSource[] {
  const results = (raw as any)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r: any) => ({
      url: String(r?.url ?? '').trim(),
      title: typeof r?.title === 'string' ? r.title : undefined,
      description:
        typeof r?.content === 'string'
          ? r.content
          : typeof r?.raw_content === 'string'
            ? r.raw_content
            : undefined,
      provider: 'tavily'
    }))
    .filter((r: GrokSource) => Boolean(r.url));
}

async function firecrawlScrape(url: string, timeoutMs: number): Promise<string | null> {
  const apiKey = (process.env.FIRECRAWL_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const endpoint = `${(process.env.FIRECRAWL_API_URL ?? 'https://api.firecrawl.dev/v1').replace(/\/+$/, '')}/scrape`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        timeout: timeoutMs
      }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const body = await response.json() as any;
    const markdown = body?.data?.markdown;
    return typeof markdown === 'string' && markdown.trim() ? markdown : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function firecrawlSearch(query: string, limit: number): Promise<GrokSource[]> {
  const apiKey = (process.env.FIRECRAWL_API_KEY ?? '').trim();
  if (!apiKey) return [];

  const endpoint = `${(process.env.FIRECRAWL_API_URL ?? 'https://api.firecrawl.dev/v1').replace(/\/+$/, '')}/search`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, limit: clamp(limit, 1, 20) })
    });
    if (!response.ok) return [];
    const body = await response.json() as any;
    const items = body?.data?.web;
    if (!Array.isArray(items)) return [];
    return items
      .map((r: any) => ({
        url: String(r?.url ?? '').trim(),
        title: typeof r?.title === 'string' ? r.title : undefined,
        description: typeof r?.description === 'string' ? r.description : undefined,
        provider: 'firecrawl'
      }))
      .filter((r: GrokSource) => Boolean(r.url));
  } catch {
    return [];
  }
}

export class RotatingGrokClient implements GrokSearchClient {
  private readonly pool: GrokKeyPool;
  private readonly prisma: PrismaClient;
  private readonly tavilyClient: TavilyClient;
  private readonly braveClient: BraveClient | undefined;
  private readonly maxRetries: number;
  private readonly fixedCooldownMs: number;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly sessionCache: GrokSessionCache;

  constructor(opts: {
    pool: GrokKeyPool;
    prisma: PrismaClient;
    tavilyClient: TavilyClient;
    braveClient?: BraveClient;
    maxRetries?: number;
    fixedCooldownMs?: number;
    timeoutMs?: number;
    baseUrl?: string;
    sessionCache?: GrokSessionCache;
  }) {
    this.pool = opts.pool;
    this.prisma = opts.prisma;
    this.tavilyClient = opts.tavilyClient;
    this.braveClient = opts.braveClient;
    this.maxRetries = clamp(opts.maxRetries ?? Number(process.env.GROK_MAX_RETRIES ?? '2'), 0, 6);
    this.fixedCooldownMs = Math.max(1000, opts.fixedCooldownMs ?? Number(process.env.GROK_COOLDOWN_MS ?? String(60_000)));
    this.timeoutMs = Math.max(1000, opts.timeoutMs ?? Number(process.env.GROK_HTTP_TIMEOUT_MS ?? '20000'));
    this.baseUrl = (opts.baseUrl ?? process.env.GROK_API_URL ?? DEFAULT_GROK_API_URL).replace(/\/+$/, '');
    this.sessionCache = opts.sessionCache ?? new GrokSessionCache();
  }

  async webSearch(
    params: Record<string, unknown>,
    opts?: { sourceMode?: SearchSourceMode; modelDefault?: string; extraSourcesDefault?: number }
  ): Promise<unknown> {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (!query) {
      throw new GrokUpstreamError('query is required', { status: 400 });
    }

    const sourceMode = opts?.sourceMode ?? 'combined';
    const model = typeof params.model === 'string' && params.model.trim()
      ? params.model.trim()
      : (opts?.modelDefault ?? process.env.GROK_MODEL_DEFAULT ?? 'grok-4-latest');
    const platform = typeof params.platform === 'string' && params.platform.trim() ? params.platform.trim() : undefined;
    const maxResults = typeof params.max_results === 'number' ? clamp(params.max_results, 1, 50) : undefined;
    const defaultExtra = clamp(opts?.extraSourcesDefault ?? Number(process.env.GROK_EXTRA_SOURCES_DEFAULT ?? '0'), 0, 20);
    const extraSources = typeof params.extra_sources === 'number'
      ? clamp(params.extra_sources, 0, 20)
      : defaultExtra;

    const primary = await this.withRotation(
      {
        toolName: 'web_search',
        query,
        argsSummary: { model, platform, sourceMode, extraSources, maxResults }
      },
      async (client) => await client.search({ query, platform, model })
    );

    const enrichment = await this.loadSupplementarySources({
      query,
      sourceMode,
      maxResults,
      extraSources
    });

    const mergedSources = mergeSources(primary.result.sources, enrichment.sources, maxResults);
    const sessionId = randomUUID();
    this.sessionCache.set(sessionId, mergedSources);

    return {
      session_id: sessionId,
      content: primary.result.content,
      sources_count: mergedSources.length,
      metadata: {
        source_mode: sourceMode,
        degraded: enrichment.degradedProviders.length > 0,
        degraded_providers: enrichment.degradedProviders
      }
    };
  }

  async getSources(params: Record<string, unknown>): Promise<unknown> {
    const startedAt = Date.now();
    const sessionId = typeof params.session_id === 'string' ? params.session_id : '';
    const sources = this.sessionCache.get(sessionId);
    if (!sessionId || !sources) {
      await logGrokToolUsage(this.prisma, {
        toolName: 'get_sources',
        outcome: 'error',
        latencyMs: Date.now() - startedAt,
        argsSummary: { sessionIdProvided: Boolean(sessionId) },
        errorMessage: 'session_id_not_found_or_expired'
      }).catch(() => {});
      return {
        session_id: sessionId,
        sources: [],
        sources_count: 0,
        error: 'session_id_not_found_or_expired'
      };
    }

    await logGrokToolUsage(this.prisma, {
      toolName: 'get_sources',
      outcome: 'success',
      latencyMs: Date.now() - startedAt,
      argsSummary: { sourcesCount: sources.length }
    }).catch(() => {});

    return {
      session_id: sessionId,
      sources,
      sources_count: sources.length
    };
  }

  async webFetch(params: Record<string, unknown>): Promise<unknown> {
    const startedAt = Date.now();
    const url = typeof params.url === 'string' ? params.url.trim() : '';
    if (!url) {
      throw new GrokUpstreamError('url is required', { status: 400 });
    }

    try {
      const extracted = await this.tavilyClient.extract({
        urls: [url],
        format: 'markdown',
        extract_depth: 'advanced'
      });
      const content = (extracted as any)?.results?.[0]?.raw_content;
      if (typeof content === 'string' && content.trim()) {
        await logGrokToolUsage(this.prisma, {
          toolName: 'web_fetch',
          outcome: 'success',
          latencyMs: Date.now() - startedAt,
          query: url,
          argsSummary: { provider: 'tavily' }
        }).catch(() => {});
        return { url, content, provider: 'tavily' };
      }
    } catch {
      // fallback below
    }

    const timeoutMs = typeof params.timeout_ms === 'number' ? clamp(params.timeout_ms, 1000, 120000) : this.timeoutMs;
    const firecrawlContent = await firecrawlScrape(url, timeoutMs);
    if (firecrawlContent) {
      await logGrokToolUsage(this.prisma, {
        toolName: 'web_fetch',
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
        query: url,
        argsSummary: { provider: 'firecrawl' }
      }).catch(() => {});
      return { url, content: firecrawlContent, provider: 'firecrawl' };
    }

    await logGrokToolUsage(this.prisma, {
      toolName: 'web_fetch',
      outcome: 'error',
      latencyMs: Date.now() - startedAt,
      query: url,
      errorMessage: 'Failed to fetch page content from Tavily and Firecrawl'
    }).catch(() => {});

    throw new GrokUpstreamError('Failed to fetch page content', { status: 502 });
  }

  async webMap(params: Record<string, unknown>): Promise<unknown> {
    const startedAt = Date.now();
    const url = typeof params.url === 'string' ? params.url.trim() : '';
    if (!url) throw new GrokUpstreamError('url is required', { status: 400 });

    try {
      const result = await this.tavilyClient.map({
        url,
        max_depth: typeof params.max_depth === 'number' ? clamp(params.max_depth, 1, 5) : 1,
        max_breadth: typeof params.max_breadth === 'number' ? clamp(params.max_breadth, 1, 500) : 20,
        limit: typeof params.limit === 'number' ? clamp(params.limit, 1, 500) : 50,
        instructions: typeof params.instructions === 'string' ? params.instructions : undefined
      });
      await logGrokToolUsage(this.prisma, {
        toolName: 'web_map',
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
        query: url,
        argsSummary: { limit: (params as any).limit, max_depth: (params as any).max_depth }
      }).catch(() => {});
      return result;
    } catch (error: unknown) {
      await logGrokToolUsage(this.prisma, {
        toolName: 'web_map',
        outcome: 'error',
        latencyMs: Date.now() - startedAt,
        query: url,
        argsSummary: { limit: (params as any).limit, max_depth: (params as any).max_depth },
        errorMessage: error instanceof Error ? error.message : String(error)
      }).catch(() => {});
      throw error;
    }
  }

  async preflightEligible(): Promise<{ ok: true } | { ok: false; retryAfterMs?: number; error: string }> {
    return await this.pool.preflightEligible();
  }

  private async withRotation<T>(
    meta: { toolName: string; query?: string; argsSummary?: Record<string, unknown> },
    fn: (client: ReturnType<typeof createGrokHttpClient>) => Promise<T>
  ): Promise<{ result: T; upstreamKeyId: string }> {
    let attempt = 0;
    let lastError: unknown = null;
    let lastKeyId: string | null = null;

    while (attempt <= this.maxRetries) {
      attempt += 1;
      const key = await this.pool.selectEligibleKey();
      if (!key) {
        const err = new GrokUpstreamError('No Grok API keys available', { status: 503 });
        await logGrokToolUsage(this.prisma, {
          toolName: meta.toolName,
          upstreamKeyId: null,
          outcome: 'error',
          query: meta.query,
          argsSummary: { ...(meta.argsSummary ?? {}), attempts: attempt },
          errorMessage: err.message
        }).catch(() => {});
        throw err;
      }

      lastKeyId = key.id;
      const client = createGrokHttpClient({
        apiKey: key.apiKey,
        baseUrl: this.baseUrl,
        timeoutMs: this.timeoutMs
      });

      const startedAt = Date.now();
      try {
        const result = await fn(client);
        await logGrokToolUsage(this.prisma, {
          toolName: meta.toolName,
          upstreamKeyId: key.id,
          outcome: 'success',
          latencyMs: Date.now() - startedAt,
          query: meta.query,
          argsSummary: { ...(meta.argsSummary ?? {}), attempts: attempt }
        }).catch(() => {});
        return { result, upstreamKeyId: key.id };
      } catch (error: unknown) {
        lastError = error;
        if (isGrokUpstreamError(error)) {
          if (error.status === 401 || error.status === 403) {
            await this.pool.markInvalid(key.id);
            continue;
          }
          if (error.status === 429) {
            const cooldownMs = Math.max(1000, error.retryAfterMs ?? this.fixedCooldownMs);
            await this.pool.markCooldown(key.id, new Date(Date.now() + cooldownMs));
            continue;
          }
          if (error.status >= 500 && attempt <= this.maxRetries) {
            continue;
          }
        }
        break;
      }
    }

    const finalError = lastError instanceof Error
      ? lastError
      : new GrokUpstreamError('Grok request failed', { status: 502 });
    await logGrokToolUsage(this.prisma, {
      toolName: meta.toolName,
      upstreamKeyId: lastKeyId,
      outcome: 'error',
      query: meta.query,
      argsSummary: { ...(meta.argsSummary ?? {}), attempts: attempt },
      errorMessage: finalError.message
    }).catch(() => {});
    throw finalError;
  }

  private async loadSupplementarySources(input: {
    query: string;
    sourceMode: SearchSourceMode;
    extraSources: number;
    maxResults?: number;
  }): Promise<SearchEnrichmentResult> {
    if (input.extraSources <= 0) return { sources: [], degradedProviders: [] };

    const perProviderLimit = clamp(Math.max(1, Math.ceil(input.extraSources / 2)), 1, 20);
    const degradedProviders: string[] = [];

    const tavilyCall = async (): Promise<GrokSource[]> => {
      const res = await this.tavilyClient.search(
        { query: input.query, max_results: perProviderLimit, search_depth: 'advanced' },
        { defaults: {} }
      );
      return extractTavilyResults(res);
    };

    const braveCall = async (): Promise<GrokSource[]> => {
      if (!this.braveClient) return [];
      const res = await this.braveClient.webSearch({ query: input.query, count: perProviderLimit });
      return extractBraveWebResults(res);
    };

    if (input.sourceMode === 'tavily_only') {
      try {
        return { sources: (await tavilyCall()).slice(0, input.extraSources), degradedProviders };
      } catch {
        return { sources: [], degradedProviders: ['tavily'] };
      }
    }

    if (input.sourceMode === 'brave_only') {
      try {
        return { sources: (await braveCall()).slice(0, input.extraSources), degradedProviders };
      } catch {
        return { sources: [], degradedProviders: ['brave'] };
      }
    }

    if (input.sourceMode === 'combined') {
      const [tavilyRes, braveRes, firecrawlRes] = await Promise.allSettled([
        tavilyCall(),
        braveCall(),
        firecrawlSearch(input.query, perProviderLimit)
      ]);

      const tavilySources = tavilyRes.status === 'fulfilled' ? tavilyRes.value : [];
      const braveSources = braveRes.status === 'fulfilled' ? braveRes.value : [];
      const firecrawlSources = firecrawlRes.status === 'fulfilled' ? firecrawlRes.value : [];

      if (tavilyRes.status === 'rejected') degradedProviders.push('tavily');
      if (braveRes.status === 'rejected') degradedProviders.push('brave');
      if (firecrawlRes.status === 'rejected') degradedProviders.push('firecrawl');

      return {
        sources: mergeSources(
          mergeSources(tavilySources, braveSources),
          firecrawlSources,
          input.extraSources
        ),
        degradedProviders
      };
    }

    // brave_prefer_tavily_fallback
    try {
      const braveSources = await braveCall();
      if (braveSources.length > 0) {
        const tavilySources = await tavilyCall().catch(() => {
          degradedProviders.push('tavily');
          return [];
        });
        return {
          sources: mergeSources(braveSources, tavilySources, input.extraSources),
          degradedProviders
        };
      }
      const tavilySources = await tavilyCall();
      return { sources: tavilySources.slice(0, input.extraSources), degradedProviders };
    } catch {
      degradedProviders.push('brave');
      try {
        return { sources: (await tavilyCall()).slice(0, input.extraSources), degradedProviders };
      } catch {
        degradedProviders.push('tavily');
        return { sources: [], degradedProviders };
      }
    }
  }
}

