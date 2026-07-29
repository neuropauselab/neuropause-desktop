/**
 * EPIC 2 — Pilot Customer Program. A pilot registry, pilot readiness, success criteria, hypercare
 * tracking, a feedback registry, and a completion workflow. Pilot organizations are REPRESENTED until
 * contracted — <code>contracted</code> stays false and the pilot is business-data-pending; no real pilot
 * customer, adoption metric, or testimonial is fabricated. The workflow itself is real: a pilot cannot be
 * completed until its success criteria are actually met (deny-by-default).
 */
import { randomId } from '@neuropause/cloud-core';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface SuccessCriterion {
  label: string;
  met: boolean;
}
export interface PilotFeedback {
  note: string;
  rating: number;
}
export interface Pilot {
  id: string;
  organization: string;
  sponsor: string;
  status: 'represented' | 'active' | 'completed';
  contracted: boolean;
  criteria: SuccessCriterion[];
  feedback: PilotFeedback[];
  hypercareDays: number | null;
}

export class PilotProgram {
  private readonly pilots = new Map<string, Pilot>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  /** Register a pilot — REPRESENTED until a real contract exists. */
  async registerPilot(input: { organization: string; sponsor: string }): Promise<Pilot> {
    const pilot: Pilot = {
      id: randomId('pilot'),
      organization: input.organization,
      sponsor: input.sponsor,
      status: 'represented',
      contracted: false,
      criteria: [],
      feedback: [],
      hypercareDays: null,
    };
    this.pilots.set(pilot.id, pilot);
    await this.gov.record({ operator: this.operator, organization: input.organization, environment: 'pilot', version: '1.0.0', epic: 'E2', operation: 'register-pilot', targetId: pilot.id, evidence: 'business-data-pending', decision: 'represented' });
    return pilot;
  }

  async setSuccessCriteria(pilotId: string, labels: string[]): Promise<Pilot> {
    const pilot = this.require(pilotId);
    pilot.criteria = labels.map((label) => ({ label, met: false }));
    await this.gov.record({ operator: this.operator, organization: pilot.organization, environment: 'pilot', version: '1.0.0', epic: 'E2', operation: 'set-success-criteria', targetId: pilotId, evidence: 'live-verified', decision: `${labels.length} criteria` });
    return pilot;
  }

  async meetCriterion(pilotId: string, label: string): Promise<Pilot> {
    const pilot = this.require(pilotId);
    const criterion = pilot.criteria.find((c) => c.label === label);
    if (criterion) criterion.met = true;
    if (pilot.status === 'represented') pilot.status = 'active';
    await this.gov.record({ operator: this.operator, organization: pilot.organization, environment: 'pilot', version: '1.0.0', epic: 'E2', operation: 'meet-criterion', targetId: pilotId, evidence: 'live-verified', decision: label });
    return pilot;
  }

  /** Pilot readiness — a REAL check that criteria exist and a sponsor is named. */
  assessReadiness(pilotId: string): { ready: boolean; checks: Array<{ check: string; ok: boolean }> } {
    const pilot = this.require(pilotId);
    const checks = [
      { check: 'sponsor named', ok: pilot.sponsor.length > 0 },
      { check: 'success criteria defined', ok: pilot.criteria.length > 0 },
    ];
    return { ready: checks.every((c) => c.ok), checks };
  }

  async startHypercare(pilotId: string, durationDays: number): Promise<Pilot> {
    const pilot = this.require(pilotId);
    pilot.hypercareDays = durationDays;
    await this.gov.record({ operator: this.operator, organization: pilot.organization, environment: 'pilot', version: '1.0.0', epic: 'E2', operation: 'start-hypercare', targetId: pilotId, evidence: 'live-verified', decision: `${durationDays}d` });
    return pilot;
  }

  async recordFeedback(pilotId: string, input: { note: string; rating: number }): Promise<Pilot> {
    const pilot = this.require(pilotId);
    pilot.feedback.push({ note: input.note, rating: input.rating });
    await this.gov.record({ operator: this.operator, organization: pilot.organization, environment: 'pilot', version: '1.0.0', epic: 'E2', operation: 'record-feedback', targetId: pilotId, evidence: 'business-data-pending', decision: `rating:${input.rating}` });
    return pilot;
  }

  /** Complete a pilot — refused until every success criterion is actually met. */
  async completePilot(pilotId: string): Promise<{ pilot: Pilot; completed: boolean; note: string }> {
    const pilot = this.require(pilotId);
    const allMet = pilot.criteria.length > 0 && pilot.criteria.every((c) => c.met);
    if (!allMet) {
      await this.gov.record({ operator: this.operator, organization: pilot.organization, environment: 'pilot', version: '1.0.0', epic: 'E2', operation: 'complete-refused', targetId: pilotId, evidence: 'live-verified', decision: 'criteria unmet' });
      return { pilot, completed: false, note: 'completion refused — not all success criteria are met' };
    }
    pilot.status = 'completed';
    await this.gov.record({ operator: this.operator, organization: pilot.organization, environment: 'pilot', version: '1.0.0', epic: 'E2', operation: 'complete-pilot', targetId: pilotId, evidence: 'business-data-pending', decision: 'completed (represented)' });
    return { pilot, completed: true, note: 'pilot marked complete; a real contracted pilot remains business-data-pending' };
  }

  pilot(id: string): Pilot | undefined {
    return this.pilots.get(id);
  }
  pilotCount(): number {
    return this.pilots.size;
  }

  private require(id: string): Pilot {
    const p = this.pilots.get(id);
    if (!p) throw new Error(`unknown pilot: ${id}`);
    return p;
  }
}
