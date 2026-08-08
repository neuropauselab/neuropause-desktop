/**
 * Mobile M1-09 — pure tests for the hand-rolled SVG chart geometry. No RN, no
 * drawing: just the layout math the phone's <TrendBars> and <Donut> rely on.
 * Runs via the mobile vitest (npx vitest run --root apps/mobile).
 */
import { describe, expect, it } from 'vitest';
import { barLayout, donutArcs } from './geometry';

describe('barLayout', () => {
  it('returns [] for no data', () => {
    expect(barLayout([], { width: 100, height: 50 })).toEqual([]);
  });

  it('lays bars left-to-right with heights proportional to the tallest', () => {
    const bars = barLayout(
      [
        { label: 'a', value: 10 },
        { label: 'b', value: 5 },
      ],
      { width: 100, height: 50, gap: 10 },
    );
    expect(bars).toHaveLength(2);
    // barW = (100 - 10*(2-1)) / 2 = 45
    expect(bars[0].width).toBeCloseTo(45);
    expect(bars[1].width).toBeCloseTo(45);
    expect(bars[0].x).toBeCloseTo(0);
    expect(bars[1].x).toBeCloseTo(55);
    // tallest fills the box; y = height - h
    expect(bars[0].height).toBeCloseTo(50);
    expect(bars[0].y).toBeCloseTo(0);
    expect(bars[1].height).toBeCloseTo(25);
    expect(bars[1].y).toBeCloseTo(25);
  });

  it('scales to an explicit max', () => {
    const [bar] = barLayout([{ label: 'a', value: 5 }], { width: 20, height: 100, max: 10 });
    expect(bar.height).toBeCloseTo(50);
    expect(bar.y).toBeCloseTo(50);
  });

  it('clamps every bar to zero height when all values are zero', () => {
    const bars = barLayout(
      [
        { label: 'a', value: 0 },
        { label: 'b', value: 0 },
      ],
      { width: 100, height: 40 },
    );
    expect(bars.every((b) => b.height === 0 && b.y === 40)).toBe(true);
  });
});

describe('donutArcs', () => {
  it('returns [] when nothing is positive', () => {
    expect(donutArcs([], { radius: 50, thickness: 10 })).toEqual([]);
    expect(donutArcs([{ name: 'x', value: 0 }], { radius: 50, thickness: 10 })).toEqual([]);
  });

  it('drops non-positive slices and normalises fractions to 1', () => {
    const arcs = donutArcs(
      [
        { name: 'a', value: 3 },
        { name: 'b', value: 1 },
        { name: 'c', value: 0 },
        { name: 'd', value: -2 },
      ],
      { radius: 50, thickness: 12 },
    );
    expect(arcs.map((a) => a.name)).toEqual(['a', 'b']);
    expect(arcs[0].fraction).toBeCloseTo(0.75);
    expect(arcs[1].fraction).toBeCloseTo(0.25);
    expect(arcs.reduce((s, a) => s + a.fraction, 0)).toBeCloseTo(1);
  });

  it("starts the first arc at 12 o'clock", () => {
    const [arc] = donutArcs([{ name: 'only', value: 1 }], { radius: 50, thickness: 10 });
    // cx = cy = radius = 50; the 12 o'clock point on the outer ring is (50, 0)
    expect(arc.path.startsWith('M 50.00 0.00')).toBe(true);
    expect(arc.fraction).toBeCloseTo(1);
  });

  it('produces one closed path per positive slice', () => {
    const arcs = donutArcs(
      [
        { name: 'a', value: 1 },
        { name: 'b', value: 1 },
        { name: 'c', value: 2 },
      ],
      { radius: 40, thickness: 8 },
    );
    expect(arcs).toHaveLength(3);
    arcs.forEach((a) => expect(a.path).toMatch(/^M .* Z$/));
  });
});
