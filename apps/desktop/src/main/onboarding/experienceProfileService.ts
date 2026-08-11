/**
 * Experience Profile service — persisted first-run decisions: whether the
 * first-run experience is pending/completed/skipped, which workspace type the
 * user chose, and whether they made an explicit AI-mode choice.
 *
 * Sits beside the existing onboarding checklist service and does not replace
 * it: the checklist tracks the guided steps (legal, org, connectors, AI key),
 * this profile tracks the PRODUCT SHAPE decisions the new first-run experience
 * collects. Non-secret by construction — AI keys stay in the Secure Vault, and
 * nothing here is worth encrypting beyond the store's 0600 file mode.
 *
 * Partial writes are the point: each decision persists the moment it is made,
 * so quitting mid-flow loses nothing already chosen and the experience resumes
 * where it left off.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { ExperienceProfile, UnderstandingAttribute, WorkspaceType } from '@neuropause/shared';
import { defaultExperienceProfile } from '@neuropause/shared';
import { readStoreFile } from '../storage/storeEnvelope';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'experience-profile',
  scope: 'USER',
  persistence: 'file',
  authority: 'USER',
  // NOT `USER_PREFERENCE`, and the distinction is the point. `state`,
  // `workspaceType` and `aiModeChosen` are preferences. `attributes` are not:
  // `AttributeStatus` includes `imported`, `connected` and `system_derived`
  // ("computed from real records"), so the VOCABULARY admits values derived from
  // a customer's data even where today's only writer is the first-run flow. The
  // classification follows what the store may hold, not what it happens to.
  classification: 'CUSTOMER_DERIVED',
  retention:
    'One record. `set` upserts attributes by key and `removeKeys` deletes by key — both inside this ' +
    'one profile, so neither can reach anything else. `reset` returns the whole profile to defaults ' +
    'and is the only destructive path. There is no list and no cap, so no write evicts anything.',
  reason:
    "WHY USER: the profile is a model of one person's own words about themselves — role, domain, " +
    'priorities — and it deliberately follows them across organizations, which is what USER scope ' +
    'means here and why `enterprise-personalization` is declared the same way. WHAT DATA: the ' +
    'first-run decisions (pending/completed/skipped, workspace type, whether an AI mode was chosen) ' +
    'plus `UnderstandingAttribute[]`, each carrying a key, a value, a provenance status and a ' +
    'plain-language evidence sentence. THE SEAM, STATED HONESTLY: the boundary is the operating-' +
    "system account — one `experience-profile.json` under that account's userData directory — and " +
    'NOT an in-app identity resolver. Two people who share one macOS account and sign in to ' +
    'NeuroPause in turn share this profile. That is a real limit of a per-device file, it is not ' +
    'closed by this declaration, and `isBound` is deliberately omitted rather than pointed at a ' +
    'resolver that does not exist.',
});

export interface ExperienceProfilePatch {
  workspaceType?: WorkspaceType;
  state?: 'completed' | 'skipped';
  aiModeChosen?: boolean;
  /**
   * Understanding attributes to upsert (matched by key). A write with status
   * 'corrected' supersedes an inference; provenance is always preserved on
   * the attribute itself, so a correction is visible as a correction.
   */
  attributes?: UnderstandingAttribute[];
  /**
   * Attribute keys to forget. A profile you can only add to is a profile you
   * do not control — "that's wrong, and there is no right answer" has to be
   * expressible, not just "that's wrong, here is a different value".
   */
  removeKeys?: string[];
}

export interface ExperienceProfileService {
  load(): Promise<void>;
  get(): ExperienceProfile;
  set(patch: ExperienceProfilePatch): Promise<ExperienceProfile>;
  /** QA/support: return to a first-run state. */
  reset(): Promise<ExperienceProfile>;
}

