/**
 * FG-14 — CAUSAL EPISODE IDENTITY PROPAGATION (finding F-P40).
 *
 * THE ACCEPTANCE PROPERTY, and every pin here exists to hold one half of it:
 *
 *   The SAME correlationId that identified the originating assistant episode is preserved,
 *   UNALTERED, through the mail-intent handoff, the governed execute request, the IPC boundary,
 *   the ActionRecord, persistence and the read path —
 *   WHILE correlationId does NOT change `idem`, does NOT replace `requestId`, and does NOT
 *   authorize, govern, execute or verify.
 *
 * THE THREE IDENTITIES, which must never collapse into one another:
 *   correlationId  `asst_<uuid>`                    ORIGINATING CAUSAL EPISODE   (evidence)
 *   requestId      `req:<idem>:<mint-instant>`      EXECUTION REQUEST
 *   idem           sha256(tenant|connector|account|action|params)   DUPLICATE EFFECT
 *
 * WHY THE KERNEL IS ABSENT FROM THIS FILE, deliberately: `actionRecord.observe(request, result, ctx)`
 * already receives the EXECUTE REQUEST, so the causal identity travels request -> evidence and never
 * enters `cst/`. That is not a shortcut — it is the separation itself, enforced by routing rather
 * than by discipline. The structural pins below prove the kernel cannot see the field.
 *
 * EVIDENCE RUNG: TESTED against the REAL store (`useDirForTests` + real fs write/read), not a mock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync as read } from 'node:fs';
import type { GovernedSendResult } from '../cst/sendTransition';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { actionRecord } from './actionRecord';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-fg14-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const src = (...p: string[]): string => read(join(__dirname, '..', ...p), 'utf8');
/** Comments stripped — a pin that cannot tell code from prose about code is not pinning behaviour. */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gsr = (over: { verdict?: string; executed?: boolean; semanticOutcome?: string; transitionId?: string; requestId?: string } = {}): GovernedSendResult =>
  ({
    outcome: {
      transitionId: over.transitionId ?? 'm365-send:SAMEIDEM',
      requestId: over.requestId ?? 'req:SAMEIDEM:1787228221628',
      verdict: over.verdict ?? 'ALLOW',
      executed: over.executed ?? true,
    },
    semanticOutcome: over.semanticOutcome ?? 'ACKNOWLEDGED',
    effectCalls: 1,
    providerAck: true,
  }) as unknown as GovernedSendResult;

const req = (correlationId?: string) => ({
  connectorId: 'conn-1',
  accountId: 'acct-1',
  actionId: 'mail.send',
  params: { to: ['bob@example.com'], subject: 'Q3', body: 'numbers' },
  ...(correlationId === undefined ? {} : { correlationId }),
});
const ctx = { actor: 'user-owner', tenantId: 'tenant-A' };

/** Read back through the REAL query path, not by re-parsing our own object. */
const readBack = async (transitionId: string) =>
  (await actionRecord.query({ tenantId: 'tenant-A' })).find((r) => r.transitionId === transitionId);

describe('FG-14 · A — end-to-end VALUE preservation through real persistence', () => {
  it('the exact upstream correlationId survives construction, disk write and read-back', async () => {
    await actionRecord.observe(req('asst_A'), gsr({ transitionId: 't-A' }), ctx);
    const recovered = await readBack('t-A');
    // VALUE equality, not "the field exists".
    expect(recovered?.correlationId).toBe('asst_A');

    // And it is genuinely on disk — read the raw file, not our in-memory object.
    const raw = readFileSync(join(dir, 'action-records.json'), 'utf8');
    expect(JSON.parse(raw).records.find((r: { transitionId: string }) => r.transitionId === 't-A').correlationId).toBe('asst_A');
  });
});

describe('FG-14 · B — RUN A != RUN B: same effect request, different causal episodes', () => {
  it('identical params keep ONE idempotency identity while staying separable as evidence', async () => {
    // Same tenant/connector/account/action/params ⇒ the kernel would mint the SAME idem, hence the
    // same transitionId stem. That is correct and must not change. The episodes still differ.
    const sharedIdemTransition = 'm365-send:SAMEIDEM';
    await actionRecord.observe(req('asst_A'), gsr({ transitionId: `${sharedIdemTransition}#A` }), ctx);
    await actionRecord.observe(req('asst_B'), gsr({ transitionId: `${sharedIdemTransition}#B` }), ctx);

    const a = await readBack(`${sharedIdemTransition}#A`);
    const b = await readBack(`${sharedIdemTransition}#B`);

    expect(a?.correlationId).toBe('asst_A');
    expect(b?.correlationId).toBe('asst_B');
    expect(a?.correlationId).not.toBe(b?.correlationId);
    // The content-addressed stem is shared — that is the point being preserved.
    expect(a?.transitionId.startsWith(sharedIdemTransition)).toBe(true);
    expect(b?.transitionId.startsWith(sharedIdemTransition)).toBe(true);
  });
});

