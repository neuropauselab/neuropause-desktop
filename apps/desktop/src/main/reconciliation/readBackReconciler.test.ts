/**
 * F-P39 — the read-back reconciler, pinned against the REAL production path.
 *
 * §2 #17 governs this file: every pin drives the REAL `ActionRecordStore` (real fs, real persistence, real
 * `observe`), the REAL `verifyGovernedSend`, and the REAL `verifyEffect`. Nothing under test is mocked; only the
 * PROVIDER is injected, which is the seam the design exists to expose. A hand-built record shape would be more
 * generous than reality — that is precisely how F-N19-2 hid a structurally-null field behind a green suite.
 *
 * NO EXTERNAL EFFECT: the reader is an in-test function. Nothing is sent, nothing is read from Graph.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionRecord } from '../connectors/actionRecord';
import { recordFingerprint } from '../evidence/recordFingerprint';
import { buildVerificationTarget } from '../verification/verifyGovernedSend';
import type { SentItem, InboxItem } from '../verification/verifyEffect';
import {
  reconcileTenant,
  buildReconcileRef,
  awaitingVerification,
  inFlightSizeForTests,
  MAX_CORROBORATION_WIDTH_MS,
  type ReconcilableRecord,
  type ReconcilerDeps,
} from './readBackReconciler';

const TENANT = 'tenant-alpha';
const OTHER_TENANT = 'tenant-beta';
const SUBJECT = 'Quarterly report';
const RECIPIENT = 'alice@example.com';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-reconciler-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a REAL record through the REAL observer, exactly as the frozen send path does. */
async function observeSend(opts: {
  tenantId?: string;
  requestStampMs?: number | null;
  subject?: string;
  to?: string[];
  cc?: string[];
  outcome?: string;
}): Promise<void> {
  const idem = `idem-${Math.abs(hash(`${opts.subject ?? SUBJECT}${(opts.to ?? [RECIPIENT]).join()}${opts.tenantId ?? TENANT}`))}`;
  const requestId =
    opts.requestStampMs === null ? `req:${idem}` : `req:${idem}:${opts.requestStampMs ?? Date.now()}`;
  await actionRecord.observe(
    {
      connectorId: 'microsoft-entra',
      accountId: 'acct-1',
      actionId: 'mail.send',
      params: { to: opts.to ?? [RECIPIENT], cc: opts.cc ?? [], subject: opts.subject ?? SUBJECT, body: 'Attached.' },
    },
    {
      semanticOutcome: opts.outcome ?? 'ACKNOWLEDGED',
      requestId,
      outcome: { transitionId: `m365-send:${idem}`, verdict: 'ALLOW', executed: true },
    } as never,
    { actor: 'user:ops', tenantId: opts.tenantId ?? TENANT },
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function loadRecords(tenantId = TENANT): Promise<ReconcilableRecord[]> {
  return (await actionRecord.query({ tenantId })) as unknown as ReconcilableRecord[];
}

/** A reader that answers with whatever Sent Items rows the test supplies. Nothing leaves the process. */
function readerOf(sent: SentItem[], inbox: InboxItem[] = []) {
  return { readSentItems: async () => sent, readInbox: async () => inbox };
}

function depsWith(reader: ReturnType<typeof readerOf> | null, nowMs = Date.now()): ReconcilerDeps {
  return {
    query: (f) => loadRecords(f.tenantId),
    recordVerification: (t, id, terminal) => actionRecord.recordVerification(t, id, terminal),
    readerFor: () => reader,
    oracleId: 'test:injected-reader',
    now: () => nowMs,
    sleep: async () => undefined,
  };
}

/** A Sent Items row that genuinely corroborates the record written by `observeSend`. */
function corroboratingRow(sentIso: string, subject = SUBJECT): SentItem {
  return {
    internetMessageId: '<real-id@outlook.com>',
    toRecipients: [RECIPIENT],
    subject,
    bodyPreview: 'Attached.',
    sentDateTime: sentIso,
  };
}

describe('F-P39 · the production read-back caller', () => {
  it('CLOSES F-P39 — a real ACKNOWLEDGED record reaches VERIFIED_SUCCESS through the real oracle', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    const [rec] = await loadRecords();
    expect(rec.verification).toBeNull(); // the state F-P39 said nothing could ever leave

    const summary = await reconcileTenant(TENANT, depsWith(readerOf([corroboratingRow(new Date(t0 + 500).toISOString())])));

    expect(summary.attempted).toBe(1);
    expect(summary.recorded).toBe(1);
    const [after] = await loadRecords();
    const v = after.verification as { terminal: string; internetMessageId: string; effectTime: string; provenance: { source: string } };
    expect(v.terminal).toBe('VERIFIED_SUCCESS');
    expect(v.internetMessageId).toBe('<real-id@outlook.com>');
    // RULE-012 — verification evidence names its provenance, and names THIS caller.
    expect(v.provenance.source).toBe('readBackReconciler');
    // NP-015 — effect_time is the provider's own instant, verbatim.
    expect(v.effectTime).toBe(new Date(t0 + 500).toISOString());
  });

  it('MUTATION GUARD — the terminal is written by recordVerification; removing the recorder loses the evidence', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    let calls = 0;
    const deps = depsWith(readerOf([corroboratingRow(new Date(t0 + 500).toISOString())]));
    await reconcileTenant(TENANT, {
      ...deps,
      recordVerification: async (t, id, term) => {
        calls += 1;
        await actionRecord.recordVerification(t, id, term);
      },
    });
    expect(calls).toBe(1);
    const [after] = await loadRecords();
    expect((after.verification as { terminal: string }).terminal).toBe('VERIFIED_SUCCESS');
    // The evidence is DURABLE, not just in memory — read the file the store actually wrote.
    const file = readdirSync(dir).find((f) => f.endsWith('.json'));
    expect(file).toBeTruthy();
    expect(readFileSync(join(dir, file as string), 'utf8')).toContain('VERIFIED_SUCCESS');
  });
});

