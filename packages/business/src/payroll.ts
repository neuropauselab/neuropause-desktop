/**
 * Module 6 — Payroll Platform. Employee compensation, salary structures, allowances, deductions,
 * benefits, tax withholding models, a payroll calendar, and a payroll ENGINE that computes a
 * payslip (gross / deductions / withholding / net) from a structure supplied at runtime. The
 * computation is live-verified arithmetic; a payroll RUN is only ever 'prepared' — actual
 * disbursement is REGULATED-EXTERNAL and is never executed, and no salary is fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import { REGULATED_NOTE } from './types';

export interface SalaryStructure {
  employeeId: string;
  base: number;
  currency: string;
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  withholdingRatePct: number;
}
export interface Payslip {
  employeeId: string;
  gross: number;
  allowances: number;
  deductions: number;
  taxWithheld: number;
  net: number;
  currency: string;
  note: string;
}
export interface PayrollRun {
  id: string;
  period: string;
  employeeCount: number;
  status: 'prepared'; // never 'disbursed'
  evidence: 'regulated-external';
  note: string;
  createdAt: number;
}

export class PayrollRuntime {
  private readonly structures = new Map<string, SalaryStructure>();
  private readonly runsMap = new Map<string, PayrollRun>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async registerCompensation(input: { employeeId: string; base: number; currency?: string; allowances?: Array<{ name: string; amount: number }>; deductions?: Array<{ name: string; amount: number }>; withholdingRatePct?: number }): Promise<SalaryStructure> {
    const s: SalaryStructure = { employeeId: input.employeeId, base: input.base, currency: input.currency ?? 'USD', allowances: input.allowances ?? [], deductions: input.deductions ?? [], withholdingRatePct: input.withholdingRatePct ?? 0 };
    this.structures.set(input.employeeId, s);
    await this.governance.record({ actor: 'system', domain: 'payroll', operation: 'compensation.register', targetId: input.employeeId, evidence: 'live-verified' });
    return s;
  }

  /** Real in-process payslip computation from a registered structure — no disbursement. */
  computePayslip(employeeId: string): Payslip {
    const s = this.structures.get(employeeId);
    if (!s) throw new Error(`no salary structure for ${employeeId}`);
    const allowances = s.allowances.reduce((t, a) => t + a.amount, 0);
    const deductions = s.deductions.reduce((t, d) => t + d.amount, 0);
    const gross = s.base + allowances;
    const taxWithheld = Math.round(gross * (s.withholdingRatePct / 100) * 100) / 100;
    const net = Math.round((gross - deductions - taxWithheld) * 100) / 100;
    return { employeeId, gross, allowances, deductions, taxWithheld, net, currency: s.currency, note: 'computed in-process — not disbursed' };
  }

  /** Prepare (never execute) a payroll run. Disbursement is regulated-external. */
  async prepareRun(period: string): Promise<PayrollRun> {
    const run: PayrollRun = { id: randomId('run'), period, employeeCount: this.structures.size, status: 'prepared', evidence: 'regulated-external', note: `payroll run prepared for ${this.structures.size} employees — ${REGULATED_NOTE}`, createdAt: this.clock.now() };
    this.runsMap.set(run.id, run);
    await this.governance.record({ actor: 'system', domain: 'payroll', operation: 'run.prepare', targetId: run.id, evidence: 'regulated-external', detail: run.note });
    return run;
  }

  compensation(employeeId: string): SalaryStructure | undefined { return this.structures.get(employeeId); }
  runs(): PayrollRun[] { return [...this.runsMap.values()]; }
  count(): number { return this.structures.size; }
}