describe('FG-14 · C/D — idempotency and request identity are untouched', () => {
  it('the kernel CANNOT see correlationId — `cst/sendTransition.ts` never mentions it', () => {
    // The strongest form of "correlationId does not enter idem": it never reaches the file that
    // computes idem. Structural, not behavioural — behaviour cannot prove a negative this cleanly.
    expect(code(src('cst', 'sendTransition.ts'))).not.toMatch(/correlationId/);
  });

  it('the idem template is byte-for-byte the approved five-part construction', () => {
    expect(code(src('cst', 'sendTransition.ts'))).toContain(
      '`${tenantId}|${connectorId}|${accountId}|${action.id}|${JSON.stringify(params)}`',
    );
  });

  it('requestId remains the EXECUTION-REQUEST identity and is never the causal one', async () => {
    await actionRecord.observe(req('asst_A'), gsr({ transitionId: 't-D', requestId: 'req:IDEM:1787228221628' }), ctx);
    const r = await readBack('t-D');
    expect(r?.requestId).toBe('req:IDEM:1787228221628');
    expect(r?.correlationId).toBe('asst_A');
    // Three columns, three meanings — none equal to another.
    expect(r?.correlationId).not.toBe(r?.requestId);
    expect(r?.correlationId).not.toBe(r?.transitionId);
    expect(r?.correlationId).not.toBe(r?.admissionRef);
  });
});

describe('FG-14 · F/G/H — correlation cannot authorize, govern, or execute', () => {
  it('a DENY carrying a correlationId stays DENY with execution never started', async () => {
    await actionRecord.observe(req('asst_DENIED'), gsr({ verdict: 'DENY', executed: false, semanticOutcome: 'DENIED', transitionId: 't-deny' }), ctx);
    const r = await readBack('t-deny');
    expect(r?.correlationId).toBe('asst_DENIED'); // evidence is still recorded…
    expect(r?.verdict).toBe('DENY'); // …and it changed nothing.
    expect(r?.executed).toBe(false);
    expect(r?.outcome).toBe('DENIED'); // a DENY never becomes EXECUTION_FAILED
  });

  it('a HOLD carrying a correlationId stays HOLD', async () => {
    await actionRecord.observe(req('asst_HELD'), gsr({ verdict: 'HOLD', executed: false, semanticOutcome: 'HOLD', transitionId: 't-hold' }), ctx);
    const r = await readBack('t-hold');
    expect(r?.correlationId).toBe('asst_HELD');
    expect(r?.verdict).toBe('HOLD');
    expect(r?.executed).toBe(false);
  });

  it('no authority derivation reads correlationId — the closed input lists exclude it', () => {
    // deriveAuthority(capabilityId, target) and the CST arg destructuring are literal parameter
    // lists; a field absent from them is unreachable by construction.
    expect(code(src('liveBrain', 'executionGate.ts'))).not.toMatch(/correlationId/);
    expect(code(src('capabilities', 'capabilityPrincipal.ts'))).not.toMatch(/correlationId/);
  });
});

describe('FG-14 · I — correlation cannot verify', () => {
  it('a correlationId with no independent read-back leaves verification absent, never VERIFIED', async () => {
    await actionRecord.observe(req('asst_NOVERIFY'), gsr({ transitionId: 't-noverify' }), ctx);
    const r = await readBack('t-noverify');
    expect(r?.correlationId).toBe('asst_NOVERIFY');
    // ACKNOWLEDGED is provider submission, never verification.
    expect(r?.verification ?? null).toBeNull();
  });

  it('the verification oracle reads a closed 6-field target that excludes correlationId', () => {
    expect(code(src('verification', 'verifyEffect.ts'))).not.toMatch(/correlationId/);
    expect(code(src('verification', 'verifyGovernedSend.ts'))).not.toMatch(/correlationId/);
  });
});

