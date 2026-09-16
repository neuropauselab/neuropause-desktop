/**
 * Private-First experience — the renderer view model.
 *
 * Every judgement the first-run experience, the AI Home and the workspace-type
 * nav make lives here, pure and tested: which sections a workspace type shows,
 * what the processing badge says, how the "Why?" answer reads, which suggested
 * actions a user can actually execute, and what the usage numbers may claim.
 *
 * The components decide layout. They do not decide meaning.
 */
import type {
  AiRoutingMetadata,
  AiRoutingUsage,
  ProcessingLocation,
  UnderstandingAttribute,
  WorkspaceType,
} from '@neuropause/shared';
import {
  PROCESSING_LOCATION_DESCRIPTIONS,
  PROCESSING_LOCATION_LABELS,
  explainRouting,
  isVerifiedAttribute,
  routingUsagePercentages,
} from '@neuropause/shared';
import type { SectionDef, SectionId } from '@renderer/shell/sections';
import { LOCAL_FIRST_STORY } from '../localFirst/story';

/* ── workspace-type navigation ─────────────────────────────────────────────── */

/**
 * The sections a PERSONAL workspace shows. A curation, not a capability wall:
 * the platform underneath is identical, RBAC still governs every call, and
 * switching to Professional is a one-field profile change that reveals the
 * rest. Chosen to match what Personal promises — knowledge, documents, notes,
 * planning, research, private AI, local files — plus the system surfaces
 * (settings, welcome) nothing should ever hide.
 */
const PERSONAL_SECTIONS: readonly SectionId[] = [
  'ai-home',
  // Understanding and Holds are not enterprise features — they are the two
  // promises the product makes to every user ("here is what I think I know"
  // and "here is what I won't do without you"), so a Personal workspace keeps
  // both. Hiding them would make first-run's "you can correct this later" false.
  'understand',
  'holds',
  'mission-control',
  'search',
  'assistant',
  'hub',
  'memory',
  'knowledge',
  'data-center',
  'workspace',
  'store',
  'notifications',
  'settings',
  'welcome',
];

/**
 * Sections a PROFESSIONAL workspace hides — the platform/company-operations
 * layers that only make sense with an organization around them. Everything
 * else (the business suite, data, AI surfaces) shows.
 */
const PROFESSIONAL_HIDDEN: readonly SectionId[] = [
  'cloud',
  'control-plane',
  'federation',
  'federation-center',
  'infrastructure',
  'ecosystem',
  'developer-center',
  'commercial-center',
];

/**
 * Whether a section is visible for a workspace type. `null` type (profile not
 * yet chosen, or pre-experience installs) shows everything — the pre-existing
 * behaviour, unchanged.
 */
export function sectionVisibleFor(type: WorkspaceType | null, id: SectionId): boolean {
  if (type === 'personal') return PERSONAL_SECTIONS.includes(id);
  if (type === 'professional') return !PROFESSIONAL_HIDDEN.includes(id);
  return true; // business, or no choice made
}

/** Filter the real section registry for a workspace type. Order untouched. */
export function visibleSectionsFor(
  type: WorkspaceType | null,
  sections: readonly SectionDef[],
): SectionDef[] {
  return sections.filter((s) => sectionVisibleFor(type, s.id));
}

/* ── processing badge ──────────────────────────────────────────────────────── */

export type BadgeTone = 'good' | 'neutral' | 'warn';

export interface ProcessingBadgeModel {
  label: string;
  description: string;
  tone: BadgeTone;
  /** The full "Why?" answer, from the execution metadata only. */
  why: string;
  location: ProcessingLocation;
  /**
   * BRAIN-1 — the concrete model that served, named ONLY when one genuinely ran.
   * Null for the zero-model / deterministic path (`referenceDrafter`, fallbacks),
   * where `location`/`model` are 'none'. The badge never invents a model name.
   */
  modelName: string | null;
}

/**
 * The badge for a completed response. Returns null when the envelope carries no
 * metadata (old persisted turns): absence renders as nothing, never as a guess.
 */
