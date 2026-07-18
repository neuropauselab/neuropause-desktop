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
  | 'pin'
  | 'upload'
  | 'download'
  | 'shield'
  | 'star'
  | 'star-fill'
  | 'package'
  | 'refresh'
  | 'trash'
  | 'globe'
  | 'code'
  | 'cpu'
  | 'pause'
  | 'stop'
  | 'verified'
  | 'puzzle'
  | 'external'
  | 'image'
  | 'tag'
  | 'doc'
  | 'heart'
  | 'lock'
  | 'bolt'
  | 'layers'
  | 'camera'
  | 'mic'
  | 'gauge'
  | 'pulse'
  | 'filter'
  | 'list'
  | 'database'
  | 'server'
  | 'folder'
  | 'clipboard'
  | 'eye'
  | 'grip'
  | 'arrow-up'
  | 'beaker'
  | 'undo';

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
  upload: (
    <>
      <path d="M12 4.5v10" />
      <path d="M8 8.5 12 4.5l4 4" />
      <path d="M5 14.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-3.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v10" />
      <path d="M8 10.5 12 14.5l4-4" />
      <path d="M5 14.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-3.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5V6l7-2.5Z" />
    </>
  ),
  star: <path d="m12 4 2.3 4.9 5.2.7-3.8 3.6.9 5.3L12 16.9 7.4 18.4l.9-5.3L4.5 9.6l5.2-.7L12 4Z" />,
  'star-fill': (
    <path
      d="m12 4 2.3 4.9 5.2.7-3.8 3.6.9 5.3L12 16.9 7.4 18.4l.9-5.3L4.5 9.6l5.2-.7L12 4Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  package: (
    <>
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
      <path d="M4 8l8 4.5L20 8" />
      <path d="M12 12.5V20.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19 11a7 7 0 0 0-12.3-3.4M5 5v3.2h3.2" />
      <path d="M5 13a7 7 0 0 0 12.3 3.4M19 19v-3.2h-3.2" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7 7.2 19a1.5 1.5 0 0 0 1.5 1.4h6.6a1.5 1.5 0 0 0 1.5-1.4L18 7" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16" />
    </>
  ),
  code: (
    <>
      <path d="m9 8-4 4 4 4" />
      <path d="m15 8 4 4-4 4" />
    </>
  ),
  cpu: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3.5V6M14 3.5V6M10 18v2.5M14 18v2.5M3.5 10H6M3.5 14H6M18 10h2.5M18 14h2.5" />
    </>
  ),
  pause: (
    <>
      <path d="M9 6v12M15 6v12" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  verified: (
    <>
      <path d="m12 3.2 2 1.5 2.5-.3 1 2.3 2.3 1-.3 2.5 1.5 2-1.5 2 .3 2.5-2.3 1-1 2.3-2.5-.3-2 1.5-2-1.5-2.5.3-1-2.3-2.3-1 .3-2.5L3.2 12l1.5-2-.3-2.5 2.3-1 1-2.3 2.5.3 2-1.5Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  puzzle: (
    <>
      <path d="M10 4.5h4v2a1.5 1.5 0 0 0 3 0V6h2.5v3.5h-.5a1.5 1.5 0 0 0 0 3h.5V16H16v-.5a1.5 1.5 0 0 0-3 0v.5H9.5v-3.5H10a1.5 1.5 0 0 0 0-3h-.5V6H10V4.5Z" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-9A1.5 1.5 0 0 1 6 18.5v-9A1.5 1.5 0 0 1 7.5 8H12" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2.2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m5 17 4.5-4.5L13 16l2.5-2.5L19 17" />
    </>
  ),
  tag: (
    <>
      <path d="M4 11.5V5.5A1.5 1.5 0 0 1 5.5 4h6l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-5.4 5.4a1.5 1.5 0 0 1-2.1 0L4 11.5Z" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V8h4" />
    </>
  ),
  heart: <path d="M12 19.5C6 15.5 4 12.4 4 9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 8 2.5c0 2.9-2 6-8 10Z" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />,
  layers: (
    <>
      <path d="M12 4 20 8.5 12 13 4 8.5 12 4Z" />
      <path d="m4 12.5 8 4.5 8-4.5" />
    </>
  ),
  camera: (
    <>
      <path d="M5 8.5h2.5L9 6.5h6L16.5 8.5H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17v-7A1.5 1.5 0 0 1 5 8.5Z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 12a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18.5V21" />
    </>
  ),
  gauge: (
    <>
      <path d="M5 18a8 8 0 1 1 14 0" />
      <path d="M12 14.5 15.5 9" />
      <circle cx="12" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 4 13 2.5-7H21" />,
  filter: <path d="M4 6h16l-6 7v5l-4 2v-7L4 6Z" />,
  list: (
    <>
      <path d="M8 7h12M8 12h12M8 17h12" />
      <path d="M4 7h.01M4 12h.01M4 17h.01" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="4.5" width="16" height="6" rx="1.6" />
      <rect x="4" y="13.5" width="16" height="6" rx="1.6" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h3.6l2 2.4H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5Z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  beaker: (
    <>
      <path d="M9 3v5.5L4.5 17a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 8.5V3" />
      <path d="M8 3h8M7.5 13h9" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
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
