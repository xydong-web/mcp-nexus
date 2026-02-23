export class GrokUpstreamError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, opts: { status: number; retryAfterMs?: number }) {
    super(message);
    this.name = 'GrokUpstreamError';
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function isGrokUpstreamError(error: unknown): error is GrokUpstreamError {
  return error instanceof GrokUpstreamError;
}

