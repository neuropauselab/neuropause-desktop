/**
 * Phase 6 Stage 7 — asset class registry tests: integrity, the exact
 * enhancement-#4 precedence order, the eight standard domains, the declared
 * lifecycle transition table (and that NO transition executor ships), and the
 * registry ↔ KNOWLEDGE-ASSETS.md doc lock (the Stage 6 signal-map precedent).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_PRECEDENCE,
  KNOWLEDGE_ASSET_CLASS_IDS,
  KNOWLEDGE_LIFECYCLE_STATES,
  KNOWLEDGE_LIFECYCLE_TRANSITIONS,
  STANDARD_DOMAINS,
} from '@neuropause/shared';
import * as registryModule from './assetRegistry';
import { ASSET_CLASS_BY_ID, ASSET_CLASS_REGISTRY, bumpCriticality, rankOf, registryIntegrityIssues } from './assetRegistry';

describe('ASSET_CLASS_REGISTRY integrity', () => {
  it('has all 11 declared classes, unique, with no issues', () => {
    expect(ASSET_CLASS_REGISTRY).toHaveLength(11);
    expect(registryIntegrityIssues()).toEqual([]);
    expect(new Set(ASSET_CLASS_REGISTRY.map((c) => c.id)).size).toBe(11);
    for (const id of KNOWLEDGE_ASSET_CLASS_IDS) expect(ASSET_CLASS_BY_ID.has(id)).toBe(true);
  });

  it('every class declares backing, retention detail + source, and an access scope', () => {
    for (const c of ASSET_CLASS_REGISTRY) {
      expect(c.backing.length).toBeGreaterThan(0);
      expect(c.retention.detail.length).toBeGreaterThan(0);
      expect(c.retention.source.length).toBeGreaterThan(0);
      expect(c.accessScope.length).toBeGreaterThan(0);
    }
  });

  it('declared boundaries are explicit: the capability registry is not main-readable', () => {
    expect(ASSET_CLASS_BY_ID.get('capability-standard')?.mainReadable).toBe(false);
    expect(ASSET_CLASS_REGISTRY.filter((c) => !c.mainReadable)).toHaveLength(1);
  });

  it('the workflow-definition class documents the honest gap (no persisted library)', () => {
    const wf = ASSET_CLASS_BY_ID.get('workflow-definition');
    expect(wf?.authorityTier).toBe('derived');
    expect(wf?.description).toMatch(/[Nn]o persisted workflow-definition library/);
  });
});

describe('enhancement #4 — the exact authority precedence', () => {
  it('is Governed Decision → Governance Policy → Organization Standard → Approved Document → Versioned Prompt → Provider Document → Explicit Memory → Derived Knowledge', () => {
    expect(AUTHORITY_PRECEDENCE.map((r) => r.key)).toEqual([
      'governed-decision',
      'governance-policy',
      'organization-standard',
      'approved-document',
      'versioned-prompt',
      'provider-document',
      'explicit-memory',
      'derived-knowledge',
    ]);
    expect(AUTHORITY_PRECEDENCE.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rankOf resolves every class default rank', () => {
    expect(rankOf('governed-decision')).toBe(1);
    expect(rankOf('derived-knowledge')).toBe(8);
    for (const c of ASSET_CLASS_REGISTRY) expect(rankOf(c.authorityRank)).toBeGreaterThanOrEqual(1);
  });

  it('criticality bumps are capped at critical', () => {
    expect(bumpCriticality('low')).toBe('medium');
    expect(bumpCriticality('high')).toBe('critical');
    expect(bumpCriticality('critical')).toBe('critical');
  });
});

describe('lifecycle (7.4) — declared transitions, NO executor', () => {
  it('declares the six states and a legal-transition table over exactly those states', () => {
    expect(KNOWLEDGE_LIFECYCLE_STATES).toHaveLength(6);
    for (const state of KNOWLEDGE_LIFECYCLE_STATES) {
      for (const to of KNOWLEDGE_LIFECYCLE_TRANSITIONS[state]) {
        expect(KNOWLEDGE_LIFECYCLE_STATES).toContain(to);
      }
    }
    expect(KNOWLEDGE_LIFECYCLE_TRANSITIONS.archived).toEqual([]);
    expect(KNOWLEDGE_LIFECYCLE_TRANSITIONS.approved).toContain('superseded');
  });

  it('the registry module exports NO mutator (governance only: transitions stay with the existing governed writes)', () => {
    for (const [name, value] of Object.entries(registryModule)) {
      if (typeof value !== 'function') continue;
      expect(name).not.toMatch(/^(set|apply|transition|update|write|save|execute)/i);
    }
  });
});

describe('standard domains (7.6)', () => {
  it('declares exactly the eight domains', () => {
    expect([...STANDARD_DOMAINS]).toEqual([
      'engineering',
      'deployment',
      'security',
      'data-handling',
      'ai-usage',
      'communication',
      'operations',
      'compliance',
    ]);
  });
});

describe('registry ↔ doc lock (docs/desktop/knowledge/KNOWLEDGE-ASSETS.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(join(here, '../../../../../docs/desktop/knowledge/KNOWLEDGE-ASSETS.md'), 'utf8');

  it('every class id appears in the doc', () => {
    for (const c of ASSET_CLASS_REGISTRY) expect(doc).toContain(`\`${c.id}\``);
  });

  it('every authority rank key and every standard domain appears in the doc', () => {
    for (const r of AUTHORITY_PRECEDENCE) expect(doc).toContain(`\`${r.key}\``);
    for (const d of STANDARD_DOMAINS) expect(doc).toContain(`\`${d}\``);
  });

  it('the doc states the resolution method and the no-executor rule', () => {
    expect(doc).toContain('authority-precedence → freshness → stable-id');
    expect(doc).toMatch(/no transition\s+executor/i);
  });
});
