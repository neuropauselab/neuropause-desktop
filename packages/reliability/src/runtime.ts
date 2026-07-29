/**
 * EPIC 1 — Production Validation Runtime. The registry + ledger for validation suites and their
 * runs. A suite is only ever 'passed' or 'failed' after a REAL in-process execution: `run` invokes
 * the supplied executor, times it on the injected clock, records the measured outcome, and audits it
 * on the one chain. Nothing is assumed green; an executor that throws is recorded 'failed', honestly.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ValidationKind, ValidationStatus } from './constants';
import type { ReliabilityEvidenceLevel } from './types';
import type { ReliabilityGovernance } from './governance';

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ValidationSuite {
  id: string;
  name: string;
  kind: ValidationKind;
  org: string;
  registeredAt: number;
  status: ValidationStatus;
}

export interface ValidationRun {
  id: string;
  suiteId: string;
  name: string;
  kind: ValidationKind;
  status: ValidationStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  passed: boolean;
  checks: ValidationCheck[];
  evidence: ReliabilityEvidenceLevel;
}

export type ValidationExecutor = () => Promise<{ passed: boolean; checks: ValidationCheck[] }> | { passed: boolean; checks: ValidationCheck[] };

export class ValidationRuntime {
  private readonly suites = new Map<string, ValidationSuite>();
  private readonly runs: ValidationRun[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  register(input: { name: string; kind: ValidationKind; org?: string }): ValidationSuite {
    const suite: ValidationSuite = {
      id: randomId('vsuite'),
      name: input.name,
      kind: input.kind,
      org: input.org ?? this.org,
      registeredAt: this.clock.now(),
      status: 'registered',
    };
    this.suites.set(suite.id, suite);
    return suite;
  }

  /** Execute a suite for real, timing it on the clock and recording the measured outcome. */
  async run(suiteId: string, exec: ValidationExecutor, evidence: ReliabilityEvidenceLevel = 'live-verified'): Promise<ValidationRun> {
    const suite = this.suites.get(suiteId);
    if (!suite) throw new Error(`unknown validation suite: ${suiteId}`);
    suite.status = 'running';
    const startedAt = this.clock.now();
    let passed = false;
    let checks: ValidationCheck[] = [];
    try {
      const result = await exec();
      passed = result.passed;
      checks = result.checks;
    } catch (err) {
      passed = false;
      checks = [{ name: 'executor', passed: false, detail: err instanceof Error ? err.message : String(err) }];
    }
    const finishedAt = this.clock.now();
    suite.status = passed ? 'passed' : 'failed';
    const run: ValidationRun = {
      id: randomId('vrun'),
      suiteId,
      name: suite.name,
      kind: suite.kind,
      status: suite.status,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      passed,
      checks,
      evidence,
    };
    this.runs.push(run);
    await this.gov.record({
      operator: this.operator,
      org: suite.org,
      capability: 'Production Validation Runtime',
      epic: 'E1',
      operation: 'validate',
      targetId: suite.name,
      evidence,
      decision: passed ? 'passed' : 'failed',
    });
    return run;
  }

  suite(id: string): ValidationSuite | undefined {
    return this.suites.get(id);
  }
  listSuites(kind?: ValidationKind): ValidationSuite[] {
    const all = [...this.suites.values()];
    return kind ? all.filter((s) => s.kind === kind) : all;
  }
  listRuns(kind?: ValidationKind): ValidationRun[] {
    return kind ? this.runs.filter((r) => r.kind === kind) : [...this.runs];
  }
  lastRun(kind?: ValidationKind): ValidationRun | undefined {
    const runs = this.listRuns(kind);
    return runs[runs.length - 1];
  }
  summary(): { total: number; passed: number; failed: number } {
    const total = this.runs.length;
    const passed = this.runs.filter((r) => r.passed).length;
    return { total, passed, failed: total - passed };
  }
}
