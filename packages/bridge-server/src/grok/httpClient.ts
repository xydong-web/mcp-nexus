import { GrokUpstreamError } from './errors.js';

export type GrokSource = {
  url: string;
  title?: string;
  description?: string;
  provider?: string;
};

export type GrokSearchResponse = {
  content: string;
  sources: GrokSource[];
  raw?: unknown;
};

function parseRetryAfterMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const maybeError = (body as any).error;
  if (typeof maybeError === 'string') return maybeError;
  if (typeof maybeError?.message === 'string') return maybeError.message;
  if (typeof (body as any).message === 'string') return (body as any).message;
  return fallback;
}

function extractSources(body: any): GrokSource[] {
  const sources: GrokSource[] = [];
  const seen = new Set<string>();

  const addFrom = (item: any, provider: string) => {
    const url = typeof item?.url === 'string'
      ? item.url
      : typeof item === 'string'
        ? item
        : '';
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    sources.push({
      url: trimmed,
      title: typeof item?.title === 'string' ? item.title : undefined,
      description: typeof item?.description === 'string' ? item.description : undefined,
      provider
    });
  };

  const bodySources = Array.isArray(body?.sources) ? body.sources : [];
  for (const item of bodySources) addFrom(item, 'grok');

  const citations = Array.isArray(body?.citations) ? body.citations : [];
  for (const item of citations) addFrom(item, 'grok');

  return sources;
}

function extractContent(body: any): string {
  const direct = typeof body?.content === 'string' ? body.content : '';
  if (direct) return direct;

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

export function createGrokHttpClient(opts: { apiKey: string; baseUrl: string; timeoutMs?: number }) {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const timeoutMs = Math.max(1000, Math.floor(opts.timeoutMs ?? 20_000));

  async function request(path: string, body: Record<string, unknown>): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      let parsed: unknown = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { message: text };
      }

      if (!response.ok) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        throw new GrokUpstreamError(
          extractMessage(parsed, response.statusText || `HTTP ${response.status}`),
          { status: response.status, retryAfterMs }
        );
      }

      return parsed;
    } catch (error: unknown) {
      if (error instanceof GrokUpstreamError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GrokUpstreamError('Grok request timed out', { status: 504 });
      }
      throw new GrokUpstreamError(error instanceof Error ? error.message : 'Grok request failed', { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async search(params: { query: string; model: string; platform?: string }): Promise<GrokSearchResponse> {
      const prompt = params.platform
        ? `${params.query}\n\nFocus platform: ${params.platform}`
        : params.query;

      const body = await request('/chat/completions', {
        model: params.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      });

      return {
        content: extractContent(body),
        sources: extractSources(body),
        raw: body
      };
    }
  };
}