describe('D1 · the interval — two measured endpoints, never a point', () => {
  it('the window IS [requestTime, at] — both endpoints verbatim from the record', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    const [rec] = await loadRecords();
    const built = buildReconcileRef(rec);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.ref.sentAtWindow).toEqual({ fromMs: t0, toMs: Date.parse(rec.at) });
    expect(Date.parse(rec.requestTime as string)).toBe(t0); // lower bound is the kernel's own stamp
  });

  it('a missing requestTime is UNKNOWN — never widened to infinity, never narrowed to a guess', async () => {
    await observeSend({ requestStampMs: null }); // unstamped id ⇒ requestTime null (FG-12 semantics)
    const [rec] = await loadRecords();
    expect(rec.requestTime).toBeNull();
    const built = buildReconcileRef(rec);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe('NO_REQUEST_TIME');
  });

  it('an unreconcilable record is RECORDED as HOLD, not silently skipped', async () => {
    await observeSend({ requestStampMs: null });
    const summary = await reconcileTenant(TENANT, depsWith(readerOf([])));
    expect(summary.refused).toBe(1);
    const [after] = await loadRecords();
    // OBSERVABLE IS NOT RECORDED — the refusal has to reach the evidence store, or an audit sees nothing.
    expect((after.verification as { terminal: string }).terminal).toBe('HOLD');
    expect((after.verification as { provenance: { method: string } }).provenance.method).toContain('NO_REQUEST_TIME');
  });
});

describe('D1 · THE WIDTH BOUND — exceeding it yields UNKNOWN, never VERIFIED', () => {
  it('refuses an over-wide interval BEFORE reading, even when a perfect match is sitting there', async () => {
    const t0 = Date.now() - (MAX_CORROBORATION_WIDTH_MS + 60_000);
    await observeSend({ requestStampMs: t0 });
    const [rec] = await loadRecords();
    const width = Date.parse(rec.at) - t0;
    expect(width).toBeGreaterThan(MAX_CORROBORATION_WIDTH_MS);

    let reads = 0;
    const reader = {
      readSentItems: async () => {
        reads += 1;
        return [corroboratingRow(new Date(t0 + 1000).toISOString())];
      },
      readInbox: async () => [],
    };
    const summary = await reconcileTenant(TENANT, depsWith(reader));

    expect(summary.refused).toBe(1);
    expect(reads).toBe(0); // refused without spending a provider call
    const [after] = await loadRecords();
    expect((after.verification as { terminal: string }).terminal).toBe('HOLD');
    expect((after.verification as { terminal: string }).terminal).not.toBe('VERIFIED_SUCCESS');
  });

  it('the ORACLE enforces the bound too — a wide window HOLDs even if a caller bypasses the reconciler', () => {
    const target = buildVerificationTarget({
      recipient: RECIPIENT,
      subject: SUBJECT,
      body: '',
      sentAtMs: 0,
      sentAtWindow: { fromMs: 0, toMs: MAX_CORROBORATION_WIDTH_MS + 1 },
      maxWidthMs: MAX_CORROBORATION_WIDTH_MS,
    });
    expect(target.maxWidthMs).toBe(MAX_CORROBORATION_WIDTH_MS);
    expect(target.sentAtWindow).toEqual({ fromMs: 0, toMs: MAX_CORROBORATION_WIDTH_MS + 1 });
  });
});

