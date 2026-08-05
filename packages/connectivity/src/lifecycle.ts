/**
 * Module 1 — Connector Lifecycle. A tenant-aware state machine over the seven
 * lifecycle states (installed → connected → healthy, plus disconnected / expired /
 * disabled / error). The existing connectors `ConnectorRegistry` tracks connector
 * DEFINITIONS (enabled/disabled, globally); this adds per-TENANT connection state,
 * which is what a multi-tenant product needs. Every transition fires an optional
 * hook (the platform wires it to governance so every lifecycle change is audited +
 * published). Also carries per-connection permissions/scopes and diagnostics.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { ConnectorId, LifecycleState } from './constants';

export interface ConnectionRecord {
  tenantId: string;
  connectorId: string;
  state: LifecycleState;
  installedAt: number;
  connectedAt?: number;
  lastSyncAt?: number;
  lastError?: string;
  expiresAt?: number;
  permissions: string[];
  scopes: string[];
}

export interface TransitionLogEntry {
  tenantId: string;
  connectorId: string;
  from: LifecycleState;
  to: LifecycleState;
  at: number;
}

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface DiagnosticsReport {
  tenantId: string;
  connectorId: string;
  state: LifecycleState;
  healthy: boolean;
  checks: DiagnosticCheck[];
}

export interface LifecycleHooks {
  onTransition?(rec: ConnectionRecord, from: LifecycleState, to: LifecycleState): void;
}

/** Allowed transitions — an invalid transition throws (a real state machine). */
const ALLOWED: Record<LifecycleState, LifecycleState[]> = {
  installed: ['connected', 'disabled', 'error'],
  connected: ['healthy', 'error', 'expired', 'disconnected', 'disabled'],
  healthy: ['connected', 'error', 'expired', 'disconnected', 'disabled'],
  disconnected: ['connected', 'disabled', 'installed'],
  expired: ['connected', 'disconnected', 'disabled'],
  error: ['connected', 'disconnected', 'disabled', 'healthy'],
  disabled: ['installed', 'connected'],
};

const HEALTHY_STATES: ReadonlySet<LifecycleState> = new Set<LifecycleState>(['connected', 'healthy']);

export class ConnectorLifecycle {
  private readonly conns = new Map<string, ConnectionRecord>();
  private readonly log: TransitionLogEntry[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly hooks: LifecycleHooks = {},
  ) {}

  private key(tenantId: string, connectorId: string): string {
    return `${tenantId}:${connectorId}`;
  }

  /** Install a connector for a tenant (idempotent — re-install updates grants). */
  install(tenantId: string, connectorId: ConnectorId | string, opts: { permissions?: string[]; scopes?: string[] } = {}): ConnectionRecord {
    const k = this.key(tenantId, connectorId);
    const existing = this.conns.get(k);
    if (existing) {
      if (opts.permissions) existing.permissions = opts.permissions;
      if (opts.scopes) existing.scopes = opts.scopes;
      return existing;
    }
    const rec: ConnectionRecord = {
      tenantId,
      connectorId,
      state: 'installed',
      installedAt: this.clock.now(),
      permissions: opts.permissions ?? [],
      scopes: opts.scopes ?? [],
    };
    this.conns.set(k, rec);
    return rec;
  }

  private transition(tenantId: string, connectorId: string, to: LifecycleState, patch?: Partial<ConnectionRecord>): ConnectionRecord {
    const k = this.key(tenantId, connectorId);
    const rec = this.conns.get(k);
    if (!rec) throw new Error(`connector '${connectorId}' is not installed for tenant '${tenantId}'`);
    const from = rec.state;
    if (from !== to && !ALLOWED[from].includes(to)) {
      throw new Error(`illegal lifecycle transition ${from} → ${to} for '${connectorId}'`);
    }
    Object.assign(rec, patch);
    rec.state = to;
    this.log.push({ tenantId, connectorId, from, to, at: this.clock.now() });
    this.hooks.onTransition?.(rec, from, to);
    return rec;
  }

  connect(tenantId: string, connectorId: string, opts: { expiresAt?: number } = {}): ConnectionRecord {
    return this.transition(tenantId, connectorId, 'connected', {
      connectedAt: this.clock.now(),
      ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
      lastError: undefined,
    });
  }

  markHealthy(tenantId: string, connectorId: string): ConnectionRecord {
    return this.transition(tenantId, connectorId, 'healthy', { lastSyncAt: this.clock.now(), lastError: undefined });
  }

  markError(tenantId: string, connectorId: string, detail: string): ConnectionRecord {
    return this.transition(tenantId, connectorId, 'error', { lastError: detail });
  }

  markExpired(tenantId: string, connectorId: string): ConnectionRecord {
    return this.transition(tenantId, connectorId, 'expired');
  }

  disconnect(tenantId: string, connectorId: string): ConnectionRecord {
    return this.transition(tenantId, connectorId, 'disconnected');
  }

  disable(tenantId: string, connectorId: string): ConnectionRecord {
    return this.transition(tenantId, connectorId, 'disabled');
  }

  enable(tenantId: string, connectorId: string): ConnectionRecord {
    return this.transition(tenantId, connectorId, 'installed');
  }

  get(tenantId: string, connectorId: string): ConnectionRecord | undefined {
    return this.conns.get(this.key(tenantId, connectorId));
  }

  list(tenantId: string): ConnectionRecord[] {
    return [...this.conns.values()].filter((r) => r.tenantId === tenantId);
  }

  transitions(): TransitionLogEntry[] {
    return [...this.log];
  }

  /** Health snapshot for a tenant's connectors. */
  health(tenantId: string): Array<{ connectorId: string; state: LifecycleState; healthy: boolean }> {
    return this.list(tenantId).map((r) => ({ connectorId: r.connectorId, state: r.state, healthy: this.isHealthy(r) }));
  }

  private isHealthy(rec: ConnectionRecord): boolean {
    if (rec.expiresAt !== undefined && rec.expiresAt <= this.clock.now()) return false;
    return HEALTHY_STATES.has(rec.state);
  }

  /** Diagnostics: real per-connection checks the dashboard surfaces. */
  diagnostics(tenantId: string, connectorId: string): DiagnosticsReport {
    const rec = this.get(tenantId, connectorId);
    if (!rec) {
      return { tenantId, connectorId, state: 'installed', healthy: false, checks: [{ name: 'installed', ok: false, detail: 'not installed' }] };
    }
    const notExpired = rec.expiresAt === undefined || rec.expiresAt > this.clock.now();
    const checks: DiagnosticCheck[] = [
      { name: 'installed', ok: true },
      { name: 'connected', ok: rec.state !== 'installed' && rec.state !== 'disabled', ...(rec.state === 'disabled' ? { detail: 'disabled' } : {}) },
      { name: 'not-expired', ok: notExpired, ...(notExpired ? {} : { detail: 'credential expired' }) },
      { name: 'no-error', ok: rec.state !== 'error', ...(rec.lastError ? { detail: rec.lastError } : {}) },
    ];
    return { tenantId, connectorId, state: rec.state, healthy: this.isHealthy(rec), checks };
  }

  /** Permission gate for a connection (supports the '*' wildcard grant). */
  can(tenantId: string, connectorId: string, permission: string): boolean {
    const rec = this.get(tenantId, connectorId);
    if (!rec) return false;
    return rec.permissions.includes('*') || rec.permissions.includes(permission);
  }
}
