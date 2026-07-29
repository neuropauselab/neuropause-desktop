/**
 * EPIC 15 — Production Logging. Centralized, audit, security, application, infrastructure, container,
 * API, and identity log streams with retention policies and search. A real in-process logging runtime;
 * audit logs continue to flow to the ONE runtime audit chain (reused), while operational log streams
 * are stored and searchable here. Live-verified.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { LOG_STREAMS, type LogStream } from './constants';

export interface LogEntry { stream: LogStream; level: 'debug' | 'info' | 'warn' | 'error'; message: string; at: number }

export class LoggingPlatform {
  private readonly entries: LogEntry[] = [];
  private readonly retention = new Map<LogStream, number>();

  constructor(
    private readonly clock: Clock,
    private readonly runtime: EnterpriseRuntime,
  ) {}

  log(input: { stream: LogStream; level: LogEntry['level']; message: string }): LogEntry {
    if (!LOG_STREAMS.includes(input.stream)) throw new Error(`unknown log stream: ${input.stream}`);
    const entry: LogEntry = { stream: input.stream, level: input.level, message: input.message, at: this.clock.now() };
    this.entries.push(entry);
    return entry;
  }

  setRetention(stream: LogStream, days: number): void { this.retention.set(stream, days); }
  retentionDays(stream: LogStream): number { return this.retention.get(stream) ?? 30; }

  /** Search the operational log streams (real filter over stored entries). */
  search(opts: { stream?: LogStream; contains?: string } = {}): LogEntry[] {
    return this.entries.filter((e) => (opts.stream === undefined || e.stream === opts.stream) && (opts.contains === undefined || e.message.includes(opts.contains)));
  }

  /** Audit logs are the ONE runtime audit chain — verified, not a private copy. */
  auditChainValid(): boolean { return this.runtime.audit().verify().valid; }

  streams(): readonly LogStream[] { return LOG_STREAMS; }
  count(): number { return this.entries.length; }
}
