/**
 * Experience Profile — how this install is used: which workspace type the user
 * chose at first run, whether the first-run experience is finished, and which
 * AI mode was selected during it.
 *
 * One product, three presentations. Personal, Professional and Business are
 * NOT separate applications and not separate data stores — they are nav and
 * emphasis over the same NeuroPause platform. That is why "upgrading" from
 * Personal to Professional is a one-field change and loses nothing: the
 * documents, knowledge, AI preferences and local data are the same records
 * before and after. The profile stores the choice; the sections registry and
 * the workspace-type filter render it.
 */

export type WorkspaceType = 'personal' | 'professional' | 'business';

export const WORKSPACE_TYPES: readonly WorkspaceType[] = ['personal', 'professional', 'business'];

export const WORKSPACE_TYPE_LABELS: Record<WorkspaceType, string> = {
  personal: 'Personal',
  professional: 'Professional',
  business: 'Business / Enterprise',
};

export const WORKSPACE_TYPE_TAGLINES: Record<WorkspaceType, string> = {
  personal: 'Your private AI workspace',
  professional: 'Your private AI workspace for work',
  business: 'AI for your organization',
};

/** What each type surfaces, in the user's words. Rendered on the chooser. */
export const WORKSPACE_TYPE_INCLUDES: Record<WorkspaceType, readonly string[]> = {
  personal: [
    'Personal knowledge',
    'Documents and notes',
    'Planning and research',
    'Private AI conversations',
    'Local files',
  ],
  professional: [
    'Business documents and knowledge',
    'Finance and operations',
    'Customers and projects',
    'Business analysis',
    'Governed AI actions',
  ],
  business: [
    'Private and local AI',
    'Business data intelligence',
    'Governance, permissions and audit',
    'Provenance and enterprise workflows',
    'AI workforce with controlled execution',
  ],
};

/**
 * The first-run experience state machine. `pending` shows the experience;
 * `completed` and `skipped` both suppress it — they differ only in what the
 * user did, which analytics and the Welcome surface may care about.
 */
export type FirstRunExperienceState = 'pending' | 'completed' | 'skipped';

export interface ExperienceProfile {
  state: FirstRunExperienceState;
  workspaceType: WorkspaceType | null;
  /** True once the user made an explicit AI-mode choice during first run. */
  aiModeChosen: boolean;
  completedAt: string | null;
  updatedAt: string | null;
}

export function defaultExperienceProfile(): ExperienceProfile {
  return { state: 'pending', workspaceType: null, aiModeChosen: false, completedAt: null, updatedAt: null };
}
