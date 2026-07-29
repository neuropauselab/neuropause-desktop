/**
 * Module 16 — Compliance Platform. Frameworks (ISO 27001 / SOC 2 / HIPAA / GDPR / PCI-DSS / SOX /
 * FDA), a control matrix, audit evidence, a policy library, a risk register, and certification
 * tracking. Control readiness is a real in-process computation (% of controls with evidence). The
 * platform NEVER claims certification — actual certification is REGULATED-EXTERNAL (an accredited
 * external auditor), so status caps at 'ready-for-audit'.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import { REGULATED_NOTE } from './types';
import { COMPLIANCE_FRAMEWORKS, type ComplianceFramework } from './constants';

export interface FrameworkAdoption {
  id: string;
  framework: ComplianceFramework;
  status: 'in-progress' | 'ready-for-audit'; // never 'certified'
  createdAt: number;
}
export interface Control {
  id: string;
  frameworkId: string;
  code: string;
  description: string;
  hasEvidence: boolean;
}
export interface RiskItem {
  id: string;
  description: string;
  likelihood: number; // 1..5
  impact: number; // 1..5
  score: number;
}

const SEED_CONTROLS = ['AC-1 access control', 'CM-1 change management', 'IR-1 incident response'];

export class ComplianceRuntime {
  private readonly frameworksMap = new Map<string, FrameworkAdoption>();
  private readonly controlsMap = new Map<string, Control>();
  private readonly risksList: RiskItem[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async adoptFramework(framework: ComplianceFramework): Promise<FrameworkAdoption> {
    if (!COMPLIANCE_FRAMEWORKS.includes(framework)) throw new Error(`unknown framework: ${framework}`);
    const f: FrameworkAdoption = { id: randomId('fw'), framework, status: 'in-progress', createdAt: this.clock.now() };
    this.frameworksMap.set(f.id, f);
    for (const c of SEED_CONTROLS) await this.addControl(f.id, { code: c.split(' ')[0]!, description: c });
    await this.governance.record({ actor: 'system', domain: 'compliance', operation: `framework.adopt.${framework}`, targetId: f.id, evidence: 'live-verified' });
    return f;
  }
  async addControl(frameworkId: string, input: { code: string; description: string }): Promise<Control> {
    const c: Control = { id: randomId('ctrl'), frameworkId, code: input.code, description: input.description, hasEvidence: false };
    this.controlsMap.set(c.id, c);
    return c;
  }
  async recordEvidence(controlId: string, ref: string): Promise<Control> {
    const c = this.controlsMap.get(controlId);
    if (!c) throw new Error(`no control ${controlId}`);
    c.hasEvidence = true;
    await this.governance.record({ actor: 'system', domain: 'compliance', operation: 'evidence.record', targetId: controlId, evidence: 'live-verified', detail: ref });
    return c;
  }
  async addRisk(input: { description: string; likelihood: number; impact: number }): Promise<RiskItem> {
    const r: RiskItem = { id: randomId('crisk'), description: input.description, likelihood: input.likelihood, impact: input.impact, score: input.likelihood * input.impact };
    this.risksList.push(r);
    return r;
  }

  /** Real readiness computation: % of framework controls that have evidence. */
  readiness(frameworkId: string): { controls: number; withEvidence: number; pct: number; status: string; note: string } {
    const controls = [...this.controlsMap.values()].filter((c) => c.frameworkId === frameworkId);
    const withEvidence = controls.filter((c) => c.hasEvidence).length;
    const pct = controls.length === 0 ? 0 : Math.round((withEvidence / controls.length) * 100);
    const f = this.frameworksMap.get(frameworkId);
    if (f && pct === 100) f.status = 'ready-for-audit';
    return { controls: controls.length, withEvidence, pct, status: f?.status ?? 'in-progress', note: `readiness computed in-process — certification is ${REGULATED_NOTE}` };
  }

  /** Certification is never claimed — always regulated-external. */
  certificationStatus(frameworkId: string): { certified: false; status: string; note: string } {
    const f = this.frameworksMap.get(frameworkId);
    return { certified: false, status: f?.status ?? 'in-progress', note: `certification requires an accredited external auditor — ${REGULATED_NOTE}` };
  }

  frameworks(): FrameworkAdoption[] { return [...this.frameworksMap.values()]; }
  controls(frameworkId?: string): Control[] {
    const all = [...this.controlsMap.values()];
    return frameworkId ? all.filter((c) => c.frameworkId === frameworkId) : all;
  }
  risks(): RiskItem[] { return [...this.risksList]; }
  count(): number { return this.frameworksMap.size; }
}
