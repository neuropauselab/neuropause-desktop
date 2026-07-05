import { describe, expect, it } from 'vitest';
import {
  durations,
  easing,
  elevation,
  fontSize,
  layers,
  radius,
  spacing,
  springs,
  statusColors,
  typographyRoles,
} from './tokens';
import { transitions, panelMotion, dialogMotion, reducedMotion } from './motion';
import { themes, themeColorRoles } from './theme';
import { componentContracts, missingPrimitives } from './contracts';

describe('design tokens', () => {
  it('spacing follows the intended 8→64 rhythm', () => {
    expect(Object.values(spacing)).toEqual([8, 12, 16, 20, 24, 32, 48, 64]);
  });

  it('radius values match the tailwind config (10/14/18/24)', () => {
    expect(spacing).toBeDefined();
    expect(radius.lg).toBe(10);
    expect(radius.xl).toBe(14);
    expect(radius['2xl']).toBe(18);
    expect(radius['3xl']).toBe(24);
  });

  it('every typography role maps to a real font-size step', () => {
    const steps = new Set(Object.keys(fontSize));
    for (const role of Object.values(typographyRoles)) {
      expect(steps.has(role.step)).toBe(true);
    }
  });

  it('durations are sane positive numbers', () => {
    for (const ms of Object.values(durations)) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(1000);
    }
  });

  it('easing curves are 4-point cubic-beziers', () => {
    expect(easing.emphasized).toHaveLength(4);
    expect(easing.standard).toHaveLength(4);
  });

  it('spring presets are valid framer-motion spring configs', () => {
    for (const s of Object.values(springs)) {
      expect(s.type).toBe('spring');
      expect(s.stiffness).toBeGreaterThan(0);
      expect(s.damping).toBeGreaterThan(0);
    }
  });

  it('elevation tokens reference shadow utility classes', () => {
    for (const c of Object.values(elevation)) {
      expect(c.startsWith('shadow-')).toBe(true);
    }
  });

  it('spatial layers are strictly ordered background→command palette', () => {
    const order = Object.values(layers);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
    expect(layers.background).toBe(0);
    expect(layers.commandPalette).toBe(7);
  });

  it('status colors map to Apple system color tokens', () => {
    expect(statusColors.success).toBe('sysgreen');
    expect(statusColors.danger).toBe('syspink');
  });
});

describe('motion presets', () => {
  it('transitions derive their durations from tokens (ms→s)', () => {
    expect((transitions.fast as { duration: number }).duration).toBeCloseTo(durations.fast / 1000);
    expect((transitions.normal as { duration: number }).duration).toBeCloseTo(
      durations.normal / 1000,
    );
  });

  it('panel and dialog variants expose initial/animate/exit', () => {
    for (const v of [panelMotion, dialogMotion, reducedMotion]) {
      expect(v).toHaveProperty('initial');
      expect(v).toHaveProperty('animate');
      expect(v).toHaveProperty('exit');
    }
  });

  it('reduced-motion variant animates opacity only (no transforms)', () => {
    expect(reducedMotion.initial).toEqual({ opacity: 0 });
  });
});

describe('theme architecture', () => {
  it('declares light/dark/high-contrast/system', () => {
    expect(themes).toEqual(['light', 'dark', 'high-contrast', 'system']);
  });

  it('semantic color roles resolve to token names', () => {
    expect(themeColorRoles.textPrimary).toBe('ink');
    expect(themeColorRoles.accent).toBe('accent');
  });
});

describe('component contracts match reality', () => {
  it('documents Button with its real variants', () => {
    const button = componentContracts.find((c) => c.name === 'Button');
    expect(button?.variants?.variant).toEqual(['primary', 'secondary', 'ghost', 'danger']);
    expect(button?.variants?.size).toEqual(['sm', 'md']);
  });

  it('documents Card modifiers that exist today', () => {
    const card = componentContracts.find((c) => c.name === 'Card');
    expect(card?.modifiers).toContain('interactive');
    expect(card?.modifiers).toContain('flush');
  });

  it('lists not-yet-extracted primitives honestly', () => {
    expect(missingPrimitives).toContain('Input');
    expect(missingPrimitives).toContain('Badge');
  });
});
