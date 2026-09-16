/**
 * S132 — tests for the GitHub Actions least-privilege assertion
 * (`scripts/verify-workflow-permissions.cjs`). Proves the classifier fails closed on a missing block,
 * write-all, and stray write scopes; permits the allowlisted release-write; and — END-TO-END — that EVERY
 * real workflow in `.github/workflows` is least-privilege.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const { classifyWorkflowPermissions, DEFAULT_WRITE_ALLOWLIST } = require('../../../../../scripts/verify-workflow-permissions.cjs') as {
  classifyWorkflowPermissions: (name: string, doc: unknown, allowlist?: Record<string, string[]>) => { ok: boolean; errors: string[] };
  DEFAULT_WRITE_ALLOWLIST: Record<string, string[]>;
};

const workflowsDir = join(__dirname, '..', '..', '..', '..', '..', '.github', 'workflows');

describe('S132 · workflow least-privilege classifier (fail-closed)', () => {
  it('REJECTS a workflow with no permissions block', () => {
    const r = classifyWorkflowPermissions('x.yml', { on: {}, jobs: {} });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/no top-level permissions block/);
  });

  it('REJECTS write-all', () => {
    expect(classifyWorkflowPermissions('x.yml', { permissions: 'write-all' }).ok).toBe(false);
  });

  it('ACCEPTS read-all and contents: read', () => {
    expect(classifyWorkflowPermissions('x.yml', { permissions: 'read-all' }).ok).toBe(true);
    expect(classifyWorkflowPermissions('x.yml', { permissions: { contents: 'read' } }).ok).toBe(true);
  });

  it('REJECTS an unexpected write scope not in the allowlist', () => {
    const r = classifyWorkflowPermissions('x.yml', { permissions: { contents: 'read', packages: 'write' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unexpected write scope 'packages:write'/);
  });

  it('ACCEPTS a write scope only when an explicit allowlist names it for THAT workflow', () => {
    const allow = { 'x.yml': ['contents:write'] };
    expect(classifyWorkflowPermissions('x.yml', { permissions: { contents: 'write' } }, allow).ok).toBe(true);
    // the SAME write scope on any other workflow is rejected
    expect(classifyWorkflowPermissions('desktop-ci.yml', { permissions: { contents: 'write' } }, allow).ok).toBe(false);
  });

  it('REJECTS contents:write for every real workflow name, including the governed release workflow', () => {
    // The governed release path (neuropause-release.yml) publishes with environment-scoped credentials, never
    // with GITHUB_TOKEN, so no workflow in this repository holds a top-level write scope. The legacy
    // macos-release.yml / windows-release.yml (softprops GitHub Release) are gone with their allowance.
    for (const name of ['neuropause-release.yml', 'macos-release.yml', 'windows-release.yml', 'desktop-ci.yml']) {
      expect(classifyWorkflowPermissions(name, { permissions: { contents: 'write' } }).ok, name).toBe(false);
    }
  });

  it('the default allowlist is EMPTY — nothing in this repository needs a write scope', () => {
    expect(DEFAULT_WRITE_ALLOWLIST).toEqual({});
  });
});

describe('S132 · every real workflow is least-privilege', () => {
  const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  it('there are workflows to check (guard against an empty scan)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of files) {
    it(`${f} — declares a least-privilege permissions block`, () => {
      const doc = yaml.load(readFileSync(join(workflowsDir, f), 'utf8'));
      const r = classifyWorkflowPermissions(f, doc);
      expect(r.ok, r.errors.join('; ')).toBe(true);
    });
  }
});
