/**
 * S113 (H8) — decision-quality / missing-evidence (harvested from ckdl analysis.ts). Advisory only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { missingEvidenceGaps, decisionQuality } from './missingEvidence';
import { assessEvidenceTrust, type TrustEvidenceItem } from './trustModel';

const now = 10 * 24 * 60 * 60 * 1000;
const human: TrustEvidenceItem = { type: 'human-input', at: now, verified: true };
const metric: TrustEvidenceItem = { type: 'metric', at: now, verified: true };
const doc: TrustEvidenceItem = { type: 'document', at: now, verified: false };

describe('H8 — missing-evidence gaps (honest, no fabrication)', () => {
  it('empty evidence → all core gaps present', () => {
    const gaps = missingEvidenceGaps({ evidence: [] });
    const kinds = gaps.map((g) => g.kind);
    expect(kinds).toContain('human-input');
    expect(kinds).toContain('verification');
    expect(kinds).toContain('metric');
    expect(kinds).toContain('insufficient-evidence');
    expect(kinds).toContain('confidence');
  });

  it('complete evidence + confidence + justified alternatives → no gaps', () => {
    const gaps = missingEvidenceGaps({
      evidence: [human, metric, doc],
      statedConfidence: 0.8,
      alternatives: [{ label: 'A', rationale: 'cheaper' }, { label: 'B', rationale: 'faster' }],
    });
    expect(gaps).toEqual([]);
  });

  it('an alternative without rationale is a gap', () => {
    const gaps = missingEvidenceGaps({ evidence: [human, metric, doc], statedConfidence: 0.5, alternatives: [{ label: 'X' }] });
    expect(gaps.some((g) => g.kind === 'rationale' && g.detail.includes('X'))).toBe(true);
  });
});

describe('H8 — decisionQuality composes with S108 trust (advisory only)', () => {
  it('strong when trust not-low AND no gaps', () => {
    const a = assessEvidenceTrust([human, metric, doc], {}, { now });
    const q = decisionQuality(a, { evidence: [human, metric, doc], statedConfidence: 0.8, alternatives: [{ label: 'A', rationale: 'r' }] });
    expect(q.gaps).toEqual([]);
    expect(q.trustBand === 'moderate' || q.trustBand === 'high').toBe(true);
    expect(q.strong).toBe(true);
    expect(q.summary).toMatch(/advisory only/);
  });

  it('not strong when gaps exist; summary flags "not a permission"', () => {
    const a = assessEvidenceTrust([], {}, { now });
    const q = decisionQuality(a, { evidence: [] });
    expect(q.strong).toBe(false);
    expect(q.summary).toMatch(/not a permission/);
  });

  it('ADVISORY: result carries no authority/permission surface, no callable', () => {
    const a = assessEvidenceTrust([human], {}, { now });
    const q = decisionQuality(a, { evidence: [human], statedConfidence: 0.5 });
    for (const k of ['permission', 'authorized', 'grant', 'admit', 'token']) expect(q).not.toHaveProperty(k);
    for (const v of Object.values(q)) expect(typeof v).not.toBe('function');
  });

  it('STRUCTURAL: missingEvidence.ts imports only S108 trust types — no authority path', () => {
    const src = readFileSync(join(__dirname, 'missingEvidence.ts'), 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(importLines.every((l) => l.includes("'./trustModel'"))).toBe(true);
    for (const forbidden of ['authz', '/cst', 'commandBus', 'dispatchCommand', 'EnterpriseRecordStore', '@neuropause/ckdl']) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });
});
