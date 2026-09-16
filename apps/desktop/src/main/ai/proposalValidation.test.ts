/**
 * S117 — AI proposal metadata + tool-argument validation (advisory, pre-execution). Proves the harvested
 * capability validates arguments, estimates token/cost impact, and — the safety boundary — CANNOT grant
 * authority, CANNOT execute, CANNOT bypass RBAC/CST/approval, CANNOT be supplied a principal/tenant, and
 * imports nothing but the authoritative pricing table + zod types.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  estimateTokens,
  estimateProposalCost,
  validateToolArguments,
  buildProposalMetadata,
} from './proposalValidation';

const KNOWN_MODEL = 'claude-haiku-4-5-20251001';

describe('O5 — token & cost estimation (reuses ai/pricing; estimate-only)', () => {
  it('estimateTokens ≈ ceil(len/4), minimum 1', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('known model → cost via the authoritative table; flagged estimateOnly + pricingKnown', () => {
    const e = estimateProposalCost(KNOWN_MODEL, 1000, 1000);
    expect(e.estimateOnly).toBe(true);
    expect(e.pricingKnown).toBe(true);
    expect(e.costUsd).toBeGreaterThan(0);
    expect(e.totalTokens).toBe(2000);
  });

  it('unknown model → cost 0 but pricingKnown=false (honest: unknown, not free)', () => {
    const e = estimateProposalCost('no-such-model', 1000, 1000);
    expect(e.pricingKnown).toBe(false);
    expect(e.costUsd).toBe(0);
    expect(e.estimateOnly).toBe(true);
  });

  it('negative/NaN token inputs are floored to 0 (no negative estimate)', () => {
    const e = estimateProposalCost(KNOWN_MODEL, -5, Number.NaN);
    expect(e.promptTokens).toBe(0);
    expect(e.completionTokens).toBe(0);
    expect(e.costUsd).toBe(0);
  });
});

describe('O4 — tool argument validation (pure; never executes)', () => {
  const schema = z.object({ to: z.string().email(), count: z.number().int().min(1).max(10) }).strict();

  it('valid arguments pass', () => {
    const v = validateToolArguments('sendThing', schema, { to: 'a@b.com', count: 3 });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('missing required field → fail with structured path', () => {
    const v = validateToolArguments('sendThing', schema, { count: 3 });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.path === 'to')).toBe(true);
  });

  it('wrong type → fail', () => {
    const v = validateToolArguments('sendThing', schema, { to: 'a@b.com', count: 'three' });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.path === 'count')).toBe(true);
  });

  it('extra/unknown key → fail (strict schema)', () => {
    const v = validateToolArguments('sendThing', schema, { to: 'a@b.com', count: 3, injectedAuthority: true });
    expect(v.ok).toBe(false);
  });

  it('boundary values: min ok, below-min fails', () => {
    expect(validateToolArguments('t', schema, { to: 'a@b.com', count: 1 }).ok).toBe(true);
    expect(validateToolArguments('t', schema, { to: 'a@b.com', count: 0 }).ok).toBe(false);
    expect(validateToolArguments('t', schema, { to: 'a@b.com', count: 11 }).ok).toBe(false);
  });

  it('malformed args (non-object) fail closed', () => {
    expect(validateToolArguments('t', schema, null).ok).toBe(false);
    expect(validateToolArguments('t', schema, 'not-an-object').ok).toBe(false);
  });

  it('UNKNOWN/missing schema fails CLOSED (code no_schema)', () => {
    const v = validateToolArguments('t', undefined, { any: 'thing' });
    expect(v.ok).toBe(false);
    expect(v.errors[0].code).toBe('no_schema');
  });

  it('a schema whose parse THROWS fails CLOSED (never treated valid)', () => {
    const evil = { safeParse: () => { throw new Error('boom'); } } as unknown as Parameters<typeof validateToolArguments>[1];
    const v = validateToolArguments('t', evil, { x: 1 });
    expect(v.ok).toBe(false);
    expect(v.errors[0].code).toBe('schema_error');
  });
});

describe('O6 — adversarial: the metadata layer cannot become an authorization surface', () => {
  const schema = z.object({ to: z.string() });

  it('buildProposalMetadata returns advisory data only — NO authority-shaped fields', () => {
    const m = buildProposalMetadata({
      model: KNOWN_MODEL,
      promptText: 'draft an email',
      completionText: 'Dear ...',
      tool: { name: 'sendMail', schema, rawArgs: { to: 'a@b.com' } },
    });
    expect(m.advisory).toBe(true);
    expect(Object.keys(m).sort()).toEqual(['advisory', 'estimate', 'toolValidation']);
    const blob = JSON.stringify(m).toLowerCase();
    // note: 'token' is intentionally excluded — it collides with the legitimate promptTokens/totalTokens count fields.
    for (const forbidden of ['grant', 'permission', 'role', 'tenant', 'confirmed', 'credential', 'authority', 'privatekey']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('estimated cost is inert data — validity/cost do not become an allow flag', () => {
    const m = buildProposalMetadata({ model: KNOWN_MODEL, promptText: 'x', tool: { name: 't', schema, rawArgs: { to: 'a@b.com' } } });
    // No `allow`/`permit`/`authorized` field is produced regardless of validity.
    expect((m as Record<string, unknown>).allow).toBeUndefined();
    expect((m as Record<string, unknown>).authorized).toBeUndefined();
    expect(m.toolValidation!.ok).toBe(true); // valid, yet still no authority is conferred
  });

  it('invalid arguments are rejected and surfaced (fail-closed), not silently passed', () => {
    const m = buildProposalMetadata({ model: KNOWN_MODEL, promptText: 'x', tool: { name: 't', schema, rawArgs: { wrong: 1 } } });
    expect(m.toolValidation!.ok).toBe(false);
    expect(m.toolValidation!.errors.length).toBeGreaterThan(0);
  });

  it('STRUCTURAL: the module imports ONLY ./pricing + zod — no store/command-bus/authz/executor/runtime', () => {
    const src = readFileSync(join(__dirname, 'proposalValidation.ts'), 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    // every import must be from './pricing' or 'zod'
    for (const line of importLines) {
      expect(/from '\.\/pricing'|from 'zod'/.test(line)).toBe(true);
    }
    for (const forbidden of ['executor', 'commandBus', 'dispatchCommand', 'runtimeAuthz', '/cst', 'EnterpriseRecordStore', 'aiEngine', 'modelClient', 'safeStorage', 'credentialStore']) {
      expect(src.includes(forbidden)).toBe(false);
    }
    // no execute path: the module must not call any tool
    expect(src.includes('.execute(')).toBe(false);
  });

  it('the API takes NO principal/tenant/authority parameter — an AI proposal cannot supply one', () => {
    // buildProposalMetadata's input is model/text/tool only — structurally verified by the type + this call.
    const m = buildProposalMetadata({ model: KNOWN_MODEL, promptText: 'x' });
    expect(m.estimate.estimateOnly).toBe(true);
    expect(m.toolValidation).toBeUndefined(); // no tool proposed → no validation, no authority
  });
});
