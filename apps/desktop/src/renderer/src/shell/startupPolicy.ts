/**
 * Constitutional Settings v1.0 — Startup Experience Policy (pure, testable; no React, no I/O).
 *
 * Resolves which section NeuroPause opens to at launch. It is a real preference backed by the existing
 * renderer pref store and validated against the real section registry (`SECTIONS`) — it never invents a
 * destination. The fallback chain guarantees the app NEVER shows an error because a configured startup
 * section was hidden, removed, or the user lost access to it: an ineligible destination automatically
 * redirects down a safe chain (Mission Control → Intent Home → Organization → Workspace → Settings).
 *
 * v1.1 (Phase 6 Stage 2): Mission Control becomes the primary landing page — it heads the fallback
 * chain, is the smart-mode destination when there is no unfinished work, and is the ultimate backstop.
 * Explicit user choices are untouched: `resume` still reopens the last section and `section` mode still
 * opens the user's configured pick.
 */
import { SECTIONS, type SectionId } from './sections';

export type StartupMode = 'resume' | 'section' | 'smart';

export const STARTUP_MODES: StartupMode[] = ['resume', 'section', 'smart'];

/** The safe redirect chain, most-preferred first. Every entry is a real, always-present visible section. */
export const STARTUP_FALLBACK_CHAIN: SectionId[] = ['mission-control', 'intent-home', 'organization', 'workspace', 'settings'];

/**
 * A section is a valid startup destination only if it really exists in the registry AND is visible in nav.
 * (A hidden/retired section is never a startup target — the fallback chain redirects instead.)
 */
export function isStartupEligible(id: string | null | undefined): id is SectionId {
  return typeof id === 'string' && SECTIONS.some((s) => s.id === id && !s.hidden);
}

/** The list of sections a user may pick as a fixed startup destination (real + visible only). */
export function startupSectionChoices(): SectionId[] {
  return SECTIONS.filter((s) => !s.hidden && s.placement === 'primary').map((s) => s.id);
}

export interface StartupContext {
  mode: StartupMode;
  /** Chosen fixed section for `section` mode. */
  configuredSection: string | null;
  /** Last-visited section (persisted) for `resume` mode. */
  lastSection: string | null;
  /** Whether there is unfinished work to resume (persisted workspace tabs) — drives `smart` mode. */
  hasUnfinishedWork: boolean;
  /**
   * Optional permission predicate. When provided, an otherwise-eligible destination the user cannot access
   * is treated as ineligible and the fallback chain applies. Defaults to "all visible sections allowed"
   * (the single-user/owner case), since section access is otherwise enforced at each section's data layer.
   */
  canAccess?: (id: SectionId) => boolean;
}

/**
 * Resolve the startup destination with automatic, never-erroring fallback. Returns the first eligible of:
 * the mode's preferred section, then the safe chain, then Mission Control as the ultimate backstop.
 */
export function resolveStartupSection(ctx: StartupContext): SectionId {
  const allowed = (id: SectionId): boolean => isStartupEligible(id) && (ctx.canAccess ? ctx.canAccess(id) : true);

  const preferred: string | null =
    ctx.mode === 'resume'
      ? ctx.lastSection
      : ctx.mode === 'section'
        ? ctx.configuredSection
        : ctx.hasUnfinishedWork
          ? 'workspace'
          : 'mission-control';

  if (isStartupEligible(preferred) && allowed(preferred)) return preferred;
  for (const f of STARTUP_FALLBACK_CHAIN) if (allowed(f)) return f;
  return 'mission-control';
}
