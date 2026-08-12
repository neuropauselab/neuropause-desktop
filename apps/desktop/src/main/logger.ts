/**
 * Minimal leveled logger for the main process. Dependency-free on purpose —
 * the backend owns the structured/redacting logger; here we only need readable
 * diagnostics during development. Never log tokens or credentials.
 *
 * Phase 8 (RC hardening 8.4): an optional FILE SINK can be attached at app
 * start (userData/logs/app.log, rotated). In a packaged app console output
 * goes nowhere — before this, a field support bundle contained zero runtime
 * logs, the single most valuable artifact for diagnosing a pilot issue. The
 * logger itself stays dependency-free: the sink is injected, so every
 * Electron-free unit test that imports a module using the logger is unchanged.
 */
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

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()} (${scope})`;
  if (meta !== undefined) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message, meta);
  } else {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
  if (fileSink && LEVEL_ORDER[level] >= LEVEL_ORDER.info) {
    let suffix = '';
    if (meta !== undefined) {
      try {
        suffix = ` ${JSON.stringify(serializableMeta(meta))}`;
      } catch {
        suffix = ' [unserializable meta]';
      }
    }
    fileSink(`${prefix} ${message}${suffix}`);
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
