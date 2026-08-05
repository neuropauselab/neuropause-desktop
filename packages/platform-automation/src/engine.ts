/**
 * EPIC 1 — Infrastructure Automation Runtime. The automation registry, execution planner, dependency
 * resolver, dry-run engine, execution history, and rollback planner. Two modes:
 *   • PREVIEW  — generates the artifacts and returns them; NEVER mutates infrastructure. `mutated:false`.
 *   • EXECUTE  — requires explicit operator approval; even when approved it only PREPARES the operator
 *                execution package (artifacts + the exact commands to run). It NEVER applies anything, so
 *                `appliedToInfrastructure` is ALWAYS false and the status never becomes 'deployed'. Real
 *                execution is out-of-band by an operator with real credentials, recorded as evidence.
 * The dependency resolver is a real topological sort (Kahn) that rejects cycles and missing dependencies.
 */
import { randomId } from '@neuropause/cloud-core';
import type { AutomationStatus, Environment, ExecutionMode } from './constants';
import type { Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

export interface AutomationSpec {
  id: string;
  name: string;
  environment: Environment;
  dependsOn: string[];
  generate: () => Artifact[];
  rollbackSteps?: string[];
  applyCommands?: string[];
}

export interface AutomationRun {
  runId: string;
  automationId: string;
  mode: ExecutionMode;
  status: AutomationStatus;
  artifactCount: number;
  appliedToInfrastructure: false;
  result: string;
  at: number;
}

export interface PreviewResult {
  automationId: string;
  artifacts: Artifact[];
  mutated: false;
  note: string;
}

export interface ExecuteResult {
  automationId: string;
  status: 'approval-required' | 'prepared';
  appliedToInfrastructure: false;
  artifacts: Artifact[];
  commands: string[];
  note: string;
}

export interface RollbackPlan {
  automationId: string;
  steps: string[];
  executed: false;
}

export class InfrastructureAutomationEngine {
  private readonly specs = new Map<string, AutomationSpec>();
  private readonly runs: AutomationRun[] = [];

  constructor(
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  /** Register an automation. Registration mutates nothing external. */
  async register(spec: AutomationSpec): Promise<AutomationSpec> {
    this.specs.set(spec.id, spec);
    await this.gov.record({ operator: this.operator, environment: spec.environment, target: spec.id, epic: 'E1', operation: 'register', result: 'registered', evidence: 'live-verified' });
    return spec;
  }

  list(): AutomationSpec[] {
    return [...this.specs.values()];
  }

  /** Dependency resolver + execution planner — a real topological order (Kahn). Throws on cycle/missing. */
  plan(ids?: string[]): AutomationSpec[] {
    const wanted = ids ?? [...this.specs.keys()];
    // include transitive dependencies
    const needed = new Set<string>();
    const visit = (id: string): void => {
      if (needed.has(id)) return;
      const spec = this.specs.get(id);
      if (!spec) throw new Error(`unknown automation dependency: ${id}`);
      needed.add(id);
      for (const dep of spec.dependsOn) visit(dep);
    };
    for (const id of wanted) visit(id);

    const indeg = new Map<string, number>();
    for (const id of needed) indeg.set(id, 0);
    for (const id of needed) {
      for (const dep of this.specs.get(id)!.dependsOn) {
        if (!needed.has(dep)) throw new Error(`missing dependency ${dep} for ${id}`);
        indeg.set(id, (indeg.get(id) ?? 0) + 1);
      }
    }
    const queue = [...needed].filter((id) => (indeg.get(id) ?? 0) === 0).sort();
    const order: AutomationSpec[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(this.specs.get(id)!);
      for (const other of needed) {
        if (this.specs.get(other)!.dependsOn.includes(id)) {
          indeg.set(other, (indeg.get(other) ?? 0) - 1);
          if (indeg.get(other) === 0) queue.push(other);
        }
      }
      queue.sort();
    }
    if (order.length !== needed.size) throw new Error('dependency cycle detected');
    return order;
  }

  /** PREVIEW / dry-run — generates artifacts, mutates nothing. */
  async preview(id: string): Promise<PreviewResult> {
    const spec = this.require(id);
    const artifacts = spec.generate();
    this.runs.push({ runId: randomId('run'), automationId: id, mode: 'preview', status: 'previewed', artifactCount: artifacts.length, appliedToInfrastructure: false, result: 'previewed', at: 0 });
    await this.gov.record({ operator: this.operator, environment: spec.environment, target: id, epic: 'E1', operation: 'preview', result: 'previewed', evidence: 'live-verified' });
    return { automationId: id, artifacts, mutated: false, note: 'preview generated the artifacts; no infrastructure was modified' };
  }

  /**
   * EXECUTE — requires explicit approval. Even when approved, this only PREPARES the operator execution
   * package; it applies nothing and never claims deployment.
   */
  async execute(input: { id: string; operator: string; approved: boolean }): Promise<ExecuteResult> {
    const spec = this.require(input.id);
    if (!input.approved) {
      this.runs.push({ runId: randomId('run'), automationId: input.id, mode: 'execute', status: 'registered', artifactCount: 0, appliedToInfrastructure: false, result: 'approval-required', at: 0 });
      await this.gov.record({ operator: input.operator, environment: spec.environment, target: input.id, epic: 'E1', operation: 'execute-refused', result: 'approval-required', evidence: 'infrastructure-pending' });
      return { automationId: input.id, status: 'approval-required', appliedToInfrastructure: false, artifacts: [], commands: [], note: 'execute refused — explicit operator approval is required' };
    }
    const artifacts = spec.generate();
    const commands = spec.applyCommands ?? ['# apply the generated artifacts with your own credentials, e.g. terraform plan / kubectl apply / helm upgrade'];
    this.runs.push({ runId: randomId('run'), automationId: input.id, mode: 'execute', status: 'prepared', artifactCount: artifacts.length, appliedToInfrastructure: false, result: 'prepared', at: 0 });
    await this.gov.record({ operator: input.operator, environment: spec.environment, target: input.id, epic: 'E1', operation: 'execute-prepared', result: 'prepared', evidence: 'infrastructure-pending' });
    return {
      automationId: input.id,
      status: 'prepared',
      appliedToInfrastructure: false,
      artifacts,
      commands,
      note: 'approved and prepared — the operator runs the commands with real credentials; this control plane applied nothing',
    };
  }

  /** Rollback planner — returns the rollback steps; executes nothing. */
  async planRollback(id: string): Promise<RollbackPlan> {
    const spec = this.require(id);
    const steps = spec.rollbackSteps ?? ['# no explicit rollback steps registered — revert the applied artifacts via your IaC/git history'];
    await this.gov.record({ operator: this.operator, environment: spec.environment, target: id, epic: 'E1', operation: 'rollback-plan', result: 'planned', evidence: 'live-verified' });
    return { automationId: id, steps, executed: false };
  }

  history(): AutomationRun[] {
    return [...this.runs];
  }
  automationCount(): number {
    return this.specs.size;
  }

  private require(id: string): AutomationSpec {
    const s = this.specs.get(id);
    if (!s) throw new Error(`unknown automation: ${id}`);
    return s;
  }
}
