/**
 * AI Routing — the Private First model.
 *
 * "Private First" is a ROUTING POLICY, not a marketing label. This file is the
 * policy: given the AI mode, the candidate routes that exist, and whether the
 * user has consented to external processing, `planRoute` produces the ordered
 * list of routes a request may take — or an explicit refusal that names why the
 * request will not run at all.
 *
 * The rule that everything else here serves: **a claim about where processing
 * happened must come from the execution, never from the configuration.** The
 * badge the user sees is derived from `AiRoutingMetadata` stamped by the client
 * that actually completed the request. Nothing in the renderer infers a
 * location; nothing displays a location for a request that produced none.
 *
 * Pure: no I/O, no Electron. Every decision is testable by calling a function.
 */

/* ── locations ─────────────────────────────────────────────────────────────── */

/**
 * Where a piece of AI processing physically ran.
 *
 * `none` is a real state, not an error: the assistant answers many requests
 * deterministically (computed findings, reports) without invoking any model.
 * That computation happens on-device, but claiming "LOCAL AI" for it would
 * overstate what ran — so it is its own state with its own honest label.
 */
export type ProcessingLocation = 'local' | 'private_infrastructure' | 'external' | 'none';

export const PROCESSING_LOCATIONS: readonly ProcessingLocation[] = [
  'local',
  'private_infrastructure',
  'external',
  'none',
];

export const PROCESSING_LOCATION_LABELS: Record<ProcessingLocation, string> = {
  local: 'Local',
  private_infrastructure: 'Private infrastructure',
  external: 'External AI',
  none: 'No AI model',
};

/** The one-line description each location renders under its badge. */
export const PROCESSING_LOCATION_DESCRIPTIONS: Record<ProcessingLocation, string> = {
  local: 'Processed locally on this device.',
  private_infrastructure: 'Processed through your configured private AI infrastructure.',
  external: 'Processed through an enabled external AI provider.',
  none: 'No AI model ran — this result was computed deterministically on this device.',
};

/* ── modes ─────────────────────────────────────────────────────────────────── */

/**
 * The AI mode — the user's standing instruction for where AI work may run.
 *
 * `private_first`  Prefer local; fall back to private infrastructure; use an
 *                  external provider only when external consent is on.
 * `local_only`     Never use an external provider. If no local or private
 *                  route is available, the request FAILS, on this device,
 *                  with a message saying so — it never silently escalates.
 * `external`       Use the configured provider directly (the pre-existing
 *                  behaviour, kept for installs that were already set up
 *                  with a cloud key before this mode existed).
 */
export type AiMode = 'private_first' | 'local_only' | 'external';

export const AI_MODES: readonly AiMode[] = ['private_first', 'local_only', 'external'];

export const AI_MODE_LABELS: Record<AiMode, string> = {
  private_first: 'Private First',
  local_only: 'Local Only',
  external: 'External Provider',
};

/* ── tenant preference (P13C Round 17, decision D-5) ───────────────────────── */

/**
 * WHAT AN ORGANIZATION MAY ASK FOR — AND WHY IT IS TWO VALUES, NOT THREE.
 *
 * `ai:config.setMode` is `cloud:operate`: one `ai-config.json` per machine, and
 * changing where AI work may run is an INSTALL-level act. That is correct and
 * D-5 keeps it. But first-run asked every new user that platform question, and
 * a fresh install has no platform operator by design, so onboarding dead-ended
 * on its own authority model.
 *
 * The fix is a tenant preference that can only ever RESTRICT. It is deliberately
 * a two-value type: `external` is not offered, so an organization asking to be
 * elevated into direct external routing is not something the resolver refuses —
 * it is something the type cannot express. Same idiom as the branded
 * `TenantReadGrant` and `EnterpriseOrgGet`'s `EmptyRequest`: remove the
 * parameter rather than guard it.
 */
export type TenantAiMode = 'local_only' | 'private_first';

