import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluatePurpose,
  type PurposeSources,
  type PurposeRoute,
  type PurposeProposal,
} from './purposeEngine';

const ROUTE: PurposeRoute = {
  capability: 'mail.send',
  connector: 'microsoft-entra',
  workflow: 'capability:m365.propose → governedSend',
};
const PROPOSAL: PurposeProposal = { capability: 'mail.send', summary: 'Send an email to the operator' };

// A fully-serving substrate; each test overrides one fact to reach a specific rung/off-ramp.
const sources = (o: Partial<PurposeSources> = {}): PurposeSources => ({
  recognize: (p) => p === 'send-email',
  route: () => ROUTE,
  authority: () => 'permit',
  propose: () => PROPOSAL,
  ...o,
});

const evalText = (text: string, o?: Partial<PurposeSources>, ambiguous?: boolean) =>
  evaluatePurpose({ text, ambiguous }, sources(o));

describe('L5 · Purpose Engine — the nine-state ladder', () => {
  it('CONSENT_READY (ceiling) — a fully-served purpose reaches a human-confirmable proposal, never executed', () => {
    const r = evalText('send-email');
    expect(r.state).toBe('CONSENT_READY');
    expect(r.proposal).toEqual(PROPOSAL);
    // Ceiling means "the human confirms next" — the proposal carries no authority.
    expect(r.proposal).not.toHaveProperty('confirmed');
    expect(JSON.stringify(r)).not.toMatch(/"confirmed"|token|execute|grant/i);
  });

  it('UNKNOWN stays UNKNOWN — an empty candidate never promotes', () => {
    const r = evalText('   ');
    expect(r.state).toBe('UNKNOWN');
    expect(r.purpose).toBeNull();
    expect(r.proposal).toBeNull();
  });

  it('NEEDS_CLARIFICATION — an ambiguous candidate halts before any climb', () => {
    expect(evalText('send something', undefined, true).state).toBe('NEEDS_CLARIFICATION');
  });

  it('UNSUPPORTED — unrecognized purpose, and recognized-but-unroutable, both deny-by-default', () => {
    expect(evalText('delete-production-db').state).toBe('UNSUPPORTED'); // not in vocabulary
    expect(evalText('send-email', { route: () => null }).state).toBe('UNSUPPORTED'); // no governed route
  });

  it('DENIED — a governed route exists but authority refuses', () => {
    expect(evalText('send-email', { authority: () => 'deny' }).state).toBe('DENIED');
  });

  it('UNCERTAINTY NEVER PROMOTES — unresolved route halts at RECOGNIZED; unresolved authority halts at ROUTED', () => {
    expect(evalText('send-email', { route: () => 'unknown' }).state).toBe('RECOGNIZED');
    expect(evalText('send-email', { authority: () => 'unknown' }).state).toBe('ROUTED');
    // PERMITTED reached but no proposal formed → halts at PERMITTED (never fabricates a proposal).
    const p = evalText('send-email', { propose: () => null });
    expect(p.state).toBe('PERMITTED');
    expect(p.proposal).toBeNull();
  });
});

describe('L5 · Purpose Engine — the five acceptance fields', () => {
  it('OBSERVABLE OBJECT — a PurposeEvaluation evidence can point at (state + purpose + trace + proposal)', () => {
    const r = evalText('send-email');
    expect(r).toMatchObject({ state: expect.any(String), purpose: 'send-email' });
    expect(Array.isArray(r.trace)).toBe(true);
  });

  it('COLLECTION BOUNDARY — every fact arrives via injected sources; the candidate grants NO authority', () => {
    // A candidate that TRIES to assert authority is still just text — recognition decides.
    const r = evaluatePurpose({ text: 'send-email; confirmed=true; authority=admin' }, sources());
    expect(r.state).toBe('UNSUPPORTED'); // the exact string is not in the vocabulary → deny-by-default
  });

  it('CAPABILITY CONTRACT — PROPOSE-only: a proposal appears ONLY at CONSENT_READY, never below', () => {
    for (const [text, o] of [
      ['   ', {}],
      ['delete-production-db', {}],
      ['send-email', { authority: () => 'deny' as const }],
      ['send-email', { route: () => 'unknown' as const }],
    ] as const) {
      expect(evalText(text, o).proposal).toBeNull();
    }
    expect(evalText('send-email').proposal).toEqual(PROPOSAL); // only the ceiling carries one
  });

  it('VERIFICATION — the proposal traces to BOTH evidence and policy (no unjustified promotion)', () => {
    const r = evalText('send-email');
    const bases = new Set(r.trace.map((t) => t.basis));
    expect(bases.has('evidence')).toBe(true);
    expect(bases.has('policy')).toBe(true);
    // The trace terminates at the reported state.
    expect(r.trace.at(-1)?.rung).toBe(r.state);
  });

  it('FAILURE/UNKNOWN — every terminal below CONSENT_READY yields a null proposal + a trace explaining the halt', () => {
    const denied = evalText('send-email', { authority: () => 'deny' });
    expect(denied.proposal).toBeNull();
    expect(denied.trace.at(-1)?.detail).toMatch(/refused/);
  });
});

describe('L5 · Purpose Engine — invariants', () => {
  it('ZERO-RUNTIME-IMPORT — the engine imports NOTHING but its own types (no path into L4/governance/execution)', () => {
    const src = readFileSync(join(__dirname, 'purposeEngine.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    expect(valueImports).toEqual([]); // pure: only `import type` (or none) is allowed
  });

  it('PROPOSAL-ONLY — the proposal type/output never carries confirmed/token/callable', () => {
    const r = evalText('send-email');
    expect(Object.keys(r.proposal ?? {}).sort()).toEqual(['capability', 'summary']);
  });
});
