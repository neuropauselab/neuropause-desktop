/**
 * Phase 6 Stage 11 — registry integrity + the doc lock (the Stage 6–10
 * precedent): the federation registries are structurally valid, cover the REAL
 * P9-S2 vocabularies exactly (share kinds, exchange kinds, trust levels,
 * seeded policy actions), reference only Stage 9 services and Stage 10
 * capabilities, and are locked to docs/desktop/federation/FEDERATION-PLATFORM.md
 * so code and documentation cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_CAPABILITIES, EFED_QUESTION_KEYS, EXCHANGE_KINDS, TRUST_SIGNAL_KINDS } from '@neuropause/shared';
import {
  EXCHANGE_KIND_MAP,
  EXPOSURE_BY_KIND,
  federationRegistryIssues,
  PARTNER_EXPOSURE,
  REAL_POLICY_ACTIONS,
  REAL_S9_SERVICE_IDS,
  REAL_SHARE_KINDS,
  REAL_TRUST_LEVELS,
  SHARE_KIND_CAPABILITIES,
  SHARING_POLICY_REFS,
  TRUST_EXPECTATION_BY_LEVEL,
  TRUST_EXPECTATIONS,
} from './federationRegistry';

describe('registry integrity', () => {
  it('reports zero issues for the shipped registries', () => {
    expect(federationRegistryIssues()).toEqual([]);
  });

  it('covers the six REAL exchange kinds and five REAL share kinds exactly — none invented, none missing', () => {
    expect(EXCHANGE_KIND_MAP.map((d) => d.kind).sort()).toEqual([...EXCHANGE_KINDS].sort());
    expect(SHARE_KIND_CAPABILITIES.map((s) => s.kind).sort()).toEqual([...REAL_SHARE_KINDS].sort());
  });

  it('dashboard_template honestly declares that no local registry exists', () => {
    const d = EXCHANGE_KIND_MAP.find((x) => x.kind === 'dashboard_template')!;
    expect(d.localRecordKind).toBe('none');
  });

  it('every capability reference is one of the twelve Stage 10 business capabilities', () => {
    const caps = new Set<string>(BUSINESS_CAPABILITIES);
    for (const d of EXCHANGE_KIND_MAP) for (const c of d.capabilityKeys) expect(caps.has(c), `${d.kind}/${c}`).toBe(true);
    for (const s of SHARE_KIND_CAPABILITIES) for (const c of s.capabilityKeys) expect(caps.has(c), `${s.kind}/${c}`).toBe(true);
  });

  it('trust expectations cover all four levels, use only the seven signal kinds, and are monotone', () => {
    expect(TRUST_EXPECTATIONS.map((t) => t.level).sort()).toEqual([...REAL_TRUST_LEVELS].sort());
    for (const t of TRUST_EXPECTATIONS) for (const s of t.expectedSignals) expect(TRUST_SIGNAL_KINDS).toContain(s);
    expect(TRUST_EXPECTATION_BY_LEVEL.get('none')!.expectedSignals).toHaveLength(0);
    expect(TRUST_EXPECTATION_BY_LEVEL.get('full')!.expectedSignals.length).toBeGreaterThan(
      TRUST_EXPECTATION_BY_LEVEL.get('verified')!.expectedSignals.length,
    );
  });

  it('the sharing-policy refs are exactly the four seeded federation-governance actions', () => {
    expect(SHARING_POLICY_REFS.map((p) => p.action).sort()).toEqual([...REAL_POLICY_ACTIONS].sort());
  });

  it('exposure maps every share kind, referencing only REAL Stage 9 service ids', () => {
    expect(PARTNER_EXPOSURE.map((p) => p.kind).sort()).toEqual([...REAL_SHARE_KINDS].sort());
    for (const p of PARTNER_EXPOSURE) for (const svc of p.serviceIds) expect(REAL_S9_SERVICE_IDS).toContain(svc);
    expect(EXPOSURE_BY_KIND.get('governance_policy')!.serviceIds).toEqual([]);
  });
});

describe('registry ↔ doc lock (docs/desktop/federation/FEDERATION-PLATFORM.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(join(here, '../../../../../docs/desktop/federation/FEDERATION-PLATFORM.md'), 'utf8');

  it('documents every share kind, exchange kind, trust level, signal, and policy action', () => {
    for (const k of REAL_SHARE_KINDS) expect(doc).toContain(`\`${k}\``);
    for (const k of EXCHANGE_KINDS) expect(doc).toContain(`\`${k}\``);
    for (const l of REAL_TRUST_LEVELS) expect(doc).toContain(`\`${l}\``);
    for (const s of TRUST_SIGNAL_KINDS) expect(doc).toContain(`\`${s}\``);
    for (const a of REAL_POLICY_ACTIONS) expect(doc).toContain(`\`${a}\``);
  });

  it('documents the six efed:* channels, the federation:read scope, and the watch source', () => {
    for (const ch of ['efed:partners', 'efed:trust', 'efed:exchange', 'efed:sharing', 'efed:dashboard', 'efed:report']) {
      expect(doc).toContain(`\`${ch}\``);
    }
    expect(doc).toContain('`federation:read`');
    expect(doc).toContain('`federation-watch`');
  });

  it('documents all ten assistant question keys and the exposure service ids', () => {
    for (const k of EFED_QUESTION_KEYS) expect(doc).toContain(`\`${k}\``);
    expect(EFED_QUESTION_KEYS).toHaveLength(10);
    for (const p of PARTNER_EXPOSURE) for (const svc of p.serviceIds) expect(doc).toContain(`\`${svc}\``);
  });

  it('states the structural honesty: records not networking, declared-authoritative trust, heuristic name-matching', () => {
    expect(doc).toContain('no wire protocol');
    expect(doc).toContain('Computed trust never replaces declared trust');
    expect(doc.toLowerCase()).toContain('stated heuristic');
  });
});