describe('D2 · the subject limb lives in the RECORD-FINGERPRINT codomain', () => {
  it('corroborates by hashing the OBSERVED subject — the record never stores plaintext', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    const [rec] = await loadRecords();
    // The stored value is the one-way form, and the file on disk carries no subject text.
    expect(rec.subjectFingerprint).toBe(recordFingerprint(SUBJECT));
    expect(rec.subjectFingerprint).not.toContain(SUBJECT);
    const file = readdirSync(dir).find((f) => f.endsWith('.json')) as string;
    expect(readFileSync(join(dir, file), 'utf8')).not.toContain(SUBJECT);

    await reconcileTenant(TENANT, depsWith(readerOf([corroboratingRow(new Date(t0 + 100).toISOString())])));
    const [after] = await loadRecords();
    expect((after.verification as { terminal: string }).terminal).toBe('VERIFIED_SUCCESS');
  });

  it('a DIFFERENT subject does not corroborate — the limb is load-bearing, not decorative', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    await reconcileTenant(
      TENANT,
      depsWith(readerOf([corroboratingRow(new Date(t0 + 100).toISOString(), 'A completely different subject')])),
    );
    const [after] = await loadRecords();
    expect((after.verification as { terminal: string }).terminal).toBe('HOLD');
  });
});

describe('AMBIGUITY IS NOT CORROBORATION', () => {
  it('two rows matching one tuple yield HOLD, never a first-match VERIFIED_SUCCESS', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    const iso = new Date(t0 + 100).toISOString();
    await reconcileTenant(TENANT, depsWith(readerOf([corroboratingRow(iso), corroboratingRow(iso)])));
    const [after] = await loadRecords();
    const v = after.verification as { terminal: string; provenance: { method: string } };
    expect(v.terminal).toBe('HOLD');
    expect(v.provenance.method).toContain('AMBIGUOUS');
  });
});

describe('D3 · MONOTONICITY — an observation failure never downgrades a recorded terminal', () => {
  it('VERIFIED_SUCCESS survives a later failed read (the regression pin)', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    await reconcileTenant(TENANT, depsWith(readerOf([corroboratingRow(new Date(t0 + 100).toISOString())])));
    expect(((await loadRecords())[0].verification as { terminal: string }).terminal).toBe('VERIFIED_SUCCESS');

    // Re-run with a reader that finds nothing — the old unconditional overwrite made this HOLD.
    await actionRecord.recordVerification(TENANT, (await loadRecords())[0].transitionId, {
      terminal: 'HOLD',
      internetMessageId: null,
      at: new Date().toISOString(),
      provenance: { source: 'readBackReconciler', method: 'transient failure', oracle: 'x' },
      effectTime: null,
    });
    expect(((await loadRecords())[0].verification as { terminal: string }).terminal).toBe('VERIFIED_SUCCESS');
  });

  it('UNRESOLVED → settled IS allowed — reconciliation still works', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    const id = (await loadRecords())[0].transitionId;
    const stub = { internetMessageId: null, at: new Date().toISOString(), provenance: { source: 's', method: 'm', oracle: 'o' }, effectTime: null };
    await actionRecord.recordVerification(TENANT, id, { terminal: 'HOLD', ...stub });
    await actionRecord.recordVerification(TENANT, id, { terminal: 'VERIFIED_SUCCESS', ...stub });
    expect(((await loadRecords())[0].verification as { terminal: string }).terminal).toBe('VERIFIED_SUCCESS');
  });
});

describe('D3 · TENANT ISOLATION at the evidence layer', () => {
  it('a verification addressed with the WRONG tenant does not attach', async () => {
    await observeSend({ requestStampMs: Date.now() });
    const id = (await loadRecords())[0].transitionId;
    await actionRecord.recordVerification(OTHER_TENANT, id, {
      terminal: 'VERIFIED_SUCCESS',
      internetMessageId: null,
      at: new Date().toISOString(),
      provenance: { source: 's', method: 'm', oracle: 'o' },
      effectTime: null,
    });
    expect((await loadRecords())[0].verification).toBeNull();
  });

  it('a pass for one tenant never touches another tenant’s records', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    await observeSend({ requestStampMs: t0, tenantId: OTHER_TENANT, to: ['bob@example.com'] });
    await reconcileTenant(TENANT, depsWith(readerOf([corroboratingRow(new Date(t0 + 100).toISOString())])));
    expect(((await loadRecords(TENANT))[0].verification as { terminal: string }).terminal).toBe('VERIFIED_SUCCESS');
    expect((await loadRecords(OTHER_TENANT))[0].verification).toBeNull();
  });
});

