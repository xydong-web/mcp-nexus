export const grokToolsV0100 = [
  {
    name: 'web_search',
    description: 'Run GrokSearch web search with optional supplementary source enrichment.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query to search for.' },
        platform: { type: 'string', description: 'Optional platform focus such as X, Reddit, or GitHub.' },
        model: { type: 'string', description: 'Optional Grok model override for this request.' },
        extra_sources: {
          type: 'number',
          minimum: 0,
          maximum: 20,
          description: 'Optional supplementary source count. If omitted, server default is used.'
        },
        max_results: {
          type: 'number',
          minimum: 1,
          maximum: 50,
          description: 'Optional cap applied after merged source deduplication.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_sources',
    description: 'Fetch source list cached from a previous web_search call using session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID returned by web_search.' }
      },
      required: ['session_id']
    }
  },
  {
    name: 'web_fetch',
    description: 'Fetch and extract markdown content from a URL with provider fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP(S) URL to fetch.' },
        timeout_ms: {
          type: 'number',
          minimum: 1000,
          maximum: 120000,
          description: 'Optional request timeout in milliseconds.'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'web_map',
    description: 'Map website links from a root URL with optional crawl constraints.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Root URL to map.' },
        instructions: { type: 'string', description: 'Optional crawler instructions.' },
        max_depth: { type: 'number', minimum: 1, maximum: 5, default: 1 },
        max_breadth: { type: 'number', minimum: 1, maximum: 500, default: 20 },
        limit: { type: 'number', minimum: 1, maximum: 500, default: 50 }
      },
      required: ['url']
    }
  }
] as const;

