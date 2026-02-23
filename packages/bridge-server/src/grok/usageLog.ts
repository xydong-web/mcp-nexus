import { createHash, createHmac } from 'node:crypto';
import type { PrismaClient } from '@mcp-nexus/db';
import { requestContext } from '../context.js';

export type GrokUsageLogMode = 'none' | 'hash' | 'preview' | 'full';

export function getGrokUsageLogMode(): GrokUsageLogMode {
  const raw = (process.env.GROK_USAGE_LOG_MODE ?? 'preview').toLowerCase();
  if (raw === 'none' || raw === 'hash' || raw === 'preview' || raw === 'full') return raw;
  return 'preview';
}

function getGrokUsageRetentionDays(): number | null {
  const raw = (process.env.GROK_USAGE_RETENTION_DAYS ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function getGrokUsageHashSecret(): string | null {
  const raw = (process.env.GROK_USAGE_HASH_SECRET ?? '').trim();
  return raw || null;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function queryHashHex(query: string): string {
  const secret = getGrokUsageHashSecret();
  if (!secret) return sha256Hex(query);
  return createHmac('sha256', secret).update(query, 'utf8').digest('hex');
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

function buildQueryMetadata(query: string | undefined, mode: GrokUsageLogMode): { queryHash?: string; queryPreview?: string } {
  if (!query || mode === 'none') return {};
  const queryHash = queryHashHex(query);
  if (mode === 'hash') return { queryHash };
  const redacted = redactCommonSecrets(query);
  if (mode === 'full') return { queryHash, queryPreview: redacted };
  return { queryHash, queryPreview: clampPreview(redacted, 180) };
}

function shouldLogGrokUsage(mode: GrokUsageLogMode): boolean {
  if (mode === 'none') return false;
  const raw = (process.env.GROK_USAGE_SAMPLE_RATE ?? '').trim();
  if (!raw) return true;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return false;
  if (n >= 1) return true;
  return Math.random() < n;
}

async function maybeCleanupOldGrokUsageRows(prisma: PrismaClient): Promise<void> {
  const days = getGrokUsageRetentionDays();
  if (!days) return;
  const raw = (process.env.GROK_USAGE_CLEANUP_PROBABILITY ?? '0.001').trim();
  const p = Number(raw);
  const probability = Number.isFinite(p) && p > 0 ? Math.min(1, p) : 0.001;
  if (Math.random() >= probability) return;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await prisma.grokToolUsage.deleteMany({ where: { timestamp: { lt: cutoff } } });
}

export async function logGrokToolUsage(
  prisma: PrismaClient,
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
  const mode = getGrokUsageLogMode();
  if (!shouldLogGrokUsage(mode)) return;

  const ctx = requestContext.getStore();
  if (!ctx) return;

  const { queryHash, queryPreview } = buildQueryMetadata(input.query, mode);

  await prisma.grokToolUsage.create({
    data: {
      toolName: input.toolName,
      outcome: input.outcome,
      latencyMs: typeof input.latencyMs === 'number' ? Math.max(0, Math.floor(input.latencyMs)) : null,
      clientTokenId: ctx.clientTokenId,
      clientTokenPrefix: ctx.clientTokenPrefix,
      upstreamKeyId: input.upstreamKeyId ?? null,
      queryHash: queryHash ?? null,
      queryPreview: queryPreview ?? null,
      argsJson: (input.argsSummary ?? {}) as any,
      errorMessage: input.errorMessage ?? null
    }
  });

  await maybeCleanupOldGrokUsageRows(prisma);
}

