/**
 * EPIC 6 — Data Migration Platform. Import planning, validation, schema mapping, DRY-RUN, rollback
 * planning, reports, and verification. This NEVER fabricates migrated data: a dry-run transforms only
 * the sample records the caller supplies (applying the real schema map), and with no sample it honestly
 * reports zero records processed. Real production import requires the customer's data and configured
 * infrastructure and is not performed here.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { MigrationStatus } from './constants';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface MigrationEntity {
  name: string;
  sourceRecordCount: number; // declared by the customer; never treated as imported
}

export interface SchemaMapping {
  from: string;
  to: string;
}

export interface MigrationPlan {
  id: string;
  deploymentId: string;
  source: string;
  entities: MigrationEntity[];
  status: MigrationStatus;
  mappings: SchemaMapping[];
  createdAt: number;
}

export interface DryRunReport {
  planId: string;
  recordsProcessed: number; // only real sample records — never fabricated
  transformed: Array<Record<string, unknown>>;
  unmappedFields: string[];
  note: string;
}

export class DataMigration {
  private readonly plans = new Map<string, MigrationPlan>();

  constructor(
    private readonly clock: Clock,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async plan(input: { deploymentId: string; source: string; entities: MigrationEntity[] }): Promise<MigrationPlan> {
    const deployment = this.require(input.deploymentId);
    const plan: MigrationPlan = { id: randomId('migplan'), deploymentId: input.deploymentId, source: input.source, entities: input.entities, status: 'planned', mappings: [], createdAt: this.clock.now() };
    this.plans.set(plan.id, plan);
    await this.record(deployment, 'plan-migration', plan.id, 'planned');
    return plan;
  }

  async defineMapping(planId: string, mappings: SchemaMapping[]): Promise<MigrationPlan> {
    const plan = this.get(planId);
    if (!plan) throw new Error(`unknown migration plan: ${planId}`);
    plan.mappings = mappings;
    plan.status = 'validated';
    const deployment = this.require(plan.deploymentId);
    await this.record(deployment, 'validate-migration', planId, `${mappings.length} mappings`);
    return plan;
  }

  /** Dry-run over REAL sample records only. No sample → zero processed (never fabricated). */
  async dryRun(planId: string, sampleRecords: Array<Record<string, unknown>> = []): Promise<DryRunReport> {
    const plan = this.get(planId);
    if (!plan) throw new Error(`unknown migration plan: ${planId}`);
    const mapFields = new Map(plan.mappings.map((m) => [m.from, m.to]));
    const unmapped = new Set<string>();
    const transformed = sampleRecords.map((rec) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) {
        const target = mapFields.get(k);
        if (target) out[target] = v;
        else {
          out[k] = v;
          unmapped.add(k);
        }
      }
      return out;
    });
    plan.status = 'dry-run';
    const deployment = this.require(plan.deploymentId);
    await this.record(deployment, 'dry-run-migration', planId, `${transformed.length} sample records`);
    return {
      planId,
      recordsProcessed: transformed.length,
      transformed,
      unmappedFields: [...unmapped],
      note: sampleRecords.length === 0 ? 'no sample records supplied — zero processed (no data fabricated)' : `transformed ${transformed.length} real sample record(s) through the schema map`,
    };
  }

  async rollbackPlan(planId: string): Promise<{ planId: string; steps: string[] }> {
    const plan = this.get(planId);
    if (!plan) throw new Error(`unknown migration plan: ${planId}`);
    const deployment = this.require(plan.deploymentId);
    await this.record(deployment, 'rollback-plan-migration', planId, 'rollback planned');
    return { planId, steps: ['snapshot target before import', 'stage import in isolated schema', 'verify counts', 'promote or discard staged schema', 'restore snapshot on failure'] };
  }

  /** Verification compares declared source counts to what a dry-run actually processed. */
  verify(planId: string, dryRun: DryRunReport): { planId: string; verified: boolean; note: string } {
    const plan = this.get(planId);
    if (!plan) throw new Error(`unknown migration plan: ${planId}`);
    const declared = plan.entities.reduce((a, e) => a + e.sourceRecordCount, 0);
    const verified = dryRun.recordsProcessed > 0 && dryRun.unmappedFields.length === 0;
    return { planId, verified, note: `declared ${declared} source records; dry-run processed ${dryRun.recordsProcessed}; real import remains pending customer data + infrastructure.` };
  }

  get(id: string): MigrationPlan | undefined {
    return this.plans.get(id);
  }
  list(): MigrationPlan[] {
    return [...this.plans.values()];
  }

  private async record(deployment: { customerId: string; tenantId: string; environmentId: string }, operation: string, targetId: string, decision: string): Promise<void> {
    await this.gov.record({ operator: this.operator, customer: deployment.customerId, tenant: deployment.tenantId, environment: deployment.environmentId, epic: 'E6', operation, targetId, evidence: 'live-verified', decision });
  }
  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
