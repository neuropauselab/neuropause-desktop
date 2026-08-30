/**
 * Phase 8 (RC hardening 8.2) — the store-path registry lock. This is the test
 * that prevents the pre-Phase-8 class of bug from returning: business data
 * silently living outside backup/restore. It asserts the CRITICAL store set
 * (each name verified against the production instance wiring that creates it)
 * is covered by some domain entry, and that the enterprise-module prefix
 * pattern is present so ALL certified module stores — current and future —
 * are covered without per-module bookkeeping.
 */
import { describe, expect, it } from 'vitest';
import { DOMAIN_FILES, LOCAL_DOMAINS, isPrefixEntry } from './storePaths';

const ALL_ENTRIES = Object.values(DOMAIN_FILES).flat();

/** True when a concrete store filename is covered by an exact or prefix entry. */
function covered(filename: string): boolean {
  return ALL_ENTRIES.some((entry) =>
    isPrefixEntry(entry) ? filename.startsWith(entry.slice(0, -1)) : entry === filename,
  );
}

describe('store-path registry (backup coverage lock)', () => {
  it('covers every critical production store by exact name', () => {
    // Each filename below has exactly one production creator (instance wiring).
    const critical = [
      'registry.json',
      'graph.json',
      'unified-store.json',
      'memory.json',
      'enterprise-workspaces.json',
      'enterprise-org.json',
      'workforce-registry.json',
      'workforce-jobs.json',
      'workforce-audit.json',
      'plugins.json',
      'update-prefs.json',
      'update-history.json',
      'connectors.json',
      'onboarding.json',
      'feature-flags.json',
      'pilot.json',
      'license-status.json',
      'feedback.json',
      'assistant-conversations.json',
      'automations.json',
      'executive-decisions.json',
      'enterprise-governance.json',
      'health-history.json',
    ];
    for (const file of critical) {
      expect(covered(file), `"${file}" is not covered by any backup domain`).toBe(true);
    }
  });

  it('covers EVERY enterprise-module store via the prefix pattern — present and future', () => {
    expect(DOMAIN_FILES.business).toContain('enterprise-module-*');
    // The pattern must match the framework's real path shape for any module id.
    expect(covered('enterprise-module-finance.json')).toBe(true);
    expect(covered('enterprise-module-hr-payroll-runs.json')).toBe(true);
    expect(covered('enterprise-module-some-future-module.json')).toBe(true);
  });

  it('deliberately excludes the migration engine’s own files (it owns its rollback)', () => {
    expect(covered('data-version.json')).toBe(false);
    expect(covered('migration-audit.json')).toBe(false);
  });

  it('P13C GATE 11 — the two secret vaults are inside backup', () => {
    // Both were outside the registry: a corruption or delete lost every
    // credential with no restore path. They hold only safeStorage ciphertext,
    // so a same-machine backup is meaningful and off-machine copies are inert.
    expect(covered('vault.bin')).toBe(true);
    expect(covered('connector-vault.bin')).toBe(true);
  });

  it('every domain except database has local files, and business/assistant are live domains', () => {
    expect(LOCAL_DOMAINS).toContain('business');
    expect(LOCAL_DOMAINS).toContain('assistant');
    expect(LOCAL_DOMAINS).not.toContain('database');
  });
});
