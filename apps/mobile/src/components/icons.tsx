/**
 * Tab-bar icons (Mobile M1-09) — hand-drawn with react-native-svg so the app
 * needs no icon-font dependency (@expo/vector-icons is intentionally not in the
 * manifest). Stroked, so they inherit the active/inactive tint from the tabs.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export function HomeIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 10.5 12 3l9 7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 9.5V20h14V9.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function GridIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={7} height={7} rx={1.5} stroke={color} strokeWidth={2} />
      <Rect x={14} y={3} width={7} height={7} rx={1.5} stroke={color} strokeWidth={2} />
      <Rect x={3} y={14} width={7} height={7} rx={1.5} stroke={color} strokeWidth={2} />
      <Rect x={14} y={14} width={7} height={7} rx={1.5} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function ChecklistIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 4h6v3H9z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path
        d="M7 5H5v15h14V5h-2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8.5 13l2 2 4-4.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TimelineIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path
        d="M12 7v5l3 2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SearchIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={2} />
      <Path d="M20 20l-3.6-3.6" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function BellIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.7 21a2 2 0 01-3.4 0"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function LayersIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2 2 7l10 5 10-5-10-5Z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path
        d="M2 12l10 5 10-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2 17l10 5 10-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SettingsIcon({ color, size = 24 }: { color: string; size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h9 M19 7h1 M4 12h1 M11 12h9 M4 17h6 M16 17h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={16} cy={7} r={2.4} stroke={color} strokeWidth={2} />
      <Circle cx={8} cy={12} r={2.4} stroke={color} strokeWidth={2} />
      <Circle cx={13} cy={17} r={2.4} stroke={color} strokeWidth={2} />
    </Svg>
  );
}
