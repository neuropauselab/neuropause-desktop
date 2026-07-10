/**
 * Unified loading DESCRIPTOR — the single, pure vocabulary for "what is loading and what shape should its
 * placeholder be." It does NOT introduce a loading framework or any React: it maps a semantic loading
 * `kind` (page, module, section, panel, dialog, table, card, list, background) to a deterministic spec
 * (skeleton layout + counts + an accessible label) that the renderer's `<Loading>` component turns into
 * the EXISTING Skeleton primitives. Centralizing the spec here means every surface shows a consistently
 * shaped, content-matched skeleton instead of ad-hoc spinners — and it stays pure + unit-testable.
 */

export type LoadingKind =
  | 'page'
  | 'module'
  | 'section'
  | 'panel'
  | 'dialog'
  | 'table'
  | 'card'
  | 'list'
  | 'background';

/** How the renderer composes the skeleton for a spec. */
export type LoadingVariant = 'stack' | 'grid' | 'table' | 'lines' | 'card' | 'inline';

export interface LoadingSpec {
  kind: LoadingKind;
  variant: LoadingVariant;
  /** Render a SkeletonHeader (icon chip + title bar) above the body. */
  header: boolean;
  /** Number of card placeholders for stack/grid variants. */
  cards: number;
  /** Number of line/table rows. */
  rows: number;
  /** Number of columns for the table variant. */
  columns: number;
  /** Accessible status label announced while loading. */
  label: string;
}

/** The canonical spec for each loading kind. Content-shaped, not a spinner. */
export const LOADING_PRESETS: Record<LoadingKind, LoadingSpec> = {
  page: { kind: 'page', variant: 'stack', header: true, cards: 6, rows: 3, columns: 4, label: 'Loading page…' },
  module: { kind: 'module', variant: 'stack', header: true, cards: 4, rows: 3, columns: 4, label: 'Loading…' },
  section: { kind: 'section', variant: 'lines', header: true, cards: 0, rows: 3, columns: 4, label: 'Loading section…' },
  panel: { kind: 'panel', variant: 'stack', header: false, cards: 4, rows: 3, columns: 4, label: 'Loading…' },
  dialog: { kind: 'dialog', variant: 'lines', header: false, cards: 0, rows: 3, columns: 4, label: 'Loading…' },
  table: { kind: 'table', variant: 'table', header: true, cards: 0, rows: 6, columns: 4, label: 'Loading table…' },
  card: { kind: 'card', variant: 'card', header: false, cards: 1, rows: 0, columns: 4, label: 'Loading…' },
  list: { kind: 'list', variant: 'lines', header: false, cards: 0, rows: 5, columns: 4, label: 'Loading list…' },
  background: { kind: 'background', variant: 'inline', header: false, cards: 0, rows: 1, columns: 4, label: 'Loading…' },
};

/** Fields a caller may override on top of a preset. */
export interface LoadingSpecOverrides {
  variant?: LoadingVariant;
  header?: boolean;
  cards?: number;
  rows?: number;
  columns?: number;
  label?: string;
}

function clampInt(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.round(value));
}

/**
 * Resolve the loading spec for a kind, applying any overrides. Counts are clamped to sane minimums and
 * a blank label falls back to the preset's. Pure + deterministic.
 */
export function loadingSpec(kind: LoadingKind, overrides: LoadingSpecOverrides = {}): LoadingSpec {
  const base = LOADING_PRESETS[kind] ?? LOADING_PRESETS.section;
  return {
    kind: base.kind,
    variant: overrides.variant ?? base.variant,
    header: overrides.header ?? base.header,
    cards: clampInt(overrides.cards ?? base.cards, 0),
    rows: clampInt(overrides.rows ?? base.rows, 0),
    columns: clampInt(overrides.columns ?? base.columns, 1),
    label: overrides.label && overrides.label.trim() ? overrides.label.trim() : base.label,
  };
}
