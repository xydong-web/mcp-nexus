import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { tavilySearchMock, tavilyExtractMock, tavilyMapMock, braveWebSearchMock } = vi.hoisted(() => ({
  tavilySearchMock: vi.fn(),
  tavilyExtractMock: vi.fn(),
  tavilyMapMock: vi.fn(),
  braveWebSearchMock: vi.fn()
}));

vi.mock('../src/services/tavilyClient.js', () => ({
  tavilySearch: tavilySearchMock,
  tavilyExtract: tavilyExtractMock,
  tavilyMap: tavilyMapMock
}));

vi.mock('../src/services/braveClient.js', () => ({
  braveWebSearch: braveWebSearchMock
}));

import { getCachedSessionSources, grokWebSearch } from '../src/services/grokClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('grokWebSearch enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deduplicates canonical URLs across Grok/Tavily/Brave/Firecrawl before response limits', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) {
        return jsonResponse(200, {
          choices: [{ message: { content: 'answer' } }],
          sources: [{ url: 'https://primary.example.com/path/?utm_source=x&a=1' }],
          citations: [{ url: 'https://dup.example.com/path/?b=2&utm_campaign=abc' }]
        });
      }
      if (url.endsWith('/search')) {
        return jsonResponse(200, {
          data: {
            web: [
              { url: 'https://firecrawl.example.com/source' },
              { url: 'https://dup.example.com/path/?utm_medium=email&b=2' }
            ]
          }
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    tavilySearchMock.mockResolvedValue({
      results: [
        { url: 'https://tavily.example.com/a?utm_source=ads' },
        { url: 'https://dup.example.com/path?b=2' }
      ]
    });
    braveWebSearchMock.mockResolvedValue({
      web: {
        results: [
          { url: 'https://brave.example.com/b' },
          { url: 'https://dup.example.com/path/?b=2' }
        ]
      }
    });

    const result = await grokWebSearch(
      { query: 'mcp nexus', extra_sources: 8 },
      {
        apiKey: 'xai-test',
        sourceMode: 'combined',
        modelDefault: 'grok-4.2-beta',
        extraSourcesDefault: 0,
        tavilyApiKey: 'tvly-test',
        braveApiKey: 'brave-test',
        firecrawlApiKey: 'fc-test'
      }
    ) as any;

    expect(result.metadata.degraded).toBe(false);
    expect(typeof result.session_id).toBe('string');

    const cached = getCachedSessionSources(result.session_id);
    expect(cached).not.toBeNull();
    expect(result.sources_count).toBe(cached?.length);
    expect(cached?.some((s) => s.url.includes('firecrawl.example.com/source'))).toBe(true);

    const dupCount = cached?.filter((s) => s.url.includes('dup.example.com/path')).length ?? 0;
    expect(dupCount).toBe(1);
  });

  it('returns degraded provider metadata when supplemental providers fail', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) {
        return jsonResponse(200, {
          choices: [{ message: { content: 'answer' } }],
          sources: [{ url: 'https://primary.example.com/path' }]
        });
      }
      if (url.endsWith('/search')) {
        return jsonResponse(500, { error: 'firecrawl failed' });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    tavilySearchMock.mockRejectedValue(new Error('tavily unavailable'));
    braveWebSearchMock.mockResolvedValue({
      web: {
        results: [{ url: 'https://brave.example.com/ok' }]
      }
    });

    const result = await grokWebSearch(
      { query: 'mcp nexus', extra_sources: 4 },
      {
        apiKey: 'xai-test',
        sourceMode: 'combined',
        modelDefault: 'grok-4.2-beta',
        extraSourcesDefault: 0,
        tavilyApiKey: 'tvly-test',
        braveApiKey: 'brave-test',
        firecrawlApiKey: 'fc-test'
      }
    ) as any;

    expect(result.metadata.degraded).toBe(true);
    expect(result.metadata.degraded_providers).toEqual(expect.arrayContaining(['tavily', 'firecrawl']));

    const cached = getCachedSessionSources(result.session_id);
    expect(cached).not.toBeNull();
    expect(cached?.length).toBeGreaterThan(0);
  });
});