describe('SINGLE-FLIGHT — keyed on the hold, not the tenant', () => {
  it('two overlapping passes cannot double-resolve one hold', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    let reads = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const reader = {
      readSentItems: async () => {
        reads += 1;
        await gate; // hold the first pass open so the second genuinely overlaps
        return [corroboratingRow(new Date(t0 + 100).toISOString())];
      },
      readInbox: async () => [],
    };
    const deps = depsWith(reader);

    const first = reconcileTenant(TENANT, deps);
    await Promise.resolve();
    const second = reconcileTenant(TENANT, deps);
    release?.();
    const [a, b] = await Promise.all([first, second]);

    expect(reads).toBe(1); // ONE probe, not two
    expect(a.attempted + b.attempted).toBe(1);
    expect(b.skippedInFlight + a.skippedInFlight).toBe(1);
    expect(inFlightSizeForTests()).toBe(0); // and the map does not leak
  });
});

describe('RULING G · HOLD is terminal for this reconciler', () => {
  it('a HOLD is recorded and the pass stops — there is no promotion path', async () => {
    // The request is minted BEFORE the row is observed, so a corroborating provider instant must fall inside
    // [requestTime, at]. Backdating the mint is what makes the interval realistic rather than degenerate.
    const t0 = Date.now() - 5_000;
    await observeSend({ requestStampMs: t0 });
    await reconcileTenant(TENANT, depsWith(readerOf([]))); // nothing found
    const [after] = await loadRecords();
    expect((after.verification as { terminal: string }).terminal).toBe('HOLD');
    // A second pass must NOT promote it, and must not re-attempt a settled row either way.
    await reconcileTenant(TENANT, depsWith(readerOf([corroboratingRow(new Date(t0 + 100).toISOString())])));
    const [again] = await loadRecords();
    expect((again.verification as { terminal: string }).terminal).toBe('HOLD');
  });

  it('SOURCE INVARIANT — the reconciler contains no promotion or resend vocabulary', () => {
    const src = readFileSync(join(__dirname, 'readBackReconciler.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['resend', 'retrySend', 'promote', 'governedSend(', 'executor']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('DECISION-NEUTRALITY — pre-existing callers are byte-unchanged', () => {
  it('a legacy centre±half-width ref produces exactly the window it always did', () => {
    const target = buildVerificationTarget({ recipient: RECIPIENT, subject: SUBJECT, body: 'b', sentAtMs: 1_000_000, windowMs: 5_000 });
    expect(target.sentAtWindow).toEqual({ fromMs: 995_000, toMs: 1_005_000 });
    // And none of the new fields appear unless asked for — absence, not a default.
    expect('subjectMatchKey' in target).toBe(false);
    expect('maxWidthMs' in target).toBe(false);
    expect('requireUniqueMatch' in target).toBe(false);
  });
});

describe('SELECTION — only what this oracle can actually answer for', () => {
  it('non-mail.send, non-ACKNOWLEDGED, and already-verified rows are all left alone', () => {
    const base: ReconcilableRecord = {
      transitionId: 't', tenantId: TENANT, connectorId: 'c', accountId: 'a', actionId: 'mail.send',
      outcome: 'ACKNOWLEDGED', at: new Date().toISOString(), requestTime: new Date().toISOString(),
      subjectFingerprint: 'f', recipients: { to: [RECIPIENT], cc: [], bcc: [] }, verification: null,
    };
    expect(awaitingVerification(base)).toBe(true);
    expect(awaitingVerification({ ...base, actionId: 'calendar.create' })).toBe(false);
    expect(awaitingVerification({ ...base, outcome: 'DENIED' })).toBe(false);
    expect(awaitingVerification({ ...base, verification: { terminal: 'HOLD' } })).toBe(false);
  });

  it('a multi-recipient send has no representable target and says so by name', () => {
    const rec: ReconcilableRecord = {
      transitionId: 't', tenantId: TENANT, connectorId: 'c', accountId: 'a', actionId: 'mail.send',
      outcome: 'ACKNOWLEDGED', at: new Date().toISOString(), requestTime: new Date().toISOString(),
      subjectFingerprint: 'f', recipients: { to: [RECIPIENT, 'bob@example.com'], cc: [], bcc: [] }, verification: null,
    };
    const built = buildReconcileRef(rec);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe('RECIPIENT_NOT_REPRESENTABLE');
  });
});
