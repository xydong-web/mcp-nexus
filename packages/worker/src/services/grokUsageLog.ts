import type { WorkerContext } from '../context.js';
import { D1Client } from '../db/d1.js';

export type GrokUsageLogMode = 'none' | 'hash' | 'preview' | 'full';

function getGrokUsageLogMode(env: { GROK_USAGE_LOG_MODE?: string }): GrokUsageLogMode {
  const raw = (env.GROK_USAGE_LOG_MODE ?? 'preview').toLowerCase();
  if (raw === 'none' || raw === 'hash' || raw === 'preview' || raw === 'full') return raw;
  return 'preview';
}

function getHashSecret(env: { GROK_USAGE_HASH_SECRET?: string }): string | null {
  const raw = (env.GROK_USAGE_HASH_SECRET ?? '').trim();
  return raw || null;
}

const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return toHex(digest);
}

async function queryHashHex(query: string, secret: string | null): Promise<string> {
  if (!secret) return sha256Hex(query);
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(query));
  return toHex(signature);
}

function clampPreview(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  if (maxLen <= 3) return normalized.slice(0, Math.max(0, maxLen));
  return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
}

function redactCommonSecrets(text: string): string {
  let s = text;
  s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>');
  s = s.replace(/\b[a-f0-9]{32,}\b/gi, '<hex>');
  s = s.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>');
  s = s.replace(/\b(xai|x-api-key)-[A-Za-z0-9_-]+\b/gi, '$1-<redacted>');
  s = s.replace(/([?&](?:token|access_token|auth|apikey|api_key|key|password)=)[^&\s]+/gi, '$1<redacted>');
  return s;
}

async function buildQueryMetadata(
  query: string | undefined,
  mode: GrokUsageLogMode,
  secret: string | null
): Promise<{ queryHash?: string; queryPreview?: string }> {
  if (!query || mode === 'none') return {};
  const queryHash = await queryHashHex(query, secret);
  if (mode === 'hash') return { queryHash };
  const redacted = redactCommonSecrets(query);
  if (mode === 'full') return { queryHash, queryPreview: redacted };
  return { queryHash, queryPreview: clampPreview(redacted, 180) };
}

function shouldLog(mode: GrokUsageLogMode, env: { GROK_USAGE_SAMPLE_RATE?: string }): boolean {
  if (mode === 'none') return false;
  const raw = (env.GROK_USAGE_SAMPLE_RATE ?? '').trim();
  if (!raw) return true;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return false;
  if (n >= 1) return true;
  return Math.random() < n;
}

export async function logGrokToolUsage(
  c: WorkerContext,
  db: D1Client,
  input: {
    toolName: string;
    upstreamKeyId?: string | null;
    outcome: 'success' | 'error';
    latencyMs?: number;
    query?: string;
    argsSummary?: Record<string, unknown>;
    errorMessage?: string;
  }
): Promise<void> {
  const mode = getGrokUsageLogMode(c.env);
  if (!shouldLog(mode, c.env)) return;

  const clientTokenId = c.get('clientTokenId');
  if (!clientTokenId) return;

  const clientTokenPrefix = c.get('clientTokenPrefix') ?? null;
  const secret = getHashSecret(c.env);
  const { queryHash, queryPreview } = await buildQueryMetadata(input.query, mode, secret);

  await db.createGrokToolUsage({
    toolName: input.toolName,
    outcome: input.outcome,
    latencyMs: typeof input.latencyMs === 'number' ? Math.max(0, Math.floor(input.latencyMs)) : null,
    clientTokenId,
    clientTokenPrefix,
    upstreamKeyId: input.upstreamKeyId ?? null,
    queryHash: queryHash ?? null,
    queryPreview: queryPreview ?? null,
    argsJson: input.argsSummary ?? {},
    errorMessage: input.errorMessage ?? null
  });
}
