/**
 * Minimal leveled logger for the main process.
 *
 * NP-013 (closes F-MR-7): CREDENTIAL redaction is ENFORCED at this boundary,
 * not asked of call sites. "Never log tokens or credentials" was a comment;
 * every message and meta now passes through ONE credential-text rule
 * (`redactCredentialText`, below — main's single copy, also consumed by the
 * connector-metadata RULE-009 guard) plus the shared secret-key classifier
 * (`classifyFieldName`, sensitivity.ts) for object keys, before reaching
 * EITHER the console or the file sink. Console and file see the SAME redacted
 * payload — what support reads is what the developer saw.
 *
 * DELIBERATELY NOT the shared `redactSensitive`: that rule's unit is "text
 * safe for an error report/export", so it also strips EMAILS and home paths.
 * At the logger boundary that would double-redact source-designed diagnostics
 * — the round-31 W-7 predicate `12@example.com` (local-part LENGTH + domain
 * kept, built precisely so the domain survives into a log) would collapse to
 * `<redacted-email>` and lose the signal it exists to carry. PII redaction is
 * source-side (`redactedEmailShape`) and export-side (`supportBundle`); the
 * boundary here owns CREDENTIALS. This divergence is pinned by test. The
 * credential rule is STRONGER than the shared one where it matters: camelCase
 * JSON keys (`"accessToken":"…"` — exactly the shape a V8 parse-error excerpt
 * of decrypted vault plaintext takes) and truncated JWTs are caught; the
 * shared word-boundary regex sees neither. If a future FG gate opens
 * packages/shared, this rule should move there beside `redactSensitive`.
 *
 * Only pure @neuropause/shared imports, so Electron-free unit tests importing
 * logger-using modules are unchanged.
 *
 * Phase 8 (RC hardening 8.4): an optional FILE SINK can be attached at app
 * start (userData/logs/app.log, rotated). In a packaged app console output
 * goes nowhere — before this, a field support bundle contained zero runtime
 * logs, the single most valuable artifact for diagnosing a pilot issue. The
 * sink is injected.
 */
import { classifyFieldName, REDACTED_MARKER } from '@neuropause/shared';

/**
 * NP-013 — main's ONE credential-text rule. Classes: JWTs INCLUDING truncated
 * prefixes (`eyJ` is base64 `{"` — token-specific enough to redact any such
 * run), whole Bearer values, secret-keyword key/value pairs in env AND JSON
 * form (camelCase/snake/space, quoted or bare), and bare provider-token
 * prefixes that carry no keyword and are not JWT-shaped (Slack xox-/xapp-,
 * OpenAI-style sk-, GitHub PATs, AWS access-key ids, Google ya29 — mirroring
 * `supportBundle.redactText`'s class list).
 */
const CREDENTIAL_TEXT_SHAPES: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)*/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /(\b(?:access[_ -]?token|refresh[_ -]?token|id[_ -]?token|session[_ -]?token|client[_ -]?secret|private[_ -]?key|api[_ -]?key|authorization|bearer|token|secret|password|passwd)\b"?\s*[=:]\s*)"?[^\s"',}]+"?/gi,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
  /\bxapp-[A-Za-z0-9-]{10,}/g,
  /\bsk-[A-Za-z0-9._-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bya29\.[A-Za-z0-9._-]{20,}/g,
];

/** Scrub credential-shaped material from free text. Pure, deterministic. */
export function redactCredentialText(text: string): string {
  let out = text;
  for (const shape of CREDENTIAL_TEXT_SHAPES) {
    out = out.replace(shape, (_match, keywordPrefix: unknown) =>
      typeof keywordPrefix === 'string' ? `${keywordPrefix}${REDACTED_MARKER}` : REDACTED_MARKER,
    );
  }
  return out;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = process.env.NODE_ENV === 'production' ? LEVEL_ORDER.info : LEVEL_ORDER.debug;

/** The attached file sink (null until the app wires one at startup). */
let fileSink: ((line: string) => void) | null = null;

/** Attach the rotating file sink (called once from the main entry at boot). */
export function attachLogFileSink(sink: (line: string) => void): void {
  fileSink = sink;
}

/**
 * `JSON.stringify(new Error('boom'))` is `'{}'` — `name`, `message` and `stack`
 * are non-enumerable. P13C ROUND 17: that one fact hid a fourteen-round outage.
 * `index.ts` caught a fatal from `initRuntimeCore` and logged
 * `Runtime core failed to initialize {}`; because, as this file's own header
 * says, "in a packaged app console output goes nowhere", the file sink was the
 * ONLY surviving diagnostic and it threw the error away. The console path
 * printed the real object — to a console nobody was attached to.
 *
 * Normalize before serializing, and do it RECURSIVELY: an Error is at least as
 * likely to arrive as a field of a meta object as on its own. Depth is capped
 * because a log line is not a heap dump and `cause` chains can be long.
 */
export function serializableMeta(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause !== undefined && depth < 4
        ? { cause: serializableMeta(value.cause, depth + 1) }
        : {}),
    };
  }
  if (depth >= 4) return value;
  if (Array.isArray(value)) return value.map((v) => serializableMeta(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializableMeta(v, depth + 1);
    return out;
  }
  return value;
}

/**
 * NP-013 — the redaction pass, applied to the ALREADY-NORMALIZED meta (run it
 * after `serializableMeta` so Error message/stack/cause are plain strings and
 * get scrubbed like any other). An object key the shared classifier calls
 * `secret` loses its ENTIRE value (a raw opaque token under `accessToken:`
 * matches no text pattern — the key is the only signal); every string leaf
 * passes through the credential-text rule. Depth-capped: below the cap the
 * value was already passed through opaque, and an opaque deep object is
 * exactly what must not skip scrubbing — so beyond the cap non-strings are
 * dropped to a marker.
 */
export function redactLogPayload(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactCredentialText(value);
  if (depth >= 5) {
    return value !== null && typeof value === 'object' ? '[depth-capped]' : value;
  }
  if (Array.isArray(value)) return value.map((v) => redactLogPayload(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = classifyFieldName(k) === 'secret' ? REDACTED_MARKER : redactLogPayload(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()} (${scope})`;
  const safeMessage = redactCredentialText(message);
  const safeMeta = meta !== undefined ? redactLogPayload(serializableMeta(meta)) : undefined;
  if (safeMeta !== undefined) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, safeMessage, safeMeta);
  } else {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, safeMessage);
  }
  if (fileSink && LEVEL_ORDER[level] >= LEVEL_ORDER.info) {
    let suffix = '';
    if (safeMeta !== undefined) {
      try {
        suffix = ` ${JSON.stringify(safeMeta)}`;
      } catch {
        suffix = ' [unserializable meta]';
      }
    }
    fileSink(`${prefix} ${safeMessage}${suffix}`);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, meta?: unknown) => emit('debug', scope, m, meta),
    info: (m: string, meta?: unknown) => emit('info', scope, m, meta),
    warn: (m: string, meta?: unknown) => emit('warn', scope, m, meta),
    error: (m: string, meta?: unknown) => emit('error', scope, m, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