export function createExperienceProfileService(opts: {
  filePath: string;
  now?: () => Date;
  /**
   * Called when a decision is recorded — the seam the telemetry events hang
   * from (`workspace_type_selected`, `onboarding_completed`). Receives the
   * event name and nothing else: no content, no prompt, nothing user-authored.
   */
  onEvent?: (event: string) => void;
}): ExperienceProfileService {
  const now = opts.now ?? ((): Date => new Date());
  const onEvent = opts.onEvent ?? ((): void => {});
  let profile: ExperienceProfile = defaultExperienceProfile();
  let loaded = false;

  async function persist(): Promise<void> {
    const tmp = `${opts.filePath}.tmp`;
    await fs.mkdir(dirname(opts.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify({ version: 1, ...profile }), { mode: 0o600 });
    await fs.rename(tmp, opts.filePath);
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    const result = await readStoreFile<Partial<ExperienceProfile>>(opts.filePath);
    if (result.state === 'loaded' && result.data) {
      const raw = result.data;
      const base = defaultExperienceProfile();
      profile = {
        state:
          raw.state === 'completed' || raw.state === 'skipped' || raw.state === 'pending'
            ? raw.state
            : base.state,
        workspaceType:
          raw.workspaceType === 'personal' ||
          raw.workspaceType === 'professional' ||
          raw.workspaceType === 'business'
            ? raw.workspaceType
            : null,
        aiModeChosen: raw.aiModeChosen === true,
        attributes: coerceAttributes(raw.attributes),
        completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      };
    }
    loaded = true;
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    get(): ExperienceProfile {
      return { ...profile };
    },

    async set(patch: ExperienceProfilePatch): Promise<ExperienceProfile> {
      await ensureLoaded();
      const at = now().toISOString();
      const next: ExperienceProfile = { ...profile, updatedAt: at };
      if (patch.workspaceType && patch.workspaceType !== profile.workspaceType) {
        next.workspaceType = patch.workspaceType;
        onEvent('workspace_type_selected');
      }
      if (patch.aiModeChosen === true && !profile.aiModeChosen) {
        next.aiModeChosen = true;
        onEvent('ai_mode_selected');
      }
      if (patch.attributes && patch.attributes.length > 0) {
        // Upsert by key. A correction REPLACES the belief but the replacement
        // carries status 'corrected' — an inference is never silently kept
        // alongside the fact that overrode it.
        const byKey = new Map(next.attributes.map((a) => [a.key, a]));
        for (const attr of patch.attributes) {
          byKey.set(attr.key, { ...attr, updatedAt: at });
        }
        next.attributes = [...byKey.values()];
        onEvent('understanding_updated');
      }
      if (patch.removeKeys && patch.removeKeys.length > 0) {
        const drop = new Set(patch.removeKeys);
        const before = next.attributes.length;
        next.attributes = next.attributes.filter((a) => !drop.has(a.key));
        if (next.attributes.length !== before) onEvent('understanding_updated');
      }
      if (patch.state && profile.state === 'pending') {
        next.state = patch.state;
        next.completedAt = at;
        onEvent(patch.state === 'completed' ? 'onboarding_completed' : 'onboarding_skipped');
      }
      profile = next;
      await persist();
      return { ...profile };
    },

    async reset(): Promise<ExperienceProfile> {
      await ensureLoaded();
      profile = defaultExperienceProfile();
      await persist();
      return { ...profile };
    },
  };
}

const VALID_STATUS = new Set(['stated', 'inferred', 'corrected', 'imported', 'connected', 'system_derived']);

function coerceAttributes(raw: unknown): UnderstandingAttribute[] {
  if (!Array.isArray(raw)) return [];
  const out: UnderstandingAttribute[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Partial<UnderstandingAttribute>;
    if (typeof a.key !== 'string' || !a.key || typeof a.value !== 'string') continue;
    out.push({
      key: a.key,
      label: typeof a.label === 'string' ? a.label : a.key,
      value: a.value,
      status: VALID_STATUS.has(a.status as string) ? (a.status as UnderstandingAttribute['status']) : 'stated',
      source: typeof a.source === 'string' ? a.source : '',
      updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : '',
    });
  }
  return out;
}
