/**
 * Deployment Platform (NCEA 15.0, Phase 8). Deployment STRATEGIES as deterministic
 * state machines — blue/green, canary, rolling, recreate — each gated on runtime
 * health and a release-validation hook, with safe automatic rollback to the prior
 * version (every deployment is reversible). Adds deterministic feature flags with
 * percentage rollout, semantic version-compatibility checks, and paired DB
 * migration coordination (up with a captured down). Every transition is written to
 * the ONE audit chain. It orchestrates deploys; it does not duplicate runtime
 * logic. Executing against real orchestrators (k8s, load balancers) is INFRA-PENDING.
 */
import { randomId, sha256Hex, systemClock, type Clock } from '@neuropause/cloud-core';
import { recordOp, type AuditSink } from './opsAudit';

export type DeploymentStrategy = 'blue-green' | 'canary' | 'rolling' | 'recreate';
export type DeploymentState = 'pending' | 'in-progress' | 'verifying' | 'succeeded' | 'rolled-back' | 'failed';

export interface DeploymentStep {
  at: number;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface Deployment {
  id: string;
  version: string;
  previousVersion?: string;
  strategy: DeploymentStrategy;
  state: DeploymentState;
  startedAt: number;
  endedAt?: number;
  steps: DeploymentStep[];
}

export interface HealthGate {
  ready: boolean;
  status: 'ok' | 'degraded' | 'down';
}

export interface DeployInput {
  version: string;
  strategy?: DeploymentStrategy;
  /** Release validation, evaluated per traffic wave. Return false to trigger rollback. */
  verify?: (stage: { percent: number }) => boolean | Promise<boolean>;
  /** Custom traffic waves (percent). Defaults per strategy. */
  waves?: number[];
}

export interface DeploymentOptions {
  audit?: AuditSink;
  healthGate?: () => HealthGate;
  metrics?: { inc(name: string, by?: number): void };
  initialVersion?: string;
}

// ── feature flags ──
export class FeatureFlags {
  private readonly flags = new Map<string, { enabled: boolean; rolloutPct: number }>();
  set(flag: string, value: boolean | { rolloutPct: number }): void {
    this.flags.set(flag, typeof value === 'boolean' ? { enabled: value, rolloutPct: value ? 100 : 0 } : { enabled: false, rolloutPct: Math.max(0, Math.min(100, value.rolloutPct)) });
  }
  enable(flag: string): void {
    this.set(flag, true);
  }
  disable(flag: string): void {
    this.set(flag, false);
  }
  /** Deterministic per-subject rollout: same subject+flag always resolves the same way. */
  isEnabled(flag: string, subjectId?: string): boolean {
    const f = this.flags.get(flag);
    if (!f) return false;
    if (f.enabled || f.rolloutPct >= 100) return true;
    if (f.rolloutPct <= 0) return false;
    if (subjectId === undefined) return false;
    const bucket = parseInt(sha256Hex(`${flag}:${subjectId}`).slice(0, 8), 16) % 100;
    return bucket < f.rolloutPct;
  }
  list(): Array<{ flag: string; enabled: boolean; rolloutPct: number }> {
    return [...this.flags.entries()].map(([flag, v]) => ({ flag, ...v }));
  }
}

export class DeploymentManager {
  private readonly deployments = new Map<string, Deployment>();
  private currentVersion: string | undefined;
  readonly featureFlags = new FeatureFlags();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly options: DeploymentOptions = {},
  ) {
    this.currentVersion = options.initialVersion;
  }

  current(): string | undefined {
    return this.currentVersion;
  }

  private healthOk(): boolean {
    const gate = this.options.healthGate?.() ?? { ready: true, status: 'ok' as const };
    return gate.ready && gate.status !== 'down';
  }

  private defaultWaves(strategy: DeploymentStrategy): number[] {
    switch (strategy) {
      case 'canary':
        return [1, 10, 50, 100];
      case 'rolling':
        return [25, 50, 75, 100];
      case 'blue-green':
      case 'recreate':
        return [100];
    }
  }

