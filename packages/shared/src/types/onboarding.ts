/**
 * Onboarding: the first-run step catalog and status shapes, shared so the main
 * process (which owns persisted state) and the renderer (wizard + welcome
 * checklist) agree. Steps deep-link into existing surfaces — the connector step
 * uses the existing Connectors flow, the AI step the existing local AI stack —
 * rather than duplicating them.
 */
export type OnboardingStepId = 'welcome' | 'organization' | 'connectors' | 'ai_setup' | 'pilot';

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  title: string;
  description: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStepDefinition[] = [
  {
    id: 'welcome',
    title: 'Welcome to NeuroPause',
    description: 'A quick tour of the workspace and what early access includes.',
  },
  {
    id: 'organization',
    title: 'Set up your organization',
    description: 'Create or join the organization your work will live in.',
  },
  {
    id: 'connectors',
    title: 'Connect your first source',
    description: 'Link GitHub, Notion, Slack, or Calendar so the AI has real evidence.',
  },
  {
    id: 'ai_setup',
    title: 'Set up the AI engine',
    description: 'Check the local AI engine and pick the model that will do the thinking.',
  },
  {
    id: 'pilot',
    title: 'Choose pilot mode',
    description: 'Opt in to pilot mode to share feedback and shape the product.',
  },
];

export interface OnboardingStepInfo extends OnboardingStepDefinition {
  /** When the step was completed (null if not yet). */
  completedAt: string | null;
}

export interface OnboardingStatus {
  /** True until onboarding has been started or dismissed on this install. */
  firstRun: boolean;
  startedAt: string | null;
  /** Set when every step is done, or when the wizard is dismissed. */
  completedAt: string | null;
  steps: OnboardingStepInfo[];
  /** The first incomplete step (null when all steps are done). */
  nextStep: OnboardingStepId | null;
}
