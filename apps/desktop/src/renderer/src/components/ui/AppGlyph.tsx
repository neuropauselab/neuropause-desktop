import { cn } from '@renderer/lib/cn';
import type { AppTone } from '@renderer/data/types';

const TONE_VAR: Record<AppTone, string> = {
  accent: '--accent',
  blue: '--c-blue',
  green: '--c-green',
  orange: '--c-orange',
  purple: '--c-purple',
  teal: '--c-teal',
  pink: '--c-pink',
};

/**
 * The square, tinted tile that stands in for an AI app. Brand logos are
 * intentionally not reproduced; a glyph + tone gives each app a stable,
 * recognizable identity across the store, launcher, tabs, and palette.
 */
export function AppGlyph({
  glyph,
  tone,
  size = 36,
  radius,
}: {
  glyph: string;
  tone: AppTone;
  size?: number;
  radius?: number;
}): JSX.Element {
  const v = TONE_VAR[tone];
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center font-semibold text-white')}
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.28),
        fontSize: Math.max(10, size * 0.34),
        letterSpacing: '-0.02em',
        background: `linear-gradient(150deg, rgb(var(${v})), rgb(var(${v}) / 0.82))`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.18)',
      }}
    >
      {glyph}
    </span>
  );
}
