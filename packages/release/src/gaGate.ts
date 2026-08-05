/**
 * EPIC 4 — General Availability Gate. Produces an evidence-based Go/No-Go for a v1.0 release from: the
 * RC report, a release checklist, a risk assessment, and a REAL executive approval. Executive approval
 * is NEVER fabricated — a go requires a real named approver. The gate REUSES the Sprint-4 release-
 * candidate gate to aggregate the evidence. A 'go' authorizes the release to be promoted + governed for
 * GA; it does NOT assert that GA has occurred in the real world (external publication, real customers,
 * and revenue remain pending) — `releasedToRealWorld` is hard-coded false.
 */
import { randomId } from '@neuropause/cloud-core';
import { type GaDecision } from './constants';
import type { ReleaseContext } from './types';
import type { ReleaseGovernance } from './governance';
import type { RcReport } from './rcValidation';

export interface ChecklistItem {
  item: string;
  done: boolean;
}

export interface ExecutiveApproval {
  approver: string | null;
  approved: boolean;
}

export interface GaGateResult {
  id: string;
  version: string;
  decision: GaDecision;
  rcPassed: boolean;
  checklist: ChecklistItem[];
  checklistComplete: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  executiveApproval: ExecutiveApproval;
  readinessScore: number | null;
  reusedReliability: boolean;
  releasedToRealWorld: false;
  note: string;
}

export class GaGate {
  private readonly results = new Map<string, GaGateResult>();

  constructor(
    private readonly ctx: ReleaseContext,
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  /** Evaluate the GA gate. A 'go' requires RC pass, a complete checklist, and a REAL executive approver. */
  async evaluate(input: { version: string; rcReport: RcReport; checklist: ChecklistItem[]; executiveApprover?: string; risk?: 'low' | 'medium' | 'high' }): Promise<GaGateResult> {
    const checklistComplete = input.checklist.length > 0 && input.checklist.every((c) => c.done);
    const approverValid = typeof input.executiveApprover === 'string' && input.executiveApprover.trim().length > 0;
    const riskLevel = input.risk ?? (input.rcReport.passed ? 'low' : 'high');

    let reusedReliability = false;
    if (this.ctx.reliability) {
      await this.ctx.reliability.releaseCandidate().evaluate({
        version: input.version,
        gates: [
          { name: 'rc-validation', passed: input.rcReport.passed },
          { name: 'checklist', passed: checklistComplete },
          { name: 'executive-approval', passed: approverValid },
        ],
      });
      reusedReliability = true;
    }

    const decision: GaDecision = input.rcReport.passed && checklistComplete && approverValid && riskLevel !== 'high' ? 'go' : 'no-go';
    const result: GaGateResult = {
      id: randomId('gagate'),
      version: input.version,
      decision,
      rcPassed: input.rcReport.passed,
      checklist: input.checklist,
      checklistComplete,
      riskLevel,
      executiveApproval: { approver: approverValid ? input.executiveApprover! : null, approved: approverValid },
      readinessScore: input.rcReport.readinessScore,
      reusedReliability,
      releasedToRealWorld: false,
      note:
        decision === 'go'
          ? `GO: v${input.version} is validated, checklisted, and approved by ${input.executiveApprover}. This authorizes promotion + GA GOVERNANCE. It does NOT assert real-world GA — external publication, customer production environments, and revenue remain pending.`
          : `NO-GO: v${input.version} — ${!input.rcReport.passed ? 'RC not passed; ' : ''}${!checklistComplete ? 'checklist incomplete; ' : ''}${!approverValid ? 'no real executive approver (approval never fabricated); ' : ''}risk=${riskLevel}.`,
    };
    this.results.set(result.id, result);
    await this.gov.record({
      operator: this.operator,
      version: input.version,
      environment: '_release',
      customerScope: '_all',
      epic: 'E4',
      operation: 'ga-gate',
      targetId: input.version,
      evidence: 'live-verified',
      decision,
      executiveApproval: approverValid ? 'approved' : 'pending',
    });
    return result;
  }

  list(): GaGateResult[] {
    return [...this.results.values()];
  }
}
