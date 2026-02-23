import type { SearchSourceMode } from '../mcp/searchSource.js';

export type GrokWebSearchParams = {
  query: string;
  platform?: string;
  model?: string;
  extra_sources?: number;
  max_results?: number;
};

export type GrokGetSourcesParams = {
  session_id: string;
};

export type GrokWebFetchParams = {
  url: string;
  timeout_ms?: number;
};

export type GrokWebMapParams = {
  url: string;
  instructions?: string;
  max_depth?: number;
  max_breadth?: number;
  limit?: number;
};

export type GrokSearchCallOptions = {
  sourceMode?: SearchSourceMode;
  modelDefault?: string;
  extraSourcesDefault?: number;
  defaults?: Record<string, unknown>;
};

export type GrokSearchClient = {
  webSearch: (
    params: GrokWebSearchParams & Record<string, unknown>,
    opts?: GrokSearchCallOptions
  ) => Promise<unknown>;
  getSources: (params: GrokGetSourcesParams & Record<string, unknown>) => Promise<unknown>;
  webFetch: (params: GrokWebFetchParams & Record<string, unknown>) => Promise<unknown>;
  webMap: (params: GrokWebMapParams & Record<string, unknown>) => Promise<unknown>;
};