  private audit(event: string, dep: Deployment): void {
    recordOp(this.options.audit, this.clock, {
      action: `op.deploy.${event}`,
      target: dep.version,
      payload: { id: dep.id, version: dep.version, previousVersion: dep.previousVersion ?? null, strategy: dep.strategy, state: dep.state },
    });
    this.options.metrics?.inc(`ops.deploy.${event}`);
  }

  async deploy(input: DeployInput): Promise<Deployment> {
    const strategy = input.strategy ?? 'rolling';
    const dep: Deployment = {
      id: randomId('deploy'),
      version: input.version,
      ...(this.currentVersion !== undefined ? { previousVersion: this.currentVersion } : {}),
      strategy,
      state: 'pending',
      startedAt: this.clock.now(),
      steps: [],
    };
    this.deployments.set(dep.id, dep);
    this.audit('start', dep);
    dep.state = 'in-progress';

    const waves = input.waves ?? this.defaultWaves(strategy);
    for (const percent of waves) {
      const gateOk = this.healthOk();
      const verifyOk = input.verify ? await input.verify({ percent }) : true;
      const ok = gateOk && verifyOk;
      dep.steps.push({ at: this.clock.now(), label: `wave ${percent}%`, ok, ...(ok ? {} : { detail: !gateOk ? 'health gate failed' : 'release validation failed' }) });
      if (!ok) return this.performRollback(dep);
    }

    dep.state = 'verifying';
    const finalOk = this.healthOk() && (input.verify ? await input.verify({ percent: 100 }) : true);
    if (!finalOk) return this.performRollback(dep);

    dep.state = 'succeeded';
    dep.endedAt = this.clock.now();
    dep.steps.push({ at: this.clock.now(), label: 'promoted', ok: true });
    this.currentVersion = dep.version;
    this.audit('succeeded', dep);
    return dep;
  }

  private performRollback(dep: Deployment): Deployment {
    dep.state = 'rolled-back';
    dep.endedAt = this.clock.now();
    dep.steps.push({ at: this.clock.now(), label: `rollback → ${dep.previousVersion ?? 'none'}`, ok: true });
    // current version stays the previous one — the deploy never promoted.
    this.audit('rolled_back', dep);
    return dep;
  }

  /** Explicitly roll a promoted deployment back to its previous version. */
  rollback(id: string): Deployment | undefined {
    const dep = this.deployments.get(id);
    if (!dep || dep.state !== 'succeeded') return undefined;
    dep.state = 'rolled-back';
    dep.steps.push({ at: this.clock.now(), label: `manual rollback → ${dep.previousVersion ?? 'none'}`, ok: true });
    this.currentVersion = dep.previousVersion;
    this.audit('rolled_back', dep);
    return dep;
  }

  get(id: string): Deployment | undefined {
    return this.deployments.get(id);
  }
  history(): Deployment[] {
    return [...this.deployments.values()];
  }

  /** Semantic compatibility: same major, and available minor ≥ required minor. */
  versionCompatible(available: string, required: string): boolean {
    const a = available.split('.').map((n) => parseInt(n, 10));
    const r = required.split('.').map((n) => parseInt(n, 10));
    if (a[0] !== r[0]) return false;
    if ((a[1] ?? 0) > (r[1] ?? 0)) return true;
    if ((a[1] ?? 0) < (r[1] ?? 0)) return false;
    return (a[2] ?? 0) >= (r[2] ?? 0);
  }

  /** Coordinate a DB migration with a paired rollback: on failure the down migration runs. */
  async coordinateMigration(m: { name: string; up: () => Promise<void>; down: () => Promise<void> }): Promise<{ name: string; applied: boolean; rolledBack: boolean; error?: string }> {
    try {
      await m.up();
      recordOp(this.options.audit, this.clock, { action: 'op.migration.apply', target: m.name, payload: { name: m.name, applied: true } });
      return { name: m.name, applied: true, rolledBack: false };
    } catch (e) {
      let rolledBack = false;
      try {
        await m.down();
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
      recordOp(this.options.audit, this.clock, { action: 'op.migration.rollback', target: m.name, payload: { name: m.name, rolledBack } });
      return { name: m.name, applied: false, rolledBack, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
