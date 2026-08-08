/**
 * IP-01 — pure tests for Solution Pack validation.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { validateSolutionPack } from './validate';
import type { SolutionPackManifest } from './types';

// Only id + group are read by validation; the rest of the descriptor is elided.
const mod = (id: string, group: string): EnterpriseModuleDescriptor =>
  ({ id, group }) as unknown as EnterpriseModuleDescriptor;

const base = (over: Partial<SolutionPackManifest> = {}): SolutionPackManifest => ({
  id: 'healthcare',
  name: 'Healthcare',
  industry: 'Healthcare',
  version: '1.0.0',
  description: 'Clinical operations pack',
  coreModulesUsed: ['invoice', 'contact'],
  ...over,
});

describe('validateSolutionPack', () => {
  it('accepts a valid config-only pack', () => {
    expect(validateSolutionPack(base())).toEqual([]);
  });

  it('rejects a bad id and a bad version', () => {
    const problems = validateSolutionPack(base({ id: 'Bad_Id', version: '1.0' })).join(' ');
    expect(problems).toMatch(/id must be kebab-case/);
    expect(problems).toMatch(/MAJOR\.MINOR\.PATCH/);
  });

  it('flags a pack module colliding with a certified core id', () => {
    const problems = validateSolutionPack(
      base({ modules: [mod('patient', 'Healthcare'), mod('invoice', 'Healthcare')] }),
      { coreModuleIds: ['invoice'] },
    );
    expect(problems.some((p) => p.includes('collides with a certified core module'))).toBe(true);
  });

  it('flags reusing a core family or an empty group', () => {
    const reuse = validateSolutionPack(base({ modules: [mod('patient', 'Finance')] }), {
      coreFamilies: ['Finance'],
    });
    expect(reuse.some((p) => p.includes('must not reuse the core family'))).toBe(true);
    const empty = validateSolutionPack(base({ modules: [mod('patient', '')] }));
    expect(empty.some((p) => p.includes('non-empty group'))).toBe(true);
  });

  it('flags collision with another pack and intra-pack duplicates', () => {
    const dup = validateSolutionPack(
      base({ modules: [mod('patient', 'Healthcare'), mod('patient', 'Healthcare')] }),
    );
    expect(dup.some((p) => p.includes('declared twice'))).toBe(true);
    const cross = validateSolutionPack(base({ modules: [mod('patient', 'Healthcare')] }), {
      existingPackModuleIds: ['patient'],
    });
    expect(cross.some((p) => p.includes("another pack's module id"))).toBe(true);
  });
});