export function processingBadge(meta: AiRoutingMetadata | null | undefined): ProcessingBadgeModel | null {
  if (!meta) return null;
  const tone: BadgeTone =
    meta.location === 'local' || meta.location === 'private_infrastructure'
      ? 'good'
      : meta.location === 'external'
        ? 'warn'
        : 'neutral';
  return {
    label: PROCESSING_LOCATION_LABELS[meta.location],
    description: PROCESSING_LOCATION_DESCRIPTIONS[meta.location],
    tone,
    why: explainRouting(meta),
    location: meta.location,
    // Name a model only when one genuinely served; 'none'/deterministic → null.
    modelName: meta.location === 'none' || meta.model === 'none' || meta.model.trim() === '' ? null : meta.model,
  };
}

/** The in-flight indicator, from the CURRENT routing plan (pre-execution). */
export function processingIndicatorText(
  planFirstLocation: ProcessingLocation | null,
): string {
  switch (planFirstLocation) {
    case 'local':
      return 'Processing locally…';
    case 'private_infrastructure':
      return 'Processing through your private infrastructure…';
    case 'external':
      return 'Processing through an enabled external provider…';
    default:
      // No plan information — an honest generic state, not a fabricated source.
      return 'Working…';
  }
}

/* ── suggested actions ─────────────────────────────────────────────────────── */

/** What the AI Home knows about this install when composing suggestions. */
export interface CapabilitySnapshot {
  workspaceType: WorkspaceType | null;
  /** Modules with at least one record (from `dp:exportable`). */
  populatedModules: number;
  /** The Data Command Center exists and can import. */
  canImport: boolean;
  /** An AI route is currently available (routing plan is non-empty). */
  aiAvailable: boolean;
  /**
   * What NeuroPause understands about the user. Only CONFIRMED attributes
   * (stated / corrected) may shape a suggestion — personalising off an
   * unconfirmed inference is exactly how a guess starts behaving like a fact.
   */
  understanding?: readonly UnderstandingAttribute[];
  /** Open holds — work already waiting on this person. */
  openHolds?: number;
}

export interface SuggestedAction {
  id: string;
  label: string;
  /** 'ask' pre-fills the ask box; 'navigate' deep-links a section. */
  kind: 'ask' | 'navigate';
  prompt?: string;
  section?: SectionId;
}

/**
 * Capability-aware suggestions. The rule: never offer what cannot execute.
 * Asking requires an available AI route; analysis over business records
 * requires records; import requires the Data Command Center. Everything
 * offered here lands on a real path — a prefilled ask through the real
 * assistant, or a navigation into a real section.
 */
export function suggestedActions(snapshot: CapabilitySnapshot): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  // Real work waiting on a person outranks anything NeuroPause could suggest.
  if ((snapshot.openHolds ?? 0) > 0) {
    out.push({
      id: 'open-holds',
      label: `Resolve ${snapshot.openHolds} hold${snapshot.openHolds === 1 ? '' : 's'}`,
      kind: 'navigate',
      section: 'holds',
    });
  }
  // Personalisation from the user's OWN CONFIRMED words. An inference never
  // reaches this list: a suggestion is a claim about what you care about, and
  // making that claim from a guess is how the product starts feeling wrong.
  const domain = confirmedValue(snapshot.understanding, 'domain');
  if (domain && snapshot.aiAvailable) {
    out.push({
      id: 'domain-opportunities',
      label: `Find opportunities in ${domain.toLowerCase()}`,
      kind: 'ask',
      prompt: `Find opportunities in my ${domain.toLowerCase()} work, using only my real records. Say so where evidence is missing.`,
    });
  }
  if (snapshot.aiAvailable) {
    out.push({ id: 'summarize-docs', label: 'Summarize my documents', kind: 'ask', prompt: 'Summarize my documents.' });
    out.push({ id: 'plan-day', label: 'Find the important tasks for today', kind: 'ask', prompt: 'Find the important tasks for today.' });
  }
  if (snapshot.workspaceType !== 'personal' && snapshot.populatedModules > 0 && snapshot.aiAvailable) {
    out.push({ id: 'todays-work', label: "Review today's work", kind: 'ask', prompt: 'Summarize my work today.' });
    out.push({ id: 'followups', label: 'Prepare a customer follow-up list', kind: 'ask', prompt: 'Prepare a customer follow-up list.' });
  }
  if (snapshot.canImport) {
    out.push({ id: 'import-data', label: 'Import a spreadsheet', kind: 'navigate', section: 'data-center' });
  }
  if (!snapshot.aiAvailable) {
    out.push({ id: 'setup-ai', label: 'Set up AI processing', kind: 'navigate', section: 'settings' });
  }
  return out;
}

