/**
 * Main-scope execution of the NPDS pure-logic tests.
 *
 * The renderer's design tokens/theme/contracts are pure data (no framer-motion,
 * no DOM), so they can be imported and asserted here where the vitest runner is
 * scoped (src/main/**). This guarantees the token layer + component contracts are
 * actually EXECUTED in CI — not merely typechecked. (motion.ts imports
 * framer-motion and is covered by the renderer-scoped test + typecheck.)
 */
import { describe, expect, it } from 'vitest';
import {
  durations,
  fontSize,
  layers,
  radius,
  spacing,
  springs,
  statusColors,
  typographyRoles,
} from '../../renderer/src/design/tokens';
import { themes, themeColorRoles } from '../../renderer/src/design/theme';
import { componentContracts, missingPrimitives } from '../../renderer/src/design/contracts';

describe('NPDS tokens (executed in main scope)', () => {
  it('spacing follows the 8→64 rhythm', () => {
    expect(Object.values(spacing)).toEqual([8, 12, 16, 20, 24, 32, 48, 64]);
  });

  it('radius mirrors the tailwind config', () => {
    expect([radius.lg, radius.xl, radius['2xl'], radius['3xl']]).toEqual([10, 14, 18, 24]);
  });

  it('every typography role maps to a real font-size step', () => {
    const steps = new Set(Object.keys(fontSize));
    for (const role of Object.values(typographyRoles)) {
      expect(steps.has(role.step)).toBe(true);
    }
  });

  it('durations are sane and layers strictly ordered', () => {
    for (const ms of Object.values(durations)) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(1000);
    }
    const order = Object.values(layers);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('springs are valid and status colors map to system tokens', () => {
    for (const s of Object.values(springs)) {
      expect(s.type).toBe('spring');
    }
    expect(statusColors.success).toBe('sysgreen');
  });
});

describe('NPDS theme + contracts (executed in main scope)', () => {
  it('declares all four themes and maps semantic roles', () => {
    expect(themes).toEqual(['light', 'dark', 'high-contrast', 'system']);
    expect(themeColorRoles.textPrimary).toBe('ink');
  });

  it('Button contract matches the real component variants', () => {
    const button = componentContracts.find((c) => c.name === 'Button');
    expect(button?.variants?.variant).toEqual(['primary', 'secondary', 'ghost', 'danger']);
  });

  it('lists not-yet-extracted primitives honestly', () => {
    expect(missingPrimitives).toContain('Input');
  });
});
