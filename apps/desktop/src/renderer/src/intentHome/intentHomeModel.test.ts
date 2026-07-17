/**
 * Intent Experience Program v2.0 — Intent Home presentation-mapping tests. Pure tone/label/icon derivations
 * over REAL enum values; no DOM, no React. Locks that on-track is never false-red and every role/category
 * resolves to a real icon.
 */
import { describe, expect, it } from 'vitest';
import type { GoalCategory, IntentRole, StrategyStatus } from '@neuropause/shared';
import { bandLabel, bandTone, categoryIcon, categoryLabel, pctText, roleIcon, statusLabel, statusTone } from './intentHomeModel';

describe('band + status tones never false-colour', () => {
  it('maps bands to tones', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('critical')).toBe('Critical');
  });

  it('an on-track outcome is green, off-track is red', () => {
    expect(statusTone('on_track')).toBe('green'); // never false-red
    expect(statusTone('at_risk')).toBe('orange');
    expect(statusTone('off_track')).toBe('red');
    expect(statusLabel('on_track')).toBe('On track');
    expect(statusLabel('off_track')).toBe('Off track');
  });
});

describe('role + category icons resolve for every real enum value', () => {
  it('every one of the 10 roles has a real icon', () => {
    const roles: IntentRole[] = ['founder', 'ceo', 'cto', 'cfo', 'coo', 'sales', 'marketing', 'hr', 'legal', 'operations'];
    for (const r of roles) expect(roleIcon(r).length).toBeGreaterThan(0);
  });

  it('every real goal category has an icon + a capitalised label', () => {
    const cats: GoalCategory[] = ['financial', 'operational', 'security', 'growth', 'compliance', 'workforce', 'infrastructure'];
    for (const c of cats) expect(categoryIcon(c).length).toBeGreaterThan(0);
    expect(categoryLabel('financial')).toBe('Financial');
    expect(categoryLabel('infrastructure')).toBe('Infrastructure');
  });
});

describe('pctText', () => {
  it('renders a 0..1 fraction as a whole-number percent', () => {
    expect(pctText(0.823)).toBe('82%');
    expect(pctText(0)).toBe('0%');
    expect(pctText(1)).toBe('100%');
  });
});

// exhaustiveness guard: if StrategyStatus grows, this line fails to compile until the mappers handle it.
const _exhaustive: Record<StrategyStatus, string> = { on_track: statusLabel('on_track'), at_risk: statusLabel('at_risk'), off_track: statusLabel('off_track') };
void _exhaustive;
