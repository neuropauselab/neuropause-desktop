/**
 * UI Foundation state model (Wave 1, Module 10). The view-state contract the NEMS
 * UI binds to — replacing hardcoded demo state with real loading / error / empty /
 * permission / session-expiration states — plus theme resolution (persisted in user
 * preferences). Framework-agnostic; the one UI framework renders these states.
 */
export type ViewState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'denied' }
  | { kind: 'session-expired' }
  | { kind: 'ready'; data: T };

export interface ResolveInput<T> {
  loading?: boolean;
  sessionValid?: boolean;
  permitted?: boolean;
  error?: string;
  data?: T | null;
}

/** Resolve the correct UI state in priority order — session/permission gates first. */
export function resolveViewState<T>(input: ResolveInput<T>): ViewState<T> {
  if (input.loading) return { kind: 'loading' };
  if (input.sessionValid === false) return { kind: 'session-expired' };
  if (input.permitted === false) return { kind: 'denied' };
  if (input.error) return { kind: 'error', message: input.error };
  const d = input.data;
  if (d == null || (Array.isArray(d) && d.length === 0)) return { kind: 'empty' };
  return { kind: 'ready', data: d };
}

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/** Theme is persisted in user preferences; falls back to 'light'. */
export function themeFromPreferences(prefs: Record<string, unknown>): Theme {
  const t = String(prefs.theme ?? '');
  return (THEMES as readonly string[]).includes(t) ? (t as Theme) : 'light';
}
