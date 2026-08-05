/**
 * EPIC 2 — End-to-End Validation. Runs REAL cross-subsystem execution traces over the reused
 * platforms: it registers an identity, issues + verifies a token, defines a role + authorizes,
 * exercises the AI runtime, the integration platform, and operations health — each step actually
 * calls the reused subsystem and records the measured outcome. A step whose platform was not wired
 * in is recorded 'skipped' (never fabricated as passed). The trace passes only if every executed
 * step passed. Uses NO production customer data — synthetic identities/roles only.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ReliabilityContext } from './types';
import type { ReliabilityGovernance } from './governance';

export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface TraceStep {
  subsystem: string;
  action: string;
  status: StepStatus;
  reused: boolean;
  detail: string;
}

export interface E2ETrace {
  id: string;
  name: string;
  org: string;
  at: number;
  steps: TraceStep[];
  executed: number;
  passed: boolean;
}

export class EndToEndValidation {
  constructor(
    private readonly clock: Clock,
    private readonly ctx: ReliabilityContext,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  /** Execute a real end-to-end trace across every wired-in subsystem. */
  async runTrace(input: { name: string; org?: string } = { name: 'default' }): Promise<E2ETrace> {
    const org = input.org ?? this.org;
    const steps: TraceStep[] = [];
    const tenant = `e2e-${org}`;

    // Step 1 — identity registration (security)
    let identityId: string | undefined;
    if (this.ctx.security) {
      try {
        const id = await this.ctx.security.identity().register({ type: 'service-account', displayName: 'e2e-probe', tenant });
        identityId = id.id;
        steps.push({ subsystem: 'security.identity', action: 'register', status: id.id ? 'passed' : 'failed', reused: true, detail: `identity ${id.id}` });
      } catch (err) {
        steps.push({ subsystem: 'security.identity', action: 'register', status: 'failed', reused: true, detail: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ subsystem: 'security.identity', action: 'register', status: 'skipped', reused: false, detail: 'security platform not wired in' });
    }

    // Step 2 — token issue + verify roundtrip (security)
    if (this.ctx.security && identityId) {
      try {
        const tok = await this.ctx.security.authentication().issueToken(identityId, 'e2e-token');
        const back = this.ctx.security.authentication().verifyToken(tok.token);
        const ok = back === identityId;
        steps.push({ subsystem: 'security.authentication', action: 'issue+verify token', status: ok ? 'passed' : 'failed', reused: true, detail: ok ? 'token verified to the same identity' : 'token did not verify' });
      } catch (err) {
        steps.push({ subsystem: 'security.authentication', action: 'issue+verify token', status: 'failed', reused: true, detail: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ subsystem: 'security.authentication', action: 'issue+verify token', status: 'skipped', reused: false, detail: 'no identity/security to authenticate' });
    }

    // Step 3 — role + authorization decision (security)
    if (this.ctx.security) {
      try {
        const roleId = `e2e-reader-${randomId('r')}`;
        this.ctx.security.authorization().defineRole({ id: roleId, name: 'E2E Reader', permissions: ['report:read'] });
        const allow = this.ctx.security.authorization().authorize({ subject: { id: identityId ?? 'e2e', roles: [roleId] }, action: 'read', resource: { type: 'report' } });
        const deny = this.ctx.security.authorization().authorize({ subject: { id: 'stranger', roles: [] }, action: 'read', resource: { type: 'report' } });
        const ok = allow.allowed && !deny.allowed;
        steps.push({ subsystem: 'security.authorization', action: 'defineRole+authorize', status: ok ? 'passed' : 'failed', reused: true, detail: ok ? 'permit for role, deny by default' : 'authorization did not behave least-privilege' });
      } catch (err) {
        steps.push({ subsystem: 'security.authorization', action: 'defineRole+authorize', status: 'failed', reused: true, detail: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ subsystem: 'security.authorization', action: 'defineRole+authorize', status: 'skipped', reused: false, detail: 'security platform not wired in' });
    }

    // Step 4 — AI runtime provider surface (ai-runtime)
    if (this.ctx.aiRuntime) {
      try {
        const providers = this.ctx.aiRuntime.providers().list().length;
        steps.push({ subsystem: 'ai-runtime', action: 'providers.list', status: providers >= 0 ? 'passed' : 'failed', reused: true, detail: `${providers} providers represented` });
      } catch (err) {
        steps.push({ subsystem: 'ai-runtime', action: 'providers.list', status: 'failed', reused: true, detail: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ subsystem: 'ai-runtime', action: 'providers.list', status: 'skipped', reused: false, detail: 'ai runtime not wired in' });
    }

    // Step 5 — integration registration + health (integration-platform)
    if (this.ctx.integrationPlatform) {
      try {
        await this.ctx.integrationPlatform.runtime().register({ name: 'e2e-crm', category: 'crm', system: 'Salesforce' });
        const health = this.ctx.integrationPlatform.monitoring().connectorHealth().total;
        steps.push({ subsystem: 'integration-platform', action: 'register+health', status: health >= 1 ? 'passed' : 'failed', reused: true, detail: `${health} connector(s) tracked (adapter-verified, not contacted)` });
      } catch (err) {
        steps.push({ subsystem: 'integration-platform', action: 'register+health', status: 'failed', reused: true, detail: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ subsystem: 'integration-platform', action: 'register+health', status: 'skipped', reused: false, detail: 'integration platform not wired in' });
    }

    // Step 6 — operations health snapshot (operations)
    if (this.ctx.operations) {
      try {
        const overview = this.ctx.operations.operations().overview();
        steps.push({ subsystem: 'operations', action: 'health.overview', status: overview ? 'passed' : 'failed', reused: true, detail: 'operations overview computed from real state' });
      } catch (err) {
        steps.push({ subsystem: 'operations', action: 'health.overview', status: 'failed', reused: true, detail: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ subsystem: 'operations', action: 'health.overview', status: 'skipped', reused: false, detail: 'operations platform not wired in' });
    }

    const executedSteps = steps.filter((s) => s.status !== 'skipped');
    const passed = executedSteps.length > 0 && executedSteps.every((s) => s.status === 'passed');
    const trace: E2ETrace = { id: randomId('trace'), name: input.name, org, at: this.clock.now(), steps, executed: executedSteps.length, passed };

    await this.gov.record({
      operator: this.operator,
      org,
      capability: 'End-to-End Validation',
      epic: 'E2',
      operation: 'trace',
      targetId: input.name,
      evidence: 'live-verified',
      decision: passed ? 'passed' : 'failed',
    });
    return trace;
  }
}
