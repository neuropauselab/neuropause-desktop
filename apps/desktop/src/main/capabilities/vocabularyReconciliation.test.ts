/**
 * F-N16-3 (reversibility) + F-N16-4 (oracle identity) — the reconciliation
 * slice's DISCOVER → COMPARE step, continued (operator ruling 20 Aug 2026).
 *
 * These pins establish what is TRUE so the classifications rest on observation.
 * They propose nothing and change nothing. Where the source does not settle a
 * question, the pin records the absence rather than inventing an answer.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveOracle } from '../liveBrain/executionGate';
import { reversibilityForAction } from '../cst/governedAction';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const MAIN = join(__dirname, '..');
const CST_PKG = join(__dirname, '..', '..', '..', '..', '..', 'node_modules', '@neuropause', 'cst', 'dist', 'src');
const read = (...p: string[]): string => readFileSync(join(...p), 'utf8');

/* ═══════════════════════ F-N16-3 · REVERSIBILITY ═══════════════════════ */

describe('F-N16-3 · DISCOVER — the two vocabularies, exactly as declared', () => {
  it('CST declares FIVE uppercase values; the app produces only three of them', () => {
    const types = read(CST_PKG, 'types.d.ts');
    for (const v of ['REVERSIBLE', 'PARTIALLY_REVERSIBLE', 'DIFFICULT_TO_REVERSE', 'IRREVERSIBLE', 'UNKNOWN']) {
      expect(types).toContain(`'${v}'`);
    }
    // PARTIALLY_REVERSIBLE and UNKNOWN are produced by no production path.
    const governed = read(MAIN, 'cst', 'governedAction.ts');
    const send = read(MAIN, 'cst', 'sendTransition.ts');
    const imp = read(MAIN, 'cst', 'importTransition.ts');
    const produced = `${governed}${send}${imp}`;
    expect(produced).not.toMatch(/reversibility:\s*'PARTIALLY_REVERSIBLE'/);
    expect(produced).not.toMatch(/reversibility:\s*'UNKNOWN'/);
  });

  it('the proposal side declares THREE lowercase values, inline, with no named type', () => {
    const proposal = read(MAIN, 'liveBrain', 'proposal.ts');
    expect(proposal).toMatch(/reversibility:\s*'reversible'\s*\|\s*'irreversible'\s*\|\s*'unknown'/);
    // No shared type, no import from the CST vocabulary — the two are unrelated in code.
    expect(proposal).not.toMatch(/import[^\n]*Reversibility[^\n]*@neuropause\/cst/);
  });

  it('the two vocabularies are joined by NOTHING — no mapping function, no conversion, no comparison', () => {
    const files = ['liveBrain/proposal.ts', 'liveBrain/brainProposeLane.ts', 'cst/governedAction.ts', 'cst/sendTransition.ts'];
    for (const f of files) {
      const src = read(MAIN, ...f.split('/'));
      // No case-conversion bridge between 'IRREVERSIBLE' and 'irreversible'.
      expect(src, f).not.toMatch(/reversibility[^\n]*toLowerCase|toLowerCase\(\)[^\n]*[Rr]eversib/);
    }
    // The propose lane authors its own value and never consults the CST table.
    const lane = read(MAIN, 'liveBrain', 'brainProposeLane.ts');
    expect(lane).not.toContain('reversibilityForAction');
  });
});

describe('F-N16-3 · THE DECISIVE QUESTION — does any decision branch on reversibility?', () => {
  it('the CST kernel never reads req.reversibility at all', () => {
    const kernel = read(CST_PKG, 'kernel.js');
    expect(kernel).not.toMatch(/req\.reversibility/);
  });

  it('no governance, admission, identity or execution path compares a reversibility value', () => {
    for (const f of [
      'liveBrain/proposalExecutionBoundary.ts',
      'liveBrain/executionGate.ts',
      'cst/sendTransition.ts',
      'cst/governedAction.ts',
    ]) {
      const src = read(MAIN, ...f.split('/'));
      // No equality/inequality test against the value, in either vocabulary.
      expect(src, f).not.toMatch(/reversibility\s*[!=]==/);
      expect(src, f).not.toMatch(/[!=]==\s*'IRREVERSIBLE'/);
      expect(src, f).not.toMatch(/[!=]==\s*'irreversible'/);
    }
  });

  it('reversibility is NOT part of action identity — the idempotency key never includes it', () => {
    const send = read(MAIN, 'cst', 'sendTransition.ts');
    const governed = read(MAIN, 'cst', 'governedAction.ts');
    // The key is built from tenant/connector/account/action/params only.
    expect(send).not.toMatch(/idem[^\n]*reversibility/i);
    expect(governed).not.toMatch(/idem[^\n]*reversibility/i);
  });

  it('the CST value never reaches durable evidence — it is absent from the outcome envelope and the record', async () => {
    const { createGovernedSendPorts, governedSend } = await import('../cst/sendTransition');
    const g = await governedSend({
      connectorId: 'm365', accountId: 'acct-1',
      action: { id: 'mail.send', label: 'Send', domain: 'mail', scopes: ['Mail.Send'], mutates: true, run: async () => ({ ok: true, summary: 'sent' }) },
      params: { to: ['a@example.com'], subject: 'Hi', body: 'yo' },
      confirmed: true, tenantId: 'org-test', actorId: 'sender@np.example',
      policyVersion: 'm365-send-policy-1', ownsAccount: true, grantedScopes: ['Mail.Send'],
      getToken: async () => 'tok',
      makeHttp: () => ({ postJson: async () => ({ data: {}, headers: {}, status: 202 }) }),
      rate: {}, now: () => new Date().toISOString(), ports: createGovernedSendPorts(),
    } as never);
    // The request carried 'IRREVERSIBLE'; the OUTCOME — the closed evidence envelope — has no such field.
    expect(JSON.stringify(g.outcome)).not.toContain('IRREVERSIBLE');
    expect((g.outcome as unknown as Record<string, unknown>).reversibility).toBeUndefined();
  });
});