export const TENANT_AI_MODES = ['local_only', 'private_first'] as const;

/**
 * Permissiveness order over `AiMode`. Lower is stricter.
 *
 * The three modes are TOTALLY ORDERED, which is what makes the intersection a
 * `min()` and its proof exhaustive rather than exemplary.
 */
const AI_MODE_RANK: Record<AiMode, number> = {
  local_only: 0,
  private_first: 1,
  external: 2,
};

/**
 * THE ONE RESOLVER. `effective = min(platform, tenant)`.
 *
 * The security property, stated as a law rather than a behaviour: for every
 * platform policy P and every tenant preference T,
 *
 *     rank(effective(P, T)) <= rank(P)
 *
 * so a tenant can narrow what the platform permits and can never widen it.
 * `resolveEffectiveAiMode` accepts a full `AiMode` on the tenant side only so
 * that the law can be tested across all nine combinations including the value
 * the store cannot persist — the proof covers inputs the product cannot produce,
 * which is the point of a proof.
 */
export function resolveEffectiveAiMode(platform: AiMode, tenant: AiMode): AiMode {
  return AI_MODE_RANK[tenant] < AI_MODE_RANK[platform] ? tenant : platform;
}

/**
 * What a caller sees: the organization's own preference, the platform policy it
 * is composed against, and the mode that actually applies.
 *
 * All three are returned together ON PURPOSE. A view that showed only the
 * preference would let the UI claim "approved cloud AI" while the platform
 * still routes everything locally — the silent no-op that makes a fix worse
 * than the dead end it replaces.
 */
export interface TenantAiPreferenceView {
  /** The organization's standing preference. Absent until it chooses one. */
  tenantMode: TenantAiMode | null;
  /** The install-wide policy, set only by a platform operator. */
  platformMode: AiMode;
  /**
   * The platform's separate external-processing consent.
   *
   * P13C ROUND 17, CORRECTED AFTER A FRESH-INSTALL RUN. Mode alone does not
   * decide whether external AI may be used: under `private_first`, external is
   * a fallback that requires THIS flag, and it defaults to false. The first
   * version of this view compared modes only, so a tenant choosing "approved
   * cloud AI" on a default install saw `restrictedByPlatform: false` while
   * external routing remained impossible — the silent no-op this view exists to
   * prevent, reproduced by the very code meant to prevent it.
   */
  platformExternalConsent: boolean;
  /** `min(platformMode, tenantMode)` — what requests will actually do. */
  effectiveMode: AiMode;
  /**
   * True when the organization asked for external AI and cannot have it —
   * because the platform's mode is stricter, its consent is off, or both.
   *
   * A tenant that chose `local_only` is never "restricted": it asked for the
   * narrower thing and got it. Restriction means an UNFULFILLED intent, which
   * is the only case the UI must speak up about.
   */
  restrictedByPlatform: boolean;
  updatedAt: number | null;
}

/** Whether a value is a preference an organization is allowed to hold. */
export function isTenantAiMode(value: unknown): value is TenantAiMode {
  return value === 'local_only' || value === 'private_first';
}

export const AI_MODE_DESCRIPTIONS: Record<AiMode, string> = {
  private_first:
    'Prefer processing on this device. Fall back to your private AI infrastructure if configured, and use an external provider only when you have enabled one.',
  local_only:
    'Only process on this device or your private infrastructure. If neither is available, the request fails here — it never falls back to an external provider.',
  external:
    'Send AI work to the external provider you have configured. Deterministic (non-AI) work still runs on this device.',
};

/* ── routes ────────────────────────────────────────────────────────────────── */

/** A route a request could take, with the live state that decides whether it may. */
export interface AiRouteCandidate {
  /** Client provider id, e.g. 'ollama' | 'anthropic'. */
  provider: string;
  location: Exclude<ProcessingLocation, 'none'>;
  /** The model that would serve the request on this route. */
  model: string;
  /** The endpoint, for display. Never carries credentials. */
  endpoint: string | null;
  /** The client reports it can make real calls (key present / URL set). */
  configured: boolean;
  /**
   * The user has enabled this route. Local routes are enabled by existing;
   * external routes require explicit consent.
   */
  enabled: boolean;
}

