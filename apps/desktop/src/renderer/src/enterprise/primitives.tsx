import { cn } from '@renderer/lib/cn';
import { DOT_BG, TEXT_TONE, type OpsTone } from './lib';

/** A circular gauge for a 0..1 score, with a centered value + label. */
export function ScoreRing({
  value,
  label,
  tone,
  size = 132,
}: {
  value: number;
  label: string;
  tone: OpsTone;
  size?: number;
}): JSX.Element {
  const v = Math.max(0, Math.min(1, value));
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * v;
  const strokeColor: Record<OpsTone, string> = {
    green: 'var(--sysgreen)',
    orange: 'var(--sysorange)',
    red: 'var(--syspink)',
    blue: 'var(--sysblue)',
    purple: 'var(--syspurple)',
    accent: 'var(--accent)',
    gray: 'var(--fill-3)',
  };
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          className="transition-[background-color,color,border-color,box-shadow,transform,opacity] motion-reduce:transition-none duration-500"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-3xl font-semibold tracking-tight tabular', TEXT_TONE[tone])}>
          {Math.round(v * 100)}
        </span>
        <span className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</span>
      </div>
    </div>
  );
}

/** A compact bar sparkline for trend rows. Values are normalized to the max. */
export function MiniBars({ values, tone = 'accent', height = 28 }: { values: number[]; tone?: OpsTone; height?: number }): JSX.Element {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn('w-1.5 rounded-sm', DOT_BG[tone])}
          style={{ height: `${Math.max(6, (v / max) * 100)}%`, opacity: 0.45 + 0.55 * (v / max) }}
        />
      ))}
    </div>
  );
}
