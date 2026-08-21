/**
 * F-P8 (scoped) — REJECT LOCALLY WHAT THE PROVIDER WILL REJECT ANYWAY.
 *
 * `to: []` produces a malformed request that only Graph rejects, so the product made an external call to
 * Microsoft for something that could not succeed. The gate now refuses it as GOVERNANCE-CLASS — the system
 * declined to act, execution NOT_STARTED — never as an execution failure, because nothing was attempted.
 *
 * **THE PIN THAT MATTERS MOST IS THE ONE THAT MUST *NOT* REFUSE.** A previous scoping would have enforced
 * "exactly one recipient", borrowed from the read-back oracle — but *the oracle does not REQUIRE one recipient,
 * it can only HANDLE one*. **A CAPABILITY LIMIT IS NOT A REQUIREMENT**, and refusing a user's two-recipient
 * email because our verifier is narrow would make the user pay for our incompleteness. Pin 3 is written as a
 * standing guard against that error returning.
 *
 * NO EXTERNAL EFFECT: a temp dir and the real store. Nothing is sent; no Graph call is made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { l6ExecutionGate } from './executionGate';
import { clearProposals } from './proposalStore';
import { actionRecord, type ActionRecord } from '../connectors/actionRecord';

const WS = 'tenant-A';
const runtime = { workspaceId: () => WS as string | null, actor: () => 'user:ops' as string | null };
const send = (to: unknown) => ({ actionId: 'mail.send', accountId: 'acc', connectorId: 'microsoft-entra', params: { to, subject: 'hi', body: 'hello' } });

let dir: string;
beforeEach(() => {
  clearProposals();
  dir = mkdtempSync(join(tmpdir(), 'np-fp8-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const rows = async (): Promise<readonly ActionRecord[]> =>
  (await actionRecord.query({ tenantId: WS })) as readonly ActionRecord[];

describe('F-P8 · a request with no recipient is refused before it reaches the provider', () => {
  it('PIN 1 — `to: []` REFUSES, and the send does not proceed', () => {
    const r = l6ExecutionGate(runtime, send([]), 5000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.data).toMatchObject({ outcome: 'DENIED', reason: 'MALFORMED_REQUEST' });
  });

  it('PIN 1b — whitespace-only recipients are as unsendable as none, and refuse identically', () => {
    // `to: ['   ']` is rejected by Graph exactly as `[]` is. Excluding it would leave the rule true in letter
    // and useless in fact.
    for (const bad of [[' '], ['   ', '\t'], 'not-an-array', undefined, null, [42]]) {
      const r = l6ExecutionGate(runtime, send(bad), 5000);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('PIN 2 — ONE recipient PROCEEDS (unchanged)', () => {
    expect(l6ExecutionGate(runtime, send(['a@ex.com']), 5000)).toEqual({ ok: true });
  });

  /**
   * PIN 3 — THE GUARD. It outranks every other pin in this file.
   *
   * Derived from the USER's legitimate case, not from the gate's branch: a two-recipient email is valid mail.
   * The read-back oracle cannot corroborate it (`RECIPIENT_NOT_REPRESENTABLE`), but that is OUR limitation, and
   * it must never leak into an admission decision. If this test ever goes red, someone has re-imported a
   * capability limit as a requirement.
   */
  it('PIN 3 — TWO recipients PROCEED. The oracle’s narrowness must never become the user’s problem', () => {
    expect(l6ExecutionGate(runtime, send(['a@ex.com', 'b@ex.com']), 5000)).toEqual({ ok: true });
    expect(l6ExecutionGate(runtime, send(['a@ex.com', 'b@ex.com', 'c@ex.com']), 5000)).toEqual({ ok: true });
  });

  it('PIN 4 — the refusal mints Route A’s governance row: DENY · NOT_STARTED · no verification', async () => {
    l6ExecutionGate(runtime, send([]), 5000);
    const [row] = await rows();
    expect(row.verdict).toBe('DENY');
    expect(row.executed).toBe(false);
    expect(row.outcome).toBe('NOT_STARTED');
    expect(row.verification).toBeNull();
    expect(row.tenantId).toBe(WS);
  });

  /**
   * PIN 5 — THE DETAIL IS THE RULE, NEVER THE VALUE. NO REQUEST-DERIVED TEXT, EVER.
   *
   * F-P26: NP-013's `redactCredentialText` is PINNED to preserve email shapes, so an interpolated address would
   * look protected and would not be. Interpolating the offending value is the obvious next step for the next
   * well-formedness rule — this pin is what stops it.
   */
  it('PIN 5 — the detail carries the RULE and no request-derived text', () => {
    const secret = 'victim@private.example';
    const r = l6ExecutionGate(runtime, { actionId: 'mail.send', accountId: 'acc', connectorId: 'microsoft-entra', params: { to: [' '], cc: [secret], subject: secret, body: secret } }, 5000);
    if (r.ok) throw new Error('expected a refusal');
    const serialized = JSON.stringify(r.refusal);
    expect(r.refusal.data).toMatchObject({ detail: 'at least one recipient is required' });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('private.example');
    // And the source itself must not interpolate a param value into the detail.
    const src = readFileSync(join(__dirname, 'executionGate.ts'), 'utf8');
    expect(src).toContain("detail: 'at least one recipient is required'");
  });

  it('PIN 6 — a throwing store does not change the decision', () => {
    vi.spyOn(actionRecord, 'observeGovernance').mockRejectedValue(new Error('disk full'));
    const r = l6ExecutionGate(runtime, send([]), 5000);
    expect(r.ok).toBe(false); // evidence is best-effort; refusal is not
  });

  it('NON-mail.send is untouched — the rule is scoped to the certified consequential capability', () => {
    expect(l6ExecutionGate(runtime, { actionId: 'calendar.create', accountId: 'acc', params: {} }, 5000)).toEqual({ ok: true });
  });
});
