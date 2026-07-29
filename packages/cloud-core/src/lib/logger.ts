/**
 * Structured, redacting logger (Principle 7 — observable; and "never log
 * secrets"). Any field whose KEY looks secret is replaced with [REDACTED]
 * before it reaches a sink. Sink + clock are injected for testability.
 */
import type { Clock } from './clock';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  msg: string;
  ts: number;
  fields: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

/** Collects records in memory — used by tests and the diagnostics endpoint. */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void {
    this.records.push(record);
  }
}

const SECRET_KEY =
  /(secret|password|passwd|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|credential|authorization|private[_-]?key|client[_-]?secret)/i;

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export class Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly clock: Clock,
    private readonly base: Record<string, unknown> = {},
  ) {}

  private emit(level: LogLevel, msg: string, fields: Record<string, unknown>): void {
    this.sink.write({
      level,
      msg,
      ts: this.clock.now(),
      fields: redactFields({ ...this.base, ...fields }),
    });
  }

  debug(msg: string, fields: Record<string, unknown> = {}): void {
    this.emit('debug', msg, fields);
  }
  info(msg: string, fields: Record<string, unknown> = {}): void {
    this.emit('info', msg, fields);
  }
  warn(msg: string, fields: Record<string, unknown> = {}): void {
    this.emit('warn', msg, fields);
  }
  error(msg: string, fields: Record<string, unknown> = {}): void {
    this.emit('error', msg, fields);
  }

  child(fields: Record<string, unknown>): Logger {
    return new Logger(this.sink, this.clock, { ...this.base, ...fields });
  }
}
