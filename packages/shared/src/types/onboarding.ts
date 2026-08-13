/**
 * Onboarding: the first-run step catalog and status shapes, shared so the main
 * process (which owns persisted state) and the renderer (wizard + welcome
 * checklist) agree. Steps deep-link into existing surfaces — the connector step
 * uses the existing Connectors flow, the AI step the existing local AI stack —
 * rather than duplicating them.
 */
/**
 * THE STEP IDS, ONCE. P13C ROUND 17.
 *
 * This was a hand-written union, and `OnboardingCompleteStepRequest` in
 * `ipc/contracts.ts` was a hand-written `z.enum([...])` of the same field. The
 * two lists disagreed by exactly one entry — `'legal'`, the EULA and privacy
 * acknowledgement added in Phase 8 (8.13) — so the wizard's second step sent a
 * value the bridge validator refused, and NO INSTALL COULD COMPLETE ONBOARDING.
 * Nothing caught it: `completeStep(step: OnboardingStepId)` typechecks against
 * the union, and the enum is a separate description that TypeScript never
 * compares it to.
 *
 * The correct pattern already existed two lines above the drift, in the same
 * file that carried it — `HELP_DOC_IDS` is a const tuple, `z.enum(HELP_DOC_IDS)`
 * consumes it, and `HelpDocId` derives from it. Onboarding now does the same,
 * so the validator and the type cannot disagree: there is one list.
 */
export const ONBOARDING_STEP_IDS = [
  'welcome',
  'legal',
  'organization',
  'connectors',
  'ai_setup',
  'pilot',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

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
    // Phase 8 (8.13): the license + privacy notice, presented at first run.
    // Completing this step records that the documents were shown and
    // acknowledged (timestamped in the onboarding store).
    id: 'legal',
    title: 'Review the license & privacy notice',
    description: 'Read the EULA and the privacy notice bundled with this build, then mark them reviewed.',
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
    description: 'Choose your AI provider and add a key — or use local Ollama — in Settings.',
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
