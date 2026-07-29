/**
 * EPIC 9 — Government Readiness. Department & agency profiles, security-classification templates,
 * governance templates, approval workflows, and operational dashboards. These are OPERATIONAL MODELS
 * only — a department profile describes how a government body could operate NEMS, not that any real body
 * has adopted it. No government engagement, accreditation, or authority-to-operate is claimed.
 */
import { randomId } from '@neuropause/cloud-core';
import type { GovernmentProfile } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface DepartmentProfile {
  id: string;
  name: string;
  profile: GovernmentProfile;
  classification: string;
  adopted: false;
}
export interface ApprovalWorkflow {
  id: string;
  name: string;
  steps: string[];
}

export class GovernmentReadiness {
  private readonly departments = new Map<string, DepartmentProfile>();
  private readonly workflows = new Map<string, ApprovalWorkflow>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  /** Model a department/agency profile — an operational model, not a real adoption. */
  async modelDepartment(input: { name: string; profile: GovernmentProfile; classification: string }): Promise<DepartmentProfile> {
    const dept: DepartmentProfile = { id: randomId('dept'), name: input.name, profile: input.profile, classification: input.classification, adopted: false };
    this.departments.set(dept.id, dept);
    await this.gov.record({ operator: this.operator, organization: input.name, environment: 'gov-model', version: '1.0.0', epic: 'E9', operation: 'model-department', targetId: dept.id, evidence: 'business-data-pending', decision: 'operational model (not adopted)' });
    return dept;
  }

  async defineApprovalWorkflow(input: { name: string; steps: string[] }): Promise<ApprovalWorkflow> {
    const wf: ApprovalWorkflow = { id: randomId('wf'), name: input.name, steps: input.steps };
    this.workflows.set(wf.id, wf);
    await this.gov.record({ operator: this.operator, organization: '_gov', environment: 'gov-model', version: '1.0.0', epic: 'E9', operation: 'define-approval-workflow', targetId: wf.id, evidence: 'live-verified', decision: `${input.steps.length} steps` });
    return wf;
  }

  /** Operational dashboard for a modelled department — represents readiness, never live operations. */
  operationalDashboard(departmentId: string): { department: string; classification: string; live: false; note: string } {
    const dept = this.departments.get(departmentId);
    if (!dept) throw new Error(`unknown department: ${departmentId}`);
    return { department: dept.name, classification: dept.classification, live: false, note: 'operational model only; no live government operation' };
  }

  departmentCount(): number {
    return this.departments.size;
  }
  workflowCount(): number {
    return this.workflows.size;
  }
}
