import { encryptAes256Gcm } from '../crypto/crypto.js';

const DEFAULT_MAX_RETRIES = parsePositiveInt(process.env.REGISTRATION_MAX_RETRIES, 2, 0, 8);
const DEFAULT_COOLDOWN_MS = parsePositiveInt(process.env.REGISTRATION_COOLDOWN_MS, 3_000, 0, 60_000);

export type RegistrationPhase = 'queued' | 'temp_mail' | 'signup' | 'verification' | 'key_creation' | 'finalize' | 'canceled';
export type RegistrationRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'throttled' | 'canceled';
export type RegistrationFailureClass =
  | 'ip_blocked'
  | 'domain_blocked'
  | 'throttled'
  | 'invalid_captcha'
  | 'verification_timeout'
  | 'mail_provider_error'
  | 'duplicate_key'
  | 'invalid_line'
  | 'unknown';

export type RegistrationCandidate = {
  email: string | null;
  label: string;
  maskedKey: string;
  keyEncryptedB64: string;
  source: 'register_result';
};

export type RegistrationFailure = {
  email: string | null;
  errorClass: RegistrationFailureClass;
  errorMessage: string;
  retryable: boolean;
  phase: RegistrationPhase;
  statusCode: number;
  source: 'register_failed' | 'register_result';
};

export type RegistrationRunInput = {
  resultsText?: string;
  failedText?: string;
  maxRetries?: number;
  cooldownMs?: number;
  labelPrefix?: string;
};

export type RegistrationRunComputation = {
  status: RegistrationRunStatus;
  phase: RegistrationPhase;
  totalCandidates: number;
  completedCandidates: number;
  failedCandidates: number;
  retryCount: number;
  throttleCount: number;
  lastErrorClass: RegistrationFailureClass | null;
  lastErrorMessage: string | null;
  statusCodeSummary: Record<string, number>;
  candidates: RegistrationCandidate[];
  failures: RegistrationFailure[];
  behaviorMapping: Record<string, string>;
};

const REFERENCE_BEHAVIOR_MAPPING: Record<string, string> = {
  temp_mail_generation: 'Mapped from TavilyProxyManager-main/register/gptmail_client.py generate_email',
  signup: 'Mapped from TavilyProxyManager-main/register/signup.py signup',
  verification_polling: 'Mapped from TavilyProxyManager-main/register/gptmail_client.py wait_for_verification_link',
  key_creation: 'Mapped from TavilyProxyManager-main/register/signup.py create_api_key and get_api_keys'
};

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function splitNonEmptyLines(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseSeparatedLine(line: string): { left: string; right: string } | null {
  const separatorIndex = line.indexOf('----');
  if (separatorIndex < 0) {
    return null;
  }
  const left = line.slice(0, separatorIndex).trim();
  const right = line.slice(separatorIndex + 4).trim();
  if (!left || !right) return null;
  return { left, right };
}

function asEmailOrNull(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('@') ? normalized : null;
}

function sanitizeLabelPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'account';
}

function buildLabel(email: string | null, index: number, prefix: string): string {
  if (!email) return `${prefix}-${String(index).padStart(3, '0')}`;
  const localPart = sanitizeLabelPart(email.split('@', 1)[0] ?? '');
  return `${prefix}-${localPart}-${String(index).padStart(3, '0')}`;
}

function maskTavilyApiKey(apiKey: string): string {
  const raw = apiKey.trim();
  if (!raw) return '';
  const hasPrefix = raw.startsWith('tvly-');
  const prefix = hasPrefix ? 'tvly-' : '';
  const rest = hasPrefix ? raw.slice(5) : raw;
  if (rest.length <= 8) {
    const start = rest.slice(0, Math.min(2, rest.length));
    const end = rest.slice(Math.max(0, rest.length - 2));
    return `${prefix}${start}...${end}`;
  }
  return `${prefix}${rest.slice(0, 4)}...${rest.slice(-4)}`;
}

function classifyFailure(rawError: string): {
  errorClass: RegistrationFailureClass;
  phase: RegistrationPhase;
  retryable: boolean;
  statusCode: number;
} {
  const normalized = rawError.toLowerCase();

  if (normalized.includes('ip-signup-blocked')) {
    return { errorClass: 'ip_blocked', phase: 'signup', retryable: false, statusCode: 403 };
  }
  if (normalized.includes('custom-script-error-code_extensibility_error') || normalized.includes('domain')) {
    return { errorClass: 'domain_blocked', phase: 'signup', retryable: false, statusCode: 403 };
  }
  if (normalized.includes('too many requests') || normalized.includes('throttle') || normalized.includes('429')) {
    return { errorClass: 'throttled', phase: 'signup', retryable: true, statusCode: 429 };
  }
  if (normalized.includes('invalid-captcha')) {
    return { errorClass: 'invalid_captcha', phase: 'signup', retryable: true, statusCode: 422 };
  }
  if (normalized.includes('no_api_key_after_verify') || normalized.includes('verification') || normalized.includes('timeout')) {
    return { errorClass: 'verification_timeout', phase: 'verification', retryable: true, statusCode: 408 };
  }
  if (normalized.includes('gptmail') || normalized.includes('mail')) {
    return { errorClass: 'mail_provider_error', phase: 'temp_mail', retryable: true, statusCode: 503 };
  }
  return { errorClass: 'unknown', phase: 'signup', retryable: false, statusCode: 500 };
}

