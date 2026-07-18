import type { SVGProps } from 'react';

/**
 * A single, cohesive icon set drawn in the SF-Symbols idiom: 24x24 grid,
 * 1.6 stroke, rounded caps and joins, currentColor. Keeping the set hand-built
 * (rather than pulling an icon library) lets every glyph share one visual
 * language tuned for the macOS shell, with zero extra dependencies.
 */
export type IconName =
  | 'home'
  | 'store'
  | 'workspace'
  | 'connectors'
  | 'memory'
  | 'automations'
  | 'bell'
  | 'analytics'
  | 'settings'
  | 'search'
  | 'command'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'sidebar'
  | 'close'
  | 'plus'
  | 'check'
  | 'sparkles'
  | 'launch'
  | 'clock'
  | 'play'
  | 'checklist'
  | 'activity'
  | 'lightbulb'
  | 'logout'
  | 'user'
  | 'info'
  | 'dot'
  | 'arrow-right'
  | 'grid'
  | 'pin';

const PATHS: Record<IconName, JSX.Element> = {
  home: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6 10.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  store: (
    <>
      <path d="M5 8h14l-1 11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  workspace: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <path d="M3.5 9h17" />
      <path d="M9 9v10.5" />
    </>
  ),
  connectors: (
    <>
      <path d="M9.5 14.5 7 17a3.2 3.2 0 0 1-4.5-4.5l2.5-2.5" />
      <path d="M14.5 9.5 17 7a3.2 3.2 0 0 1 4.5 4.5L19 14" />
      <path d="M9.5 14.5 14.5 9.5" />
    </>
  ),
  memory: (
    <>
      <path d="M12 4.5a3.5 3.5 0 0 0-3.4 4.3A3.3 3.3 0 0 0 7 14a3.2 3.2 0 0 0 3 3.2V19" />
      <path d="M12 4.5a3.5 3.5 0 0 1 3.4 4.3A3.3 3.3 0 0 1 17 14a3.2 3.2 0 0 1-3 3.2V19" />
      <path d="M12 8.5v6" />
    </>
  ),
  automations: (
    <>
      <circle cx="6" cy="6.5" r="2" />
      <circle cx="18" cy="6.5" r="2" />
      <circle cx="12" cy="17.5" r="2" />
      <path d="M6 8.5v3a2 2 0 0 0 2 2h2.2M18 8.5v3a2 2 0 0 1-2 2h-2.2" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5l1.5-2Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20h16" />
      <rect x="5.5" y="12" width="3.2" height="6" rx="0.8" />
      <rect x="10.4" y="8" width="3.2" height="10" rx="0.8" />
      <rect x="15.3" y="5" width="3.2" height="13" rx="0.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.7-3.7" />
    </>
  ),
  command: <path d="M9 7.5A2.5 2.5 0 1 0 6.5 10H17.5A2.5 2.5 0 1 0 15 7.5v9A2.5 2.5 0 1 0 17.5 14H6.5A2.5 2.5 0 1 0 9 16.5v-9Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.4 5.6 16.6 7.4M7.4 16.6 5.6 18.4M18.4 18.4 16.6 16.6M7.4 7.4 5.6 5.6" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  auto: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
    </>
  ),
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  'chevron-left': <path d="m14.5 6-6 6 6 6" />,
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  close: <path d="M6 6 18 18M18 6 6 18" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  sparkles: (
    <>
      <path d="M12 4.5 13.4 9 18 10.4 13.4 11.8 12 16.3 10.6 11.8 6 10.4 10.6 9 12 4.5Z" />
      <path d="M18.5 4.5 19 6.5 21 7l-2 .5-.5 2-.5-2L16 7l2-.5.5-2Z" />
    </>
  ),
  launch: (
    <>
      <path d="M8 16 16 8" />
      <path d="M9 8h7v7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  play: <path d="M8 6.5 18 12 8 17.5V6.5Z" />,
  checklist: (
    <>
      <path d="m4 7 1.5 1.5L8.5 5.5" />
      <path d="m4 16 1.5 1.5L8.5 14.5" />
      <path d="M11.5 8h8.5M11.5 16h8.5" />
    </>
  ),
  activity: <path d="M3 12h3.5l2-6 4 13 2.5-7H21" />,
  lightbulb: (
    <>
      <path d="M9 16.5a5 5 0 1 1 6 0c-.6.5-1 1-1 2v.5h-4V18.5c0-1-.4-1.5-1-2Z" />
      <path d="M10 21.5h4" />
    </>
  ),
  logout: (
    <>
      <path d="M14 7V5.5a1.5 1.5 0 0 0-1.5-1.5H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V17" />
      <path d="M10 12h10m0 0-3-3m3 3-3 3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />,
  'arrow-right': <path d="M5 12h14m0 0-5-5m5 5-5 5" />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>
  ),
  pin: (
    <>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" />
      <path d="M12 14v6" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, strokeWidth = 1.6, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