describe('F-N16-3 · COMPARE — the two vocabularies disagree TODAY, and point opposite ways', () => {
  it('calendar.create: CST says IRREVERSIBLE (a conservative DEFAULT that disclaims the claim)', () => {
    expect(reversibilityForAction('calendar.create')).toBe('IRREVERSIBLE');
    // …and it is a fallback, not an entry: the table's own comment says the claim is NOT made.
    const governed = read(MAIN, 'cst', 'governedAction.ts');
    expect(governed).toMatch(/reversibility is NOT claimed/i);
  });

  it('calendar.create: the proposal side asserts the OPPOSITE, as a flat literal', () => {
    const dryRun = read(MAIN, 'capabilities', 'calendarCreateDryRun.test.ts');
    expect(dryRun).toMatch(/reversibility:\s*'reversible'/);
  });

  it('mail.send: the two AGREE — but by two independent hardcodes, never by derivation', () => {
    expect(reversibilityForAction('mail.send')).toBe('IRREVERSIBLE'); // via the conservative default
    const send = read(MAIN, 'cst', 'sendTransition.ts');
    expect(send).toMatch(/reversibility:\s*'IRREVERSIBLE'/); // its own literal, not the table
    const lane = read(MAIN, 'liveBrain', 'brainProposeLane.ts');
    expect(lane).toMatch(/reversibility:\s*'irreversible'/); // a third, independent literal
  });
});

/* ══════ F-N16-3 · THE INJECTION EARLY-WARNING (operator ruling, 20 Aug 2026) ══════ */

/**
 * `Proposal.reversibility` is CALLER-AUTHORED: it sits on `ProposalRequest`,
 * unlike its neighbours `authorityRequired` and `verificationPlan`, which were
 * deliberately given NO request field so they could not be injected. Today it
 * is inert — nothing reads it for any decision — so the exposure is zero.
 *
 * **Inert-but-injectable is a debt. This pin holds its interest at zero.**
 *
 * THE LAW (operator-ruled, recorded in ARCHITECTURE-MAPPING): the moment
 * reversibility gains ANY consumer that reads it for a decision, the field
 * MUST move to the derived side like `authorityRequired` and
 * `verificationPlan` — **via a presented gate, never in place.** If you are
 * here because this test failed, that is the requirement firing, not a stale
 * assertion: do not delete it, do not narrow it. Derive the value, or gate it.
 */
describe('F-N16-3 · INJECTION EARLY-WARNING — reversibility must not become an authority input', () => {
  const DECISION_SITES = [
    'liveBrain/proposalExecutionBoundary.ts', // the one gate that inspects a Proposal
    'liveBrain/executionGate.ts',
    'liveBrain/proposalStore.ts',
    'liveBrain/brainProposeLane.ts',
    'cst/sendTransition.ts',
    'cst/governedAction.ts',
    'capabilities/capabilityProposeCore.ts',
    'capabilities/m365ActionProposal.ts',
  ];

  it('NO decision site reads a reversibility value for any purpose', () => {
    for (const f of DECISION_SITES) {
      const src = read(MAIN, ...f.split('/'));
      // Producing a value is allowed (a literal assignment); READING one is not.
      const reads = (src.match(/\.reversibility\b/g) ?? []).length;
      expect({ file: f, reads }, `${f} must not READ reversibility`).toEqual({ file: f, reads: 0 });
    }
  });

  it('the execution boundary re-derives authority and oracle, and never consults reversibility', () => {
    const boundary = read(MAIN, 'liveBrain', 'proposalExecutionBoundary.ts');
    expect(boundary).toMatch(/authorityFor/); // it DOES re-derive these…
    expect(boundary).toMatch(/oracleFor/);
    expect(boundary).not.toMatch(/reversib/i); // …and does not touch this one at all
  });

  it('the only reader in the whole main process is a DISPLAY projection', () => {
    // toBrainReview interpolates it into a human-facing string. If a second
    // reader ever appears, the list below stops matching and this fails.
    const review = read(MAIN, 'liveBrain', 'toBrainReview.ts');
    expect(review).toMatch(/\.reversibility\b/);
    expect(review).toMatch(/risk:/); // it lands in the Risk display row, not a branch
  });
});