/**
 * The value of an attribute ONLY if a person stated or corrected it.
 * Inferred / imported / derived values return null — they are real knowledge,
 * but they are not the user's word, and a suggestion speaks in the user's word.
 */
function confirmedValue(
  attributes: readonly UnderstandingAttribute[] | undefined,
  key: string,
): string | null {
  const found = attributes?.find((a) => a.key === key);
  return found && isVerifiedAttribute(found) ? found.value : null;
}

/* ── usage display ─────────────────────────────────────────────────────────── */

export interface UsageDisplay {
  /** Null until anything has been measured — the UI shows the waiting copy. */
  rows: { location: ProcessingLocation; label: string; count: number; pct: number }[] | null;
  total: number;
  emptyMessage: string;
}

/**
 * The AI Usage view. Percentages exist ONLY when computed from measured
 * counts; with zero measurements the display is the waiting message, never a
 * placeholder number.
 */
export function usageDisplay(usage: AiRoutingUsage | null): UsageDisplay {
  const emptyMessage = 'Usage data will appear after you use NeuroPause.';
  if (!usage || usage.total === 0) return { rows: null, total: 0, emptyMessage };
  const pct = routingUsagePercentages(usage);
  if (!pct) return { rows: null, total: 0, emptyMessage };
  const order: ProcessingLocation[] = ['local', 'private_infrastructure', 'external', 'none'];
  return {
    rows: order
      .filter((location) => usage.byLocation[location] > 0)
      .map((location) => ({
        location,
        label: PROCESSING_LOCATION_LABELS[location],
        count: usage.byLocation[location],
        pct: pct[location],
      })),
    total: usage.total,
    emptyMessage,
  };
}

/**
 * Intelligence economics — "how much AI did NeuroPause actually need?".
 * Computed ONLY from measured counters (engine runs + engineless deterministic
 * turns). Null until anything is measured; never an invented percentage.
 */
export function economicsLine(usage: AiRoutingUsage | null): string | null {
  if (!usage || usage.total === 0) return null;
  const withoutExternal = usage.total - usage.byLocation.external;
  const pct = Math.round((withoutExternal / usage.total) * 100);
  return `${pct}% of ${usage.total} measured requests were answered without an external AI provider.`;
}

/* ── Business information architecture (render-only regrouping) ───────────── */

/**
 * The Business-profile sidebar groups. A RENDER mapping over the untouched
 * SECTIONS registry: section ids are assigned a user-goal group; ids absent
 * here fall back to their registry group. No section is added, removed,
 * reordered inside a group, or renamed — capability gating and nav locks are
 * untouched.
 */
export const BUSINESS_NAV_GROUPS = [
  'today',
  'business',
  'work',
  'data',
  'operations',
  'intelligence',
  'system',
] as const;
export type BusinessNavGroup = (typeof BUSINESS_NAV_GROUPS)[number];

export const BUSINESS_NAV_GROUP_LABELS: Record<BusinessNavGroup, string> = {
  today: 'Today',
  business: 'Business',
  work: 'Work',
  data: 'Data',
  operations: 'Operations',
  intelligence: 'Intelligence',
  system: 'System',
};

