import type { SearchSourceMode } from '../mcp/searchSource.js';
import { braveWebSearch } from './braveClient.js';
import { tavilyExtract, tavilyMap, tavilySearch } from './tavilyClient.js';

export class GrokError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, opts: { status: number; retryAfterMs?: number }) {
    super(message);
    this.name = 'GrokError';
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export type GrokSource = {
  url: string;
  title?: string;
  description?: string;
  provider?: string;
};

const DEFAULT_GROK_API_URL = 'https://api.x.ai/v1';
const DEFAULT_FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1';

type SessionEntry = {
  expiresAtMs: number;
  sources: GrokSource[];
};

const sessionStore = new Map<string, SessionEntry>();
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_MAX_ENTRIES = 512;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseRetryAfterMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec > 0) return Math.floor(sec * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function parseJson(text: string): any {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

function extractMessage(body: any, fallback: string): string {
  if (typeof body?.error === 'string' && body.error) return body.error;
  if (typeof body?.error?.message === 'string' && body.error.message) return body.error.message;
  if (typeof body?.message === 'string' && body.message) return body.message;
  return fallback;
}

function extractGrokContent(body: any): string {
  if (typeof body?.content === 'string') return body.content;
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const messageContent = choices[0]?.message?.content;
  if (typeof messageContent === 'string') return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractGrokSources(body: any): GrokSource[] {
  const sources: GrokSource[] = [];
  const seen = new Set<string>();

  const add = (item: any, provider: string) => {
    const rawUrl = typeof item?.url === 'string' ? item.url : typeof item === 'string' ? item : '';
    const url = rawUrl.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({
      url,
      title: typeof item?.title === 'string' ? item.title : undefined,
      description: typeof item?.description === 'string' ? item.description : undefined,
      provider
    });
  };

  const bodySources = Array.isArray(body?.sources) ? body.sources : [];
  for (const item of bodySources) add(item, 'grok');

  const citations = Array.isArray(body?.citations) ? body.citations : [];
  for (const item of citations) add(item, 'grok');

  return sources;
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
  const out: GrokSource[] = [];

  for (const item of [...primary, ...extra]) {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url) continue;
    const canonical = toCanonicalUrl(url);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({
      url,
      title: item.title,
      description: item.description,
      provider: item.provider
    });

    if (typeof maxResults === 'number' && maxResults > 0 && out.length >= maxResults) {
      break;
    }
  }

  return out;
}

function normalizeSources(items: unknown, provider: 'tavily' | 'brave' | 'firecrawl'): GrokSource[] {
  if (!Array.isArray(items)) return [];

  if (provider === 'tavily') {
    return items
      .map((item: any) => ({
        url: String(item?.url ?? '').trim(),
        title: typeof item?.title === 'string' ? item.title : undefined,
        description: typeof item?.content === 'string'
          ? item.content
          : typeof item?.raw_content === 'string'
            ? item.raw_content
            : undefined,
        provider
      }))
      .filter((item: GrokSource) => Boolean(item.url));
  }

  if (provider === 'brave') {
    return items
      .map((item: any) => ({
        url: String(item?.url ?? '').trim(),
        title: typeof item?.title === 'string' ? item.title : undefined,
        description: typeof item?.description === 'string' ? item.description : undefined,
        provider
      }))
      .filter((item: GrokSource) => Boolean(item.url));
  }

  return items
    .map((item: any) => ({
      url: String(item?.url ?? '').trim(),
      title: typeof item?.title === 'string' ? item.title : undefined,
      description: typeof item?.description === 'string' ? item.description : undefined,
      provider
    }))
    .filter((item: GrokSource) => Boolean(item.url));
}

function cleanupSessions(now = Date.now()): void {
  for (const [id, entry] of sessionStore) {
    if (entry.expiresAtMs <= now) {
      sessionStore.delete(id);
    }
  }
}

function cacheSessionSources(sources: GrokSource[]): string {
  const now = Date.now();
  cleanupSessions(now);

  const sessionId = crypto.randomUUID();
  sessionStore.set(sessionId, {
    expiresAtMs: now + SESSION_TTL_MS,
    sources
  });

  if (sessionStore.size > SESSION_MAX_ENTRIES) {
    const oldest = sessionStore.keys().next().value as string | undefined;
    if (oldest) sessionStore.delete(oldest);
  }

  return sessionId;
}

export function getCachedSessionSources(sessionId: string): GrokSource[] | null {
  if (!sessionId) return null;
  const now = Date.now();
  const entry = sessionStore.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAtMs <= now) {
    sessionStore.delete(sessionId);
    return null;
  }
  return entry.sources;
}

async function requestGrokSearch(opts: {
  apiKey: string;
  query: string;
  model: string;
  platform?: string;
  apiUrl?: string;
  timeoutMs?: number;
}): Promise<{ content: string; sources: GrokSource[]; raw: unknown }> {
  const prompt = opts.platform ? `${opts.query}\n\nFocus platform: ${opts.platform}` : opts.query;
  const baseUrl = (opts.apiUrl ?? DEFAULT_GROK_API_URL).replace(/\/+$/, '');
  const timeoutMs = Math.max(1_000, Math.floor(opts.timeoutMs ?? 20_000));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      }),
      signal: controller.signal
    });

    const text = await response.text();
    const body = parseJson(text);

    if (!response.ok) {
      throw new GrokError(
        extractMessage(body, response.statusText || `HTTP ${response.status}`),
        { status: response.status, retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')) }
      );
    }

    return {
      content: extractGrokContent(body),
      sources: extractGrokSources(body),
      raw: body
    };
  } catch (error: unknown) {
    if (error instanceof GrokError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GrokError('Grok request timed out', { status: 504 });
    }
    throw new GrokError(error instanceof Error ? error.message : 'Grok request failed', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function firecrawlSearch(opts: {
  query: string;
  apiKey?: string;
  apiUrl?: string;
  limit: number;
}): Promise<GrokSource[]> {
  const apiKey = (opts.apiKey ?? '').trim();
  if (!apiKey) return [];

  const endpoint = `${(opts.apiUrl ?? DEFAULT_FIRECRAWL_API_URL).replace(/\/+$/, '')}/search`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: opts.query, limit: clamp(opts.limit, 1, 20) })
  });

  if (!response.ok) {
    throw new Error(`firecrawl_search_failed_${response.status}`);
  }

  const body = parseJson(await response.text());
  return normalizeSources(body?.data?.web, 'firecrawl');
}

