/**
 * A tiny, leveled logger for the renderer. Namespaced and quiet in production
 * (warnings and errors only), verbose in development. Mirrors the shape of the
 * main-process logger so call sites read the same on both sides.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const isDev = import.meta.env.DEV;
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold: number = isDev ? ORDER.debug : ORDER.warn;

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export function createLogger(namespace: string): Logger {
  const emit = (level: Level, msg: string, args: unknown[]): void => {
    if (ORDER[level] < threshold) return;
    const tag = `%c[${namespace}]`;
    const style =
      level === 'error'
        ? 'color:#ff453a'
        : level === 'warn'
          ? 'color:#ff9f0a'
          : 'color:#5e5ce6';
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](tag, style, msg, ...args);
  };
  return {
    debug: (m, ...a) => emit('debug', m, a),
    info: (m, ...a) => emit('info', m, a),
    warn: (m, ...a) => emit('warn', m, a),
    error: (m, ...a) => emit('error', m, a),
  };
}