const BUSINESS_GROUP_OF: Partial<Record<SectionId, BusinessNavGroup>> = {
  'mission-control': 'today',
  'intent-home': 'today',
  'ai-home': 'today',
  search: 'today',
  assistant: 'today',
  hub: 'today',
  business: 'business',
  enterprise: 'business',
  'medical-devices': 'business',
  organization: 'work',
  workspace: 'work',
  workforce: 'work',
  'workforce-center': 'work',
  collaboration: 'work',
  'data-center': 'data',
  knowledge: 'data',
  'knowledge-center': 'data',
  memory: 'data',
  operations: 'operations',
  opscenter: 'operations',
  'ai-operations': 'operations',
  'automation-center': 'operations',
  'auto-ops-center': 'operations',
  connectors: 'operations',
  intelligence: 'intelligence',
  analytics: 'intelligence',
  'twin-center': 'intelligence',
  'strategy-center': 'intelligence',
  'product-ops': 'intelligence',
  administration: 'system',
  settings: 'system',
  welcome: 'system',
  notifications: 'system',
};

/** The Business-IA group for a section (falls back to a sensible bucket). */
export function businessGroupFor(id: SectionId, registryGroup: string | undefined): BusinessNavGroup {
  const mapped = BUSINESS_GROUP_OF[id];
  if (mapped) return mapped;
  // Unmapped platform/advanced surfaces keep operating under Operations,
  // matching their registry intent, rather than vanishing.
  if (registryGroup === 'system') return 'system';
  if (registryGroup === 'today') return 'today';
  return 'operations';
}

/* ── Business attention (real counts only) ─────────────────────────────────── */

/** One attention tile — rendered only when its query SUCCEEDED. */
export interface AttentionItem {
  id: string;
  label: string;
  count: number;
  section: SectionId;
}

/**
 * The attention headline. Zero everywhere is a statement about the business,
 * not an empty screen: it renders as "No items requiring attention."
 */
export function attentionSummary(items: readonly AttentionItem[]): string {
  const active = items.filter((i) => i.count > 0);
  if (active.length === 0) return 'No items requiring attention.';
  return active.map((i) => `${i.count} ${i.label.toLowerCase()}`).join(' · ');
}

/* ── first-run copy (single source, asserted by test) ──────────────────────── */

export const FIRST_RUN_COPY = {
  headline: 'Your AI. Your Data. Your Control.',
  // S39 (F-S17-1): the DOOR half of the single local-first story (localFirst/story.ts) — a door, not a claim.
  supporting: LOCAL_FIRST_STORY.doorSupporting,
  primaryCta: LOCAL_FIRST_STORY.door,
  secondaryCta: 'Sign In',
  processingQuestion: 'Where should your AI work?',
  onDevice: {
    title: 'On this device',
    body: 'Your local AI workspace is designed to keep supported processing on your device. AI runs through a local model; if none is available, requests fail here rather than being sent anywhere.',
  },
  withCloud: {
    title: 'With approved cloud AI',
    body: 'Keep Private First routing, and allow an external provider you enable as a fallback when no local model can serve a request.',
  },
  workspaceQuestion: 'How do you want to use NeuroPause?',
} as const;

/* ── P13C ROUND 36 — GATE 13: resume where the user left off ──────────────── */

export type FirstRunStep = 'welcome' | 'processing' | 'workspace' | 'discovery' | 'understanding';

/**
 * The step a PENDING profile resumes at, derived from what is already
 * persisted. `experienceProfileService` has promised since round 17 that
 * "quitting mid-flow loses nothing already chosen and the experience resumes
 * where it left off" — but the step lived in `useState('welcome')` and never
 * read the profile, so a user who quit after choosing Business + AI mode
 * relaunched at the welcome headline and re-walked every screen. Pure, so the
 * rule is testable: each persisted milestone advances past its own step, and
 * an untouched profile starts at the beginning.
 */
export function resumeStep(profile: {
  aiModeChosen: boolean;
  workspaceType: string | null;
}): FirstRunStep {
  if (profile.workspaceType !== null) return 'discovery';
  if (profile.aiModeChosen) return 'workspace';
  return 'welcome';
}
