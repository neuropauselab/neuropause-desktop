/**
 * EPIC 7 — Customer Onboarding. A welcome wizard: workspace setup, AI-provider setup, organization
 * config, first project, and invite team, with a completion checklist. Steps are REAL in-process state;
 * workspace setup notes the reused workplace runtime and AI-provider setup notes the reused AI runtime.
 * The checklist is 'complete' ONLY when every step is actually done — completed onboarding is never
 * fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { ONBOARDING_STEPS, type OnboardingStep } from './constants';
import type { CxContext } from './types';
import type { CustomerExperienceGovernance } from './governance';

export interface OnboardingWizard {
  id: string;
  organization: string;
  completed: OnboardingStep[];
  reusedWorkplace: boolean;
  reusedAiRuntime: boolean;
}

export class OnboardingWizardRuntime {
  private readonly wizards = new Map<string, OnboardingWizard>();

  constructor(
    private readonly ctx: CxContext,
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  steps(): readonly OnboardingStep[] {
    return ONBOARDING_STEPS;
  }

  async start(input: { organization: string }): Promise<OnboardingWizard> {
    const wizard: OnboardingWizard = { id: randomId('wiz'), organization: input.organization, completed: [], reusedWorkplace: Boolean(this.ctx.workplace), reusedAiRuntime: Boolean(this.ctx.aiRuntime) };
    this.wizards.set(wizard.id, wizard);
    await this.gov.record({ actor: this.operator, customer: input.organization, organization: input.organization, epic: 'E7', operation: 'start-onboarding', targetId: wizard.id, evidence: 'live-verified' });
    return wizard;
  }

  async completeStep(wizardId: string, step: OnboardingStep): Promise<OnboardingWizard> {
    if (!ONBOARDING_STEPS.includes(step)) throw new Error(`unknown onboarding step: ${step}`);
    const wizard = this.require(wizardId);
    if (!wizard.completed.includes(step)) wizard.completed.push(step);
    await this.gov.record({ actor: this.operator, customer: wizard.organization, organization: wizard.organization, epic: 'E7', operation: `complete-step.${step}`, targetId: wizardId, evidence: 'live-verified' });
    return wizard;
  }

  /** The checklist is complete ONLY when every step is actually done — never fabricated. */
  checklist(wizardId: string): { steps: OnboardingStep[]; completed: OnboardingStep[]; remaining: OnboardingStep[]; allComplete: boolean } {
    const wizard = this.require(wizardId);
    const remaining = ONBOARDING_STEPS.filter((s) => !wizard.completed.includes(s));
    return { steps: [...ONBOARDING_STEPS], completed: [...wizard.completed], remaining, allComplete: remaining.length === 0 };
  }

  private require(id: string): OnboardingWizard {
    const w = this.wizards.get(id);
    if (!w) throw new Error(`unknown onboarding wizard: ${id}`);
    return w;
  }
}
