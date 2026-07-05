/**
 * NeuroPause Component Contracts (NPDS A.1, STEP 3).
 *
 * A typed catalog of the primitives that ALREADY EXIST in components/ui and the
 * variants they support TODAY. This is documentation-as-code: it standardizes how
 * we describe components without redesigning them. Contracts are asserted against
 * reality in tests (e.g. Button really accepts these variants). Where a primitive
 * does not yet exist, it is listed under `missingPrimitives` honestly rather than
 * fabricated.
 */

/** A documented component contract entry. */
export interface ComponentContract {
  name: string;
  file: string;
  /** Supported variant/prop values as they exist today. */
  variants?: Record<string, readonly string[]>;
  /** Boolean modifier props. */
  modifiers?: readonly string[];
  notes?: string;
}

/** Primitives that exist and their real, current contracts. */
export const componentContracts: ComponentContract[] = [
  {
    name: 'Button',
    file: 'components/ui/Button.tsx',
    variants: {
      variant: ['primary', 'secondary', 'ghost', 'danger'],
      size: ['sm', 'md'],
    },
    modifiers: ['icon', 'loading', 'disabled'],
    notes:
      "Defaults: variant='secondary', size='md'. loading shows the shared Spinner, sets aria-busy, and disables. Semantic classes (bg-accent, shadow-focus).",
  },
  {
    name: 'Card',
    file: 'components/ui/Card.tsx',
    variants: {
      variant: ['raised', 'flat', 'hairline', 'glass', 'floating', 'dashboard'],
      surface: ['base', 'raised', 'glass'],
      elevation: ['card', 'pop', 'glass'],
    },
    modifiers: ['interactive', 'flush'],
    notes:
      'A.3: `variant` is a complete surface preset reproducing real styles verbatim (raised=default historical Card, flat=Executive cards, hairline=Decision/Org panels, glass/floating=overlays, dashboard=dense KPI). Legacy surface/elevation retained for backward-compat. Defaults render byte-identically.',
  },
  {
    name: 'EmptyState',
    file: 'components/ui/EmptyState.tsx',
    modifiers: ['compact'],
    notes: 'Icon + title + description; compact reduces padding and sizes.',
  },
  {
    name: 'Skeleton',
    file: 'components/ui/Skeleton.tsx',
    notes: 'Loading placeholder; accepts style (width/height via CSSProperties).',
  },
  {
    name: 'Menu',
    file: 'components/ui/Menu.tsx',
    variants: { align: ['start', 'end'] },
    notes: 'Context/dropdown menu with alignment.',
  },
  {
    name: 'Icon',
    file: 'components/ui/Icon.tsx',
    notes: 'Named icon set (IconName union); size prop in px.',
  },
  {
    name: 'Page',
    file: 'components/ui/Page.tsx',
    notes: 'Page scaffold wrapper.',
  },
  {
    name: 'VirtualList',
    file: 'components/ui/VirtualList.tsx',
    notes: 'Virtualized list for long collections (perf primitive).',
  },
  {
    name: 'BarChart',
    file: 'components/ui/BarChart.tsx',
    notes: 'Lightweight bar chart primitive.',
  },
];

/**
 * Primitives referenced by the design program that do NOT yet exist as shared
 * components (styling is currently inline where needed). Listed so the migration
 * guide can prioritize extracting them — NOT fabricated here.
 */
export const missingPrimitives = [
  'Input',
  'Badge',
  'Chip',
  'Toolbar',
  'Modal',
  'Notification (as a shared primitive)',
] as const;