/**
 * Classify an Ollama endpoint. Loopback = this device; anything else is
 * infrastructure the user points at — theirs, but not this machine, so it is
 * `private_infrastructure`, never `local`. Unparseable input is treated as
 * remote: over-claiming "local" is the failure this function must never have.
 */
export function classifyEndpointLocation(url: string): 'local' | 'private_infrastructure' {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const local =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]';
    return local ? 'local' : 'private_infrastructure';
  } catch {
    return 'private_infrastructure';
  }
}

/* ── the routing decision ──────────────────────────────────────────────────── */

/** Why a candidate was passed over. Recorded so "Why?" can answer truthfully. */
export interface AiRouteSkip {
  provider: string;
  location: ProcessingLocation;
  reason: string;
}

export interface AiRoutePlan {
  ok: boolean;
  /** Candidates to attempt, in order. Empty when ok is false. */
  attempts: readonly AiRouteCandidate[];
  /** Routes that were considered and excluded, each with its reason. */
  skipped: readonly AiRouteSkip[];
  /** Set when ok is false: the full sentence the user is shown. */
  refusal: string | null;
  mode: AiMode;
}

const LOCATION_ORDER: Record<Exclude<ProcessingLocation, 'none'>, number> = {
  local: 0,
  private_infrastructure: 1,
  external: 2,
};

/**
 * Decide the routes a request may take, in order.
 *
 * The one non-negotiable in this function: under `private_first` and
 * `local_only`, an external candidate whose `enabled` is false is NEVER in the
 * attempt list. The refusal path exists precisely so that "no local model is
 * running" resolves to an error on this device rather than a quiet escalation
 * to a provider the user did not enable.
 */
export function planRoute(mode: AiMode, candidates: readonly AiRouteCandidate[]): AiRoutePlan {
  const skipped: AiRouteSkip[] = [];
  const eligible: AiRouteCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.configured) {
      skipped.push({
        provider: candidate.provider,
        location: candidate.location,
        reason: `${PROCESSING_LOCATION_LABELS[candidate.location]} route (${candidate.provider}) is not configured.`,
      });
      continue;
    }
    if (candidate.location === 'external') {
      if (mode === 'local_only') {
        skipped.push({
          provider: candidate.provider,
          location: candidate.location,
          reason: 'External providers are never used in Local Only mode.',
        });
        continue;
      }
      if (!candidate.enabled) {
        skipped.push({
          provider: candidate.provider,
          location: candidate.location,
          reason: 'External processing is not enabled. Enable it in Settings → AI if you want cloud fallback.',
        });
        continue;
      }
    } else if (!candidate.enabled) {
      skipped.push({
        provider: candidate.provider,
        location: candidate.location,
        reason: `${PROCESSING_LOCATION_LABELS[candidate.location]} route (${candidate.provider}) is disabled.`,
      });
      continue;
    }
    eligible.push(candidate);
  }

  const ordered =
    mode === 'external'
      ? // External mode: the user's explicit provider choice leads; locals may
        // still serve as fallback AFTER it, never silently before it.
        [...eligible].sort((a, b) => LOCATION_ORDER[b.location] - LOCATION_ORDER[a.location])
      : [...eligible].sort((a, b) => LOCATION_ORDER[a.location] - LOCATION_ORDER[b.location]);

  if (ordered.length > 0) {
    return { ok: true, attempts: ordered, skipped, refusal: null, mode };
  }

  const refusal =
    mode === 'local_only'
      ? 'This request needs an AI model, and no local or private model is available. Nothing was sent anywhere — in Local Only mode a request never leaves this device. Start your local model (for example: ollama serve), or change the AI mode in Settings → AI.'
      : mode === 'private_first'
        ? 'This request needs an AI model, and no local or private model is available. External processing is not enabled, so nothing was sent anywhere. Start your local model, or enable an external provider in Settings → AI.'
        : 'No AI provider is configured. Add a provider in Settings → AI.';
  return { ok: false, attempts: [], skipped, refusal, mode };
}