async function firecrawlScrape(opts: {
  url: string;
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const apiKey = (opts.apiKey ?? '').trim();
  if (!apiKey) return null;

  const endpoint = `${(opts.apiUrl ?? DEFAULT_FIRECRAWL_API_URL).replace(/\/+$/, '')}/scrape`;
  const timeoutMs = clamp(opts.timeoutMs ?? 20_000, 1_000, 120_000);

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
        url: opts.url,
        formats: ['markdown'],
        timeout: timeoutMs
      }),
      signal: controller.signal
    });

    if (!response.ok) return null;
    const body = parseJson(await response.text());
    const markdown = body?.data?.markdown;
    return typeof markdown === 'string' && markdown.trim() ? markdown : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function grokWebSearch(params: Record<string, unknown>, opts: {
  apiKey: string;
  sourceMode: SearchSourceMode;
  modelDefault: string;
  extraSourcesDefault: number;
  tavilyApiKey?: string;
  braveApiKey?: string;
  grokApiUrl?: string;
  grokTimeoutMs?: number;
  firecrawlApiKey?: string;
  firecrawlApiUrl?: string;
}): Promise<unknown> {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (!query) {
    throw new GrokError('query is required', { status: 400 });
  }

  const model = typeof params.model === 'string' && params.model.trim()
    ? params.model.trim()
    : opts.modelDefault;
  const platform = typeof params.platform === 'string' && params.platform.trim() ? params.platform.trim() : undefined;
  const maxResults = typeof params.max_results === 'number' ? clamp(params.max_results, 1, 50) : undefined;
  const extraSources = typeof params.extra_sources === 'number'
    ? clamp(params.extra_sources, 0, 20)
    : clamp(opts.extraSourcesDefault, 0, 20);

  const primary = await requestGrokSearch({
    apiKey: opts.apiKey,
    query,
    model,
    platform,
    apiUrl: opts.grokApiUrl,
    timeoutMs: opts.grokTimeoutMs
  });

  const degradedProviders: string[] = [];
  const perProviderLimit = clamp(Math.max(1, Math.ceil(extraSources / 2)), 1, 20);

  const getTavilySources = async (): Promise<GrokSource[]> => {
    if (!opts.tavilyApiKey) return [];
    const result = await tavilySearch(opts.tavilyApiKey, {
      query,
      max_results: perProviderLimit,
      search_depth: 'advanced'
    });
    return normalizeSources(result?.results, 'tavily');
  };

  const getBraveSources = async (): Promise<GrokSource[]> => {
    if (!opts.braveApiKey) return [];
    const result = await braveWebSearch(opts.braveApiKey, { query, count: perProviderLimit });
    return normalizeSources(result?.web?.results, 'brave');
  };

  let supplementalSources: GrokSource[] = [];

  if (extraSources > 0) {
    if (opts.sourceMode === 'tavily_only') {
      try {
        supplementalSources = (await getTavilySources()).slice(0, extraSources);
      } catch {
        degradedProviders.push('tavily');
      }
    } else if (opts.sourceMode === 'brave_only') {
      try {
        supplementalSources = (await getBraveSources()).slice(0, extraSources);
      } catch {
        degradedProviders.push('brave');
      }
    } else if (opts.sourceMode === 'combined') {
      const [tavilyRes, braveRes, firecrawlRes] = await Promise.allSettled([
        getTavilySources(),
        getBraveSources(),
        firecrawlSearch({ query, apiKey: opts.firecrawlApiKey, apiUrl: opts.firecrawlApiUrl, limit: perProviderLimit })
      ]);

      const tavilySources = tavilyRes.status === 'fulfilled' ? tavilyRes.value : [];
      const braveSources = braveRes.status === 'fulfilled' ? braveRes.value : [];
      const firecrawlSources = firecrawlRes.status === 'fulfilled' ? firecrawlRes.value : [];

      if (tavilyRes.status === 'rejected') degradedProviders.push('tavily');
      if (braveRes.status === 'rejected') degradedProviders.push('brave');
      if (firecrawlRes.status === 'rejected') degradedProviders.push('firecrawl');

      supplementalSources = mergeSources(
        mergeSources(tavilySources, braveSources),
        firecrawlSources,
        extraSources
      );
    } else {
      try {
        const braveSources = await getBraveSources();
        if (braveSources.length > 0) {
          const tavilySources = await getTavilySources().catch(() => {
            degradedProviders.push('tavily');
            return [];
          });
          supplementalSources = mergeSources(braveSources, tavilySources, extraSources);
        } else {
          supplementalSources = (await getTavilySources()).slice(0, extraSources);
        }
      } catch {
        degradedProviders.push('brave');
        try {
          supplementalSources = (await getTavilySources()).slice(0, extraSources);
        } catch {
          degradedProviders.push('tavily');
        }
      }
    }
  }

  const mergedSources = mergeSources(primary.sources, supplementalSources, maxResults);
  const sessionId = cacheSessionSources(mergedSources);

  return {
    session_id: sessionId,
    content: primary.content,
    sources_count: mergedSources.length,
    metadata: {
      source_mode: opts.sourceMode,
      degraded: degradedProviders.length > 0,
      degraded_providers: degradedProviders
    }
  };
}

