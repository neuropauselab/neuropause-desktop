/**
 * IP-01 — pure tests for the Solution Pack registry lifecycle.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { SolutionPackRegistry, compareSemver } from './registry';
import type { SolutionPackManifest } from './types';

const mod = (id: string, group = 'Healthcare'): EnterpriseModuleDescriptor =>
  ({ id, group }) as unknown as EnterpriseModuleDescriptor;

const pack = (over: Partial<SolutionPackManifest> = {}): SolutionPackManifest => ({
  id: 'healthcare',
  name: 'Healthcare',
  industry: 'Healthcare',
  version: '1.0.0',
  description: 'Clinical',
  coreModulesUsed: ['invoice'],
  ...over,
});

describe('compareSemver', () => {
  it('orders MAJOR.MINOR.PATCH', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('SolutionPackRegistry', () => {
  it('installs, enables, and disables a pack', () => {
    const r = new SolutionPackRegistry();
    r.install(pack());
    expect(r.get('healthcare')?.state).toBe('installed');
    r.enable('healthcare');
    expect(r.enabled().map((p) => p.manifest.id)).toEqual(['healthcare']);
    r.disable('healthcare');
    expect(r.get('healthcare')?.state).toBe('disabled');
  });

  it('rejects a duplicate install and an invalid pack', () => {
    const r = new SolutionPackRegistry({ coreModuleIds: ['invoice'] });
    r.install(pack());
    expect(() => r.install(pack())).toThrow(/already installed/);
    expect(() => r.install(pack({ id: 'edu', modules: [mod('invoice')] }))).toThrow(/invalid/);
  });

  it('enforces dependencies across install / enable / disable', () => {
    const r = new SolutionPackRegistry();
    expect(() => r.install(pack({ id: 'lab', dependsOn: ['healthcare'] }))).toThrow(
      /not installed/,
    );
    r.install(pack());
    r.install(pack({ id: 'lab', name: 'Lab', dependsOn: ['healthcare'] }));
    expect(() => r.enable('lab')).toThrow(/Enable dependency/);
    r.enable('healthcare');
    r.enable('lab');
    expect(() => r.disable('healthcare')).toThrow(/depends on it/);
  });

  it('tracks the module ids contributed by enabled packs', () => {
    const r = new SolutionPackRegistry({ coreFamilies: ['Finance'] });
    r.install(pack({ modules: [mod('patient'), mod('appointment')] }));
    expect(r.enabledModuleIds()).toEqual([]);
    r.enable('healthcare');
    expect(r.enabledModuleIds().sort()).toEqual(['appointment', 'patient']);
  });

  it('upgrades only to a strictly higher, valid version', () => {
    const r = new SolutionPackRegistry();
    r.install(pack());
    expect(() => r.upgrade(pack({ version: '1.0.0' }))).toThrow(/higher/);
    r.upgrade(pack({ version: '1.1.0', description: 'Clinical v1.1' }));
    expect(r.get('healthcare')?.manifest.version).toBe('1.1.0');
  });
});