function incrementStatusCode(summary: Record<string, number>, statusCode: number): void {
  const key = String(statusCode);
  summary[key] = (summary[key] ?? 0) + 1;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    if (signal?.aborted) {
      resolve();
      return;
    }
    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function buildRegistrationRunComputation(
  input: RegistrationRunInput,
  opts: { encryptionKey: Buffer; signal?: AbortSignal }
): Promise<RegistrationRunComputation> {
  const signal = opts.signal;
  const maxRetries = Number.isFinite(input.maxRetries)
    ? Math.max(0, Math.min(8, Math.floor(input.maxRetries ?? 0)))
    : DEFAULT_MAX_RETRIES;
  const cooldownMs = Number.isFinite(input.cooldownMs)
    ? Math.max(0, Math.min(60_000, Math.floor(input.cooldownMs ?? 0)))
    : DEFAULT_COOLDOWN_MS;
  const labelPrefix = typeof input.labelPrefix === 'string' && input.labelPrefix.trim().length > 0
    ? sanitizeLabelPart(input.labelPrefix.trim().toLowerCase())
    : 'tavily-reg';

  const statusCodeSummary: Record<string, number> = {};
  const candidates: RegistrationCandidate[] = [];
  const failures: RegistrationFailure[] = [];
  const dedupeByApiKey = new Set<string>();

  const resultLines = splitNonEmptyLines(input.resultsText);
  const failedLines = splitNonEmptyLines(input.failedText);
  let retryCount = 0;
  let throttleCount = 0;
  let phase: RegistrationPhase = 'temp_mail';

  for (const line of resultLines) {
    if (signal?.aborted) {
      phase = 'canceled';
      break;
    }
    phase = 'key_creation';
    const pair = parseSeparatedLine(line);
    if (!pair) {
      failures.push({
        email: null,
        errorClass: 'invalid_line',
        errorMessage: `Malformed success line: ${line.slice(0, 160)}`,
        retryable: false,
        phase: 'key_creation',
        statusCode: 400,
        source: 'register_result'
      });
      incrementStatusCode(statusCodeSummary, 400);
      continue;
    }

    const email = asEmailOrNull(pair.left);
    const apiKey = pair.right;
    if (dedupeByApiKey.has(apiKey)) {
      failures.push({
        email,
        errorClass: 'duplicate_key',
        errorMessage: 'Duplicate API key in registration results',
        retryable: false,
        phase: 'key_creation',
        statusCode: 409,
        source: 'register_result'
      });
      incrementStatusCode(statusCodeSummary, 409);
      continue;
    }
    dedupeByApiKey.add(apiKey);

    const keyEncrypted = encryptAes256Gcm(apiKey, opts.encryptionKey);
    candidates.push({
      email,
      label: buildLabel(email, candidates.length + 1, labelPrefix),
      maskedKey: maskTavilyApiKey(apiKey),
      keyEncryptedB64: Buffer.from(keyEncrypted).toString('base64'),
      source: 'register_result'
    });
    incrementStatusCode(statusCodeSummary, 200);
  }

  for (const line of failedLines) {
    if (signal?.aborted) {
      phase = 'canceled';
      break;
    }
    const pair = parseSeparatedLine(line);
    const email = asEmailOrNull(pair?.left ?? '');
    const errorMessage = (pair?.right ?? line).trim();
    const classification = classifyFailure(errorMessage);
    phase = classification.phase;

    failures.push({
      email,
      errorClass: classification.errorClass,
      errorMessage,
      retryable: classification.retryable,
      phase: classification.phase,
      statusCode: classification.statusCode,
      source: 'register_failed'
    });
    incrementStatusCode(statusCodeSummary, classification.statusCode);

    if (classification.errorClass === 'throttled') {
      throttleCount++;
    }

    if (classification.retryable && maxRetries > 0) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (signal?.aborted) {
          phase = 'canceled';
          break;
        }
        retryCount++;
        if (classification.errorClass === 'throttled') {
          await sleep(cooldownMs, signal);
        }
      }
    }
  }

  phase = signal?.aborted ? 'canceled' : 'finalize';

  const lastFailure = failures[failures.length - 1];
  const hasThrottleSignal = failures.some((item) =>
    item.errorClass === 'throttled' || item.errorClass === 'ip_blocked' || item.errorClass === 'domain_blocked'
  );

  let status: RegistrationRunStatus;
  if (signal?.aborted) {
    status = 'canceled';
  } else if (candidates.length > 0) {
    status = hasThrottleSignal ? 'throttled' : 'completed';
  } else if (hasThrottleSignal) {
    status = 'throttled';
  } else {
    status = 'failed';
  }

  return {
    status,
    phase,
    totalCandidates: candidates.length + failures.length,
    completedCandidates: candidates.length,
    failedCandidates: failures.length,
    retryCount,
    throttleCount,
    lastErrorClass: lastFailure?.errorClass ?? null,
    lastErrorMessage: lastFailure?.errorMessage ?? null,
    statusCodeSummary,
    candidates,
    failures,
    behaviorMapping: REFERENCE_BEHAVIOR_MAPPING
  };
}
