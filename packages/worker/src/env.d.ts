import type { D1Database, DurableObjectNamespace, Fetcher } from '@cloudflare/workers-types';

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // D1 Database
  DB: D1Database;

  // Durable Objects
  MCP_SESSION: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;

  // Static Assets (auto-bound when using wrangler assets)
  ASSETS?: Fetcher;

  // Secrets (set via `wrangler secret put`)
  ADMIN_API_TOKEN: string;
  KEY_ENCRYPTION_SECRET: string;
  TAVILY_USAGE_HASH_SECRET?: string;
  BRAVE_USAGE_HASH_SECRET?: string;

  // Environment variables
  MCP_RATE_LIMIT_PER_MINUTE: string;
  MCP_GLOBAL_RATE_LIMIT_PER_MINUTE: string;
  TAVILY_KEY_SELECTION_STRATEGY: string;
  SEARCH_SOURCE_MODE?: string;
  TAVILY_RESEARCH_ENABLED?: string;
  TAVILY_USAGE_LOG_MODE: string;
  BRAVE_USAGE_LOG_MODE: string;
  GROK_SEARCH_ENABLED?: string;
  GROK_MODEL_DEFAULT?: string;
  GROK_EXTRA_SOURCES_DEFAULT?: string;
  GROK_SEARCH_SOURCE_MODE?: string;
  GROK_KEY_SELECTION_STRATEGY?: string;
  GROK_API_URL?: string;
  GROK_TIMEOUT_MS?: string;
  GROK_USAGE_LOG_MODE?: string;
  GROK_USAGE_HASH_SECRET?: string;
  GROK_USAGE_SAMPLE_RATE?: string;
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_API_URL?: string;
  TAVILY_CREDITS_REFRESH_LOCK_MS?: string;
  ADMIN_KEY_REVEAL_RATE_LIMIT_PER_MINUTE?: string;
  ENVIRONMENT?: string;
  ADMIN_UI_URL?: string; // If set, its origin is allowed for cross-origin Admin API calls (CORS)
}

declare module 'hono' {
  interface ContextVariableMap {
    // Add custom context variables here
    clientTokenId?: string;
    clientTokenPrefix?: string;
    clientTokenAllowedTools?: string[] | string | null;
    clientTokenRateLimit?: number | null;
  }
}
