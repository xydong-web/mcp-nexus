import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerSettingsMock } = vi.hoisted(() => ({
  getServerSettingsMock: vi.fn(async () => [] as Array<{ key: string; value: string }>)
}));

vi.mock('../src/db/d1.js', () => {
  class D1Client {
    constructor(_db: unknown) {}

    async getServerSettings() {
      return await getServerSettingsMock();
    }
  }

  return { D1Client };
});

import { handleMcpRequest } from '../src/mcp/mcpHandler.js';

type ContextOptions = {
  settings?: Array<{ key: string; value: string }>;
  allowedTools?: string[] | null;
  clientTokenId?: string;
  clientTokenRateLimit?: number | null;
};

function createWorkerContext(body: unknown, opts: ContextOptions = {}) {
  const values = new Map<string, unknown>([
    ['clientTokenId', opts.clientTokenId ?? 'tok_test'],
    ['clientTokenAllowedTools', opts.allowedTools ?? null],
    ['clientTokenRateLimit', opts.clientTokenRateLimit ?? null]
  ]);

  getServerSettingsMock.mockResolvedValue(opts.settings ?? []);

  const rateLimiterStub = {
    fetch: vi.fn(async () =>
      new Response(
        JSON.stringify({
          allowed: true,
          remaining: 99,
          resetAt: Date.now() + 60_000
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    )
  };

  return {
    req: {
      json: async () => body
    },
    env: {
      DB: {},
      RATE_LIMITER: {
        idFromName: (name: string) => name,
        get: () => rateLimiterStub
      },
      KEY_ENCRYPTION_SECRET: 'test-secret',
      MCP_RATE_LIMIT_PER_MINUTE: '60',
      MCP_GLOBAL_RATE_LIMIT_PER_MINUTE: '600',
      SEARCH_SOURCE_MODE: 'combined',
      TAVILY_RESEARCH_ENABLED: 'true',
      GROK_SEARCH_ENABLED: 'false'
    },
    get: (key: string) => values.get(key),
    json: (payload: unknown, status?: number) =>
      new Response(JSON.stringify(payload), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' }
      })
  } as any;
}

describe('mcpHandler Grok integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSettingsMock.mockResolvedValue([]);
  });

  it('includes Grok tools in tools/list when enabled in server settings', async () => {
    const c = createWorkerContext(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { settings: [{ key: 'grokSearchEnabled', value: 'true' }] }
    );

    const response = await handleMcpRequest(c);
    const body = await response.json<any>();
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toEqual(expect.arrayContaining(['web_search', 'get_sources', 'web_fetch', 'web_map']));
  });

  it('hides Grok tools in tools/list when disabled', async () => {
    const c = createWorkerContext(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { settings: [{ key: 'grokSearchEnabled', value: 'false' }] }
    );

    const response = await handleMcpRequest(c);
    const body = await response.json<any>();
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).not.toContain('web_search');
    expect(names).not.toContain('get_sources');
    expect(names).not.toContain('web_fetch');
    expect(names).not.toContain('web_map');
  });

  it('rejects a Grok tool call outside token allowedTools scope', async () => {
    const c = createWorkerContext(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'web_search', arguments: { query: 'mcp nexus' } }
      },
      {
        settings: [{ key: 'grokSearchEnabled', value: 'true' }],
        allowedTools: ['tavily_search']
      }
    );

    const response = await handleMcpRequest(c);
    const body = await response.json<any>();

    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toContain("Tool 'web_search' is not allowed");
  });

  it('returns a graceful error when Grok tools are disabled by feature flag', async () => {
    const c = createWorkerContext(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'web_search', arguments: { query: 'mcp nexus' } }
      },
      {
        settings: [{ key: 'grokSearchEnabled', value: 'false' }],
        allowedTools: ['web_search']
      }
    );

    const response = await handleMcpRequest(c);
    const body = await response.json<any>();
    const text = body.result.content[0].text as string;

    expect(body.result.isError).toBe(true);
    expect(text).toContain('disabled');
  });
});

