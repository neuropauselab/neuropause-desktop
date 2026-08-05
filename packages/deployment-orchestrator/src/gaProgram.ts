/**
 * EPIC 5 — General Availability Program. A GA checklist, release approval, executive approval, a go/no-go
 * decision, version promotion, and rollback governance. The go/no-go decision REUSES the Sprint-6 Release
 * GA gate: it runs the real RC validation, evaluates the checklist + executive approval + risk, and
 * returns a decision whose result is hard-flagged <code>releasedToRealWorld: false</code>. Version
 * promotion and rollback plans reuse the Release management runtime. No general availability to real
 * customers is ever claimed — GA readiness is decided; real-world release stays represented.
 */
import { type ReleaseChannel } from '@neuropause/release';
import type { DoContext } from './types';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface GaChecklistItem {
  item: string;
  done: boolean;
}
export interface GaGateOutcome {
  version: string;
  decision: string;
  rcPassed: boolean;
  checklistComplete: boolean;
  executiveApproved: boolean;
  readinessScore: number | null;
  releasedToRealWorld: false;
  reusedRelease: boolean;
  note: string;
}

export class GaProgram {
  private readonly checklists = new Map<string, GaChecklistItem[]>();

  constructor(
    private readonly ctx: DoContext,
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  async addChecklistItem(version: string, item: string): Promise<GaChecklistItem[]> {
    const list = this.checklists.get(version) ?? [];
    list.push({ item, done: false });
    this.checklists.set(version, list);
    await this.gov.record({ operator: this.operator, organization: '_ga', environment: '-', version, epic: 'E5', operation: 'add-checklist-item', targetId: version, evidence: 'live-verified', decision: item });
    return list;
  }

  async completeChecklistItem(version: string, item: string): Promise<GaChecklistItem[]> {
    const list = this.checklists.get(version) ?? [];
    const found = list.find((c) => c.item === item);
    if (found) found.done = true;
    await this.gov.record({ operator: this.operator, organization: '_ga', environment: '-', version, epic: 'E5', operation: 'complete-checklist-item', targetId: version, evidence: 'live-verified', decision: item });
    return list;
  }

  checklist(version: string): GaChecklistItem[] {
    return this.checklists.get(version) ?? [];
  }

  /** Evaluate the GA go/no-go gate — REUSES the Release RC validation + GA gate (releasedToRealWorld:false). */
  async evaluateGaGate(input: { version: string; executiveApprover?: string; risk?: 'low' | 'medium' | 'high' }): Promise<GaGateOutcome> {
    const checklist = this.checklist(input.version);
    if (this.ctx.release) {
      const rcReport = await this.ctx.release.rcValidation().validate({ version: input.version });
      const result = await this.ctx.release.gaGate().evaluate({
        version: input.version,
        rcReport,
        checklist,
        ...(input.executiveApprover ? { executiveApprover: input.executiveApprover } : {}),
        ...(input.risk ? { risk: input.risk } : {}),
      });
      await this.gov.record({ operator: this.operator, organization: '_ga', environment: '-', version: input.version, epic: 'E5', operation: 'ga-gate', targetId: input.version, evidence: 'live-verified', approval: input.executiveApprover ?? undefined, decision: result.decision });
      return {
        version: input.version,
        decision: result.decision,
        rcPassed: result.rcPassed,
        checklistComplete: result.checklistComplete,
        executiveApproved: result.executiveApproval.approved,
        readinessScore: result.readinessScore,
        releasedToRealWorld: false,
        reusedRelease: true,
        note: result.note,
      };
    }
    await this.gov.record({ operator: this.operator, organization: '_ga', environment: '-', version: input.version, epic: 'E5', operation: 'ga-gate', targetId: input.version, evidence: 'infrastructure-pending', decision: 'no release platform' });
    return { version: input.version, decision: 'no-go', rcPassed: false, checklistComplete: false, executiveApproved: false, readinessScore: null, releasedToRealWorld: false, reusedRelease: false, note: 'no Release platform wired in — GA gate represented until configured' };
  }

  /** Promote a version to a channel — REUSES the Release management runtime (a channel promotion, not a real-world release). */
  async promote(input: { version: string; channel: ReleaseChannel }): Promise<{ version: string; channel: ReleaseChannel; reusedRelease: boolean }> {
    if (this.ctx.release) {
      await this.ctx.release.releaseManagement().promote({ version: input.version, channel: input.channel });
      await this.gov.record({ operator: this.operator, organization: '_ga', environment: '-', version: input.version, epic: 'E5', operation: 'promote-version', targetId: input.version, evidence: 'live-verified', decision: input.channel });
      return { version: input.version, channel: input.channel, reusedRelease: true };
    }
    return { version: input.version, channel: input.channel, reusedRelease: false };
  }

  /** Rollback governance — REUSES the Release management rollback plan. */
  rollbackPlan(version: string): { version: string; steps: string[]; reusedRelease: boolean } {
    if (this.ctx.release) {
      const plan = this.ctx.release.releaseManagement().rollbackPlan(version);
      return { version, steps: plan.steps, reusedRelease: true };
    }
    return { version, steps: [], reusedRelease: false };
  }
}