/* ── execution metadata ────────────────────────────────────────────────────── */

/**
 * Where a completed request ACTUALLY ran. Stamped by the executing client at
 * the moment of completion — this is the only source the UI badge may use.
 */
export interface AiRoutingMetadata {
  location: ProcessingLocation;
  provider: string;
  model: string;
  mode: AiMode;
  /** The truthful one-sentence answer to "Why?". */
  reason: string;
  /** Routes tried before this one succeeded (each with its failure). */
  attempted: readonly AiRouteSkip[];
  decidedAt: string;
}

/** Metadata for a result no model produced (deterministic answers, fallbacks). */
export function noModelRouting(mode: AiMode, reason: string, decidedAt: string): AiRoutingMetadata {
  return { location: 'none', provider: 'none', model: 'none', mode, reason, attempted: [], decidedAt };
}

/**
 * The "Why?" sentence for a completed route. Built only from what actually
 * happened: the location that served it, and the routes that failed first.
 */
export function explainRouting(meta: AiRoutingMetadata): string {
  const attempted =
    meta.attempted.length > 0
      ? ` ${meta.attempted.map((a) => `${PROCESSING_LOCATION_LABELS[a.location]} was tried first: ${a.reason}`).join(' ')}`
      : '';
  switch (meta.location) {
    case 'local':
      return `This ran locally on this device using ${meta.model}. Nothing was sent to any server for this response.${attempted}`;
    case 'private_infrastructure':
      return `This ran on your private AI infrastructure (${meta.provider}, ${meta.model}) — infrastructure you configured and control.${attempted}`;
    case 'external':
      return `This was processed by an external provider (${meta.provider}, ${meta.model}) that you enabled.${attempted}`;
    case 'none':
      return meta.reason;
    default:
      return meta.reason;
  }
}

/* ── measured usage ────────────────────────────────────────────────────────── */

/**
 * Counters of where AI work actually ran. Every field is a measurement —
 * the UI never renders a percentage that did not come from these counts.
 */
export interface AiRoutingUsage {
  total: number;
  byLocation: Record<ProcessingLocation, number>;
  firstAt: string | null;
  lastAt: string | null;
}

export function emptyRoutingUsage(): AiRoutingUsage {
  return {
    total: 0,
    byLocation: { local: 0, private_infrastructure: 0, external: 0, none: 0 },
    firstAt: null,
    lastAt: null,
  };
}

/** Percentage view over measured counts. Returns null until anything is measured. */
export function routingUsagePercentages(
  usage: AiRoutingUsage,
): Record<ProcessingLocation, number> | null {
  if (usage.total <= 0) return null;
  const out = {} as Record<ProcessingLocation, number>;
  for (const location of PROCESSING_LOCATIONS) {
    out[location] = Math.round((usage.byLocation[location] / usage.total) * 100);
  }
  return out;
}

/* ── settings view ─────────────────────────────────────────────────────────── */

/** One route as Settings → AI shows it: its live, real state. */
export interface AiRouteStatus {
  location: Exclude<ProcessingLocation, 'none'>;
  provider: string;
  label: string;
  /** 'connected' | 'not_configured' | 'disabled' | 'unreachable' */
  state: 'connected' | 'not_configured' | 'disabled' | 'unreachable';
  detail: string;
  model: string | null;
  endpoint: string | null;
}

export interface AiRoutingStatusView {
  mode: AiMode;
  externalConsent: boolean;
  routes: readonly AiRouteStatus[];
  /** What would happen right now, computed by the same planner requests use. */
  plan: AiRoutePlan;
}
