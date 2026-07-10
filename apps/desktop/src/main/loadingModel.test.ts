import { describe, expect, it } from 'vitest';
import { LOADING_PRESETS, loadingSpec, type LoadingKind } from '@neuropause/shared';

const KINDS: LoadingKind[] = [
  'page',
  'module',
  'section',
  'panel',
  'dialog',
  'table',
  'card',
  'list',
  'background',
];

describe('loadingModel — presets', () => {
  it('has a preset for every kind with a non-empty label and valid counts', () => {
    for (const kind of KINDS) {
      const preset = LOADING_PRESETS[kind];
      expect(preset).toBeDefined();
      expect(preset.kind).toBe(kind);
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.columns).toBeGreaterThanOrEqual(1);
      expect(preset.rows).toBeGreaterThanOrEqual(0);
      expect(preset.cards).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('loadingModel — loadingSpec', () => {
  it('returns the preset unchanged when no overrides are given', () => {
    expect(loadingSpec('table')).toEqual(LOADING_PRESETS.table);
    expect(loadingSpec('panel')).toEqual(LOADING_PRESETS.panel);
  });

  it('applies overrides on top of the preset', () => {
    const spec = loadingSpec('table', { rows: 10, columns: 6, label: 'Loading orders…' });
    expect(spec.rows).toBe(10);
    expect(spec.columns).toBe(6);
    expect(spec.label).toBe('Loading orders…');
    expect(spec.variant).toBe('table');
  });

  it('clamps counts to safe minimums and rounds', () => {
    const spec = loadingSpec('table', { rows: -3, columns: 0, cards: 2.6 });
    expect(spec.rows).toBe(0);
    expect(spec.columns).toBe(1);
    expect(spec.cards).toBe(3);
  });

  it('falls back to the preset label for a blank override and trims a real one', () => {
    expect(loadingSpec('panel', { label: '   ' }).label).toBe(LOADING_PRESETS.panel.label);
    expect(loadingSpec('section', { label: '  Loading X  ' }).label).toBe('Loading X');
  });

  it('allows overriding the variant + header', () => {
    const spec = loadingSpec('section', { variant: 'grid', header: false, cards: 4 });
    expect(spec.variant).toBe('grid');
    expect(spec.header).toBe(false);
    expect(spec.cards).toBe(4);
  });

  it('is deterministic', () => {
    expect(loadingSpec('page', { cards: 8 })).toEqual(loadingSpec('page', { cards: 8 }));
  });
});
