/**
 * Pure chart geometry (Mobile M1-09) — the math behind the phone's hand-rolled
 * SVG charts, kept separate from the React Native components so it unit-tests in
 * plain Node (via the mobile vitest). No RN, no drawing — just layout + paths.
 */

export interface BarDatum {
  label: string;
  value: number;
}

export interface BarLayout extends BarDatum {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lay out vertical bars within a box; heights are proportional to `max`. */
export function barLayout(
  data: BarDatum[],
  opts: { width: number; height: number; gap?: number; max?: number },
): BarLayout[] {
  const n = data.length;
  if (n === 0) return [];
  const gap = opts.gap ?? 8;
  const max = opts.max ?? Math.max(1, ...data.map((d) => d.value));
  const barW = (opts.width - gap * (n - 1)) / n;
  return data.map((d, i) => {
    const h = max <= 0 ? 0 : Math.max(0, (d.value / max) * opts.height);
    return { ...d, x: i * (barW + gap), y: opts.height - h, width: barW, height: h };
  });
}

export interface DonutSlice {
  name: string;
  value: number;
}

export interface DonutArc extends DonutSlice {
  fraction: number;
  path: string;
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function annularSector(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0o, y0o] = polar(cx, cy, rOuter, a0);
  const [x1o, y1o] = polar(cx, cy, rOuter, a1);
  const [x1i, y1i] = polar(cx, cy, rInner, a1);
  const [x0i, y0i] = polar(cx, cy, rInner, a0);
  return [
    `M ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
    `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/** Build annular arc paths for a donut, starting at 12 o'clock, clockwise. */
export function donutArcs(
  slices: DonutSlice[],
  opts: { radius: number; thickness: number; cx?: number; cy?: number },
): DonutArc[] {
  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return [];
  const cx = opts.cx ?? opts.radius;
  const cy = opts.cy ?? opts.radius;
  const rInner = Math.max(0, opts.radius - opts.thickness);
  let angle = -Math.PI / 2;
  return positive.map((s) => {
    const fraction = s.value / total;
    const a0 = angle;
    const a1 = angle + fraction * Math.PI * 2;
    angle = a1;
    return { ...s, fraction, path: annularSector(cx, cy, rInner, opts.radius, a0, a1) };
  });
}
