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
    modifiers: ['icon', 'disabled'],
    notes:
      "Defaults: variant='secondary', size='md'. Uses semantic classes (bg-accent, shadow-focus).",
  },
  {
    name: 'Card',
    file: 'components/ui/Card.tsx',
    modifiers: ['interactive', 'flush'],
    notes:
      'surface-raised + rounded-2xl + shadow-card; interactive adds hover lift; flush removes padding.',
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