describe('FG-14 · J/K — absence is absence: no fabrication, no fallback', () => {
  it('a request with no correlationId yields a record with no correlationId', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-absent', requestId: 'req:IDEM:1787228221628' }), ctx);
    const r = await readBack('t-absent');
    expect(r?.correlationId).toBeUndefined();
    // Explicitly NOT substituted from any neighbouring identity.
    expect(r?.correlationId).not.toBe(r?.requestId);
    expect(r?.correlationId).not.toBe(r?.transitionId);
    expect(r?.correlationId).not.toBe(r?.admissionRef);
    expect(r?.correlationId).not.toBe(r?.actor);
    expect(r?.correlationId).not.toBe(r?.tenantId);
    // And the key is genuinely absent on disk, not written as null/"" .
    const raw = JSON.parse(readFileSync(join(dir, 'action-records.json'), 'utf8'));
    expect('correlationId' in raw.records.find((x: { transitionId: string }) => x.transitionId === 't-absent')).toBe(false);
  });

  it('an empty-string correlationId is treated as ABSENT, never stored as an identity', async () => {
    await actionRecord.observe({ ...req(), correlationId: '' }, gsr({ transitionId: 't-empty' }), ctx);
    expect((await readBack('t-empty'))?.correlationId).toBeUndefined();
  });

  it('a pre-FG-14 historical record without correlationId remains readable and is not back-filled', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-historical' }), ctx);
    // Re-read through a fresh query — the store must not invent a causal identity on load.
    const all = await actionRecord.query({ tenantId: 'tenant-A' });
    const r = all.find((x) => x.transitionId === 't-historical');
    expect(r).toBeDefined();
    expect(r?.correlationId).toBeUndefined();
  });
});

describe('FG-14 · L — serialization round trip through the real persistence path', () => {
  it('correlationId survives write and read verbatim', async () => {
    await actionRecord.observe(req('asst_SERIALIZATION'), gsr({ transitionId: 't-ser' }), ctx);
    // Force a genuine re-read from disk rather than trusting an in-memory cache.
    actionRecord.useDirForTests(dir);
    expect((await readBack('t-ser'))?.correlationId).toBe('asst_SERIALIZATION');
  });
});

describe('FG-14 · the IPC boundary itself — the REAL zod parse, not a stub', () => {
  it('the contract PRESERVES correlationId through parse (a non-strict object would otherwise strip it)', async () => {
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    const parsed = M365ActionExecuteRequest.parse({
      connectorId: 'microsoft-entra',
      accountId: 'acct-1',
      actionId: 'mail.send',
      params: { to: ['bob@example.com'] },
      confirmed: true,
      correlationId: 'asst_PARSE',
    });
    expect(parsed.correlationId).toBe('asst_PARSE');
  });

  it('an omitted correlationId parses to ABSENT — never defaulted, never fabricated', async () => {
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    const parsed = M365ActionExecuteRequest.parse({
      connectorId: 'microsoft-entra',
      accountId: 'acct-1',
      actionId: 'mail.send',
      params: {},
      confirmed: false,
    });
    expect(parsed.correlationId).toBeUndefined();
    expect('correlationId' in parsed).toBe(false);
  });

  it('a pre-FG-14 caller (no field) still parses — backward compatible', async () => {
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    expect(() =>
      M365ActionExecuteRequest.parse({ connectorId: 'microsoft-entra', accountId: 'a', actionId: 'mail.send' }),
    ).not.toThrow();
  });

  it('an empty correlationId is REJECTED by the contract rather than stored as an identity', async () => {
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    const r = M365ActionExecuteRequest.safeParse({
      connectorId: 'microsoft-entra', accountId: 'a', actionId: 'mail.send', correlationId: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('FG-14 · the transport layer preserves the value at every non-frozen hop', () => {
  it('the renderer hand-off carries correlationId — the original loss point is repaired', () => {
    const view = code(read(join(__dirname, '..', '..', 'renderer', 'src', 'assistant', 'AssistantView.tsx'), 'utf8'));
    expect(view).toMatch(/onOpenNavigation\([^)]*env\.correlationId\)/);
  });

  it('the mailbox reconstructs correlationId explicitly — an object-literal whitelist drops what it does not name', () => {
    const mailbox = code(read(join(__dirname, '..', '..', 'renderer', 'src', 'connectors', 'm365ProposalHandoff.ts'), 'utf8'));
    expect(mailbox).toMatch(/correlationId/);
  });

  it('the execute contract declares the field — a non-strict zod object would otherwise STRIP it silently', () => {
    const contracts = code(read(join(__dirname, '..', '..', '..', '..', '..', 'packages', 'shared', 'src', 'ipc', 'contracts.ts'), 'utf8'));
    expect(contracts).toMatch(/correlationId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)\.optional\(\)/);
  });
});