/* ═══════════════════════ F-N16-4 · ORACLE IDENTITY ═══════════════════════ */

describe('F-N16-4 · DISCOVER — what each identifier actually names', () => {
  it("'verifyEffect' names the pure RULE — it performs no I/O of its own", () => {
    const rule = read(MAIN, 'verification', 'verifyEffect.ts');
    // Every read is an injected callback; the module imports no transport, no vault, no fetch.
    expect(rule).not.toMatch(/^import[^\n]*(m365ReadBack|connectorVault|http|fetch)/m);
    expect(rule).toMatch(/readSentItems:\s*\(\)\s*=>\s*Promise/);
    // The registry supplies the identifier from OUTSIDE — the file never names itself.
    expect(rule).not.toContain("'verifyEffect'");
  });

  it("'m365ReadBack:sentItems+inbox' names the READER plus its two sources — the only I/O in the chain", () => {
    const reader = read(MAIN, 'verification', 'm365ReadBack.ts');
    expect(reader).toContain('connectorVault');
    expect(reader).toMatch(/mailFolders\/sentitems\/messages/);
    expect(reader).toMatch(/mailFolders\/inbox\/messages/);
    // It too never names itself: the identifier is assigned at the recording site.
    expect(reader).not.toContain("'m365ReadBack:sentItems+inbox'");
    const recorder = read(MAIN, 'e2e', 's16VerifyRun.ts');
    expect(recorder).toContain("oracle: 'm365ReadBack:sentItems+inbox'");
  });

  it('the ORCHESTRATOR that is actually called is named by NEITHER identifier', () => {
    const recorder = read(MAIN, 'e2e', 's16VerifyRun.ts');
    expect(recorder).toContain('verifyGovernedSend'); // what it calls
    expect(recorder).not.toMatch(/oracle:\s*'[^']*verifyGovernedSend/); // never in the identity
  });

  it('the registry names the RULE, and the record names the READER — two layers, two answers', () => {
    expect(deriveOracle('mail.send').oracleId).toBe('verifyEffect');
    const recorder = read(MAIN, 'e2e', 's16VerifyRun.ts');
    expect(recorder).toContain("oracle: 'm365ReadBack:sentItems+inbox'");
  });
});

describe('F-N16-4 · THE DECISIVE QUESTION — is oracleId ever a lookup key?', () => {
  it('NO id→implementation registry exists anywhere — implementations are chosen by static import', () => {
    for (const f of ['e2e/s16VerifyRun.ts', 'e2e/e2eVerifyRun.ts']) {
      const src = read(MAIN, ...f.split('/'));
      // The reader and orchestrator arrive by import, never by resolving a string.
      expect(src, f).toMatch(/^import[^\n]*verifyGovernedSend/m);
      expect(src, f).not.toMatch(/oracleById|ORACLE_BY|oracleRegistry|resolveOracle/);
    }
    const gate = read(MAIN, 'liveBrain', 'executionGate.ts');
    expect(gate).not.toMatch(/oracleById|ORACLE_BY|oracleRegistry|resolveOracle/);
  });

  it('oracleId IS load-bearing in exactly one way: a drift token in the canon-equality check', () => {
    const boundary = read(MAIN, 'liveBrain', 'proposalExecutionBoundary.ts');
    expect(boundary).toMatch(/oracleFor/);
    // Both sides of that comparison come from the SAME derivation, so the string
    // can detect drift but can never select an implementation.
    const gate = read(MAIN, 'liveBrain', 'executionGate.ts');
    expect(gate).toMatch(/oracleFor:\s*deriveOracle|deriveOracle/);
  });

  it('an absent oracle states what is NEEDED rather than naming a fiction', () => {
    const plan = deriveOracle('calendar.create');
    expect(plan.oracleId).toBeNull();
    expect(plan.verifiable).toBe(false);
    expect(plan.needs).toMatch(/calendar read-back oracle/);
  });

  it('NO grammar for oracle identifiers exists — the two live ids are not even the same KIND of name', () => {
    // 'verifyEffect' is a function export name; 'm365ReadBack' is a file basename
    // (its export is makeM365GraphReader) suffixed with the folders it reads.
    const reader = read(MAIN, 'verification', 'm365ReadBack.ts');
    expect(reader).toContain('makeM365GraphReader');
    expect(reader).not.toMatch(/export\s+(const|function)\s+m365ReadBack\b/);
    // Nothing anywhere defines what an oracle identifier must look like.
    const provenance = read(MAIN, 'connectors', 'actionRecord.ts');
    expect(provenance).toMatch(/readonly oracle:\s*string/); // a bare string; no union, no pattern
  });
});