export async function grokGetSources(params: Record<string, unknown>): Promise<unknown> {
  const sessionId = typeof params.session_id === 'string' ? params.session_id : '';
  const sources = getCachedSessionSources(sessionId);

  if (!sessionId || !sources) {
    return {
      session_id: sessionId,
      sources: [],
      sources_count: 0,
      error: 'session_id_not_found_or_expired'
    };
  }

  return {
    session_id: sessionId,
    sources,
    sources_count: sources.length
  };
}

export async function grokWebFetch(params: Record<string, unknown>, opts: {
  tavilyApiKey?: string;
  firecrawlApiKey?: string;
  firecrawlApiUrl?: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (!url) {
    throw new GrokError('url is required', { status: 400 });
  }

  if (opts.tavilyApiKey) {
    try {
      const result = await tavilyExtract(opts.tavilyApiKey, {
        urls: [url],
        format: 'markdown',
        extract_depth: 'advanced'
      });
      const content = result?.results?.[0]?.raw_content;
      if (typeof content === 'string' && content.trim()) {
        return { url, content, provider: 'tavily' };
      }
    } catch {
      // fallback below
    }
  }

  const timeoutMs = typeof params.timeout_ms === 'number' ? params.timeout_ms : opts.timeoutMs;
  const firecrawlContent = await firecrawlScrape({
    url,
    apiKey: opts.firecrawlApiKey,
    apiUrl: opts.firecrawlApiUrl,
    timeoutMs
  });

  if (firecrawlContent) {
    return { url, content: firecrawlContent, provider: 'firecrawl' };
  }

  throw new GrokError('Failed to fetch page content', { status: 502 });
}

export async function grokWebMap(params: Record<string, unknown>, opts: {
  tavilyApiKey?: string;
}): Promise<unknown> {
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (!url) {
    throw new GrokError('url is required', { status: 400 });
  }
  if (!opts.tavilyApiKey) {
    throw new GrokError('No Tavily API keys configured for web_map', { status: 503 });
  }

  return tavilyMap(opts.tavilyApiKey, {
    url,
    max_depth: typeof params.max_depth === 'number' ? clamp(params.max_depth, 1, 5) : 1,
    max_breadth: typeof params.max_breadth === 'number' ? clamp(params.max_breadth, 1, 500) : 20,
    limit: typeof params.limit === 'number' ? clamp(params.limit, 1, 500) : 50,
    instructions: typeof params.instructions === 'string' ? params.instructions : undefined
  });
}
