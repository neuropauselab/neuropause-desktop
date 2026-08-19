/**
 * S5.4 Phase 0 — the DE-GATED read-back orchestrator. Proves it is a faithful, READ-ONLY driver of the pure oracle:
 * a corroborating Sent Items row ⇒ VERIFIED_SUCCESS; a bounce/NDR ⇒ VERIFY_FAILED; nothing observed ⇒ HOLD (never
 * auto-promoted). The reader is injected — this module performs no I/O and holds no identity/latch/env of its own.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  verifyGovernedSend,
  buildVerificationTarget,
  type GovernedSendRef,
  type ReadBackReader,
} from './verifyGovernedSend';
import type { SentItem, InboxItem } from './verifyEffect';

const SENT_AT = Date.parse('2026-08-19T12:00:00Z');
const ref: GovernedSendRef = {
  recipient: 'neuropause033@gmail.com',
  subject: 'NeuroPause read-back proof',
  body: 'The demo is Friday.',
  sentAtMs: SENT_AT,
};

const clock = { now: () => SENT_AT + 1000, sleep: () => Promise.resolve() };

function reader(sent: readonly SentItem[], inbox: readonly InboxItem[] = []): ReadBackReader {
  return {
    readSentItems: vi.fn(async () => sent),
    readInbox: vi.fn(async () => inbox),
  };
}

const corroboratingSentRow: SentItem = {
  internetMessageId: '<abc@PROD.OUTLOOK.COM>',
  toRecipients: ['neuropause033@gmail.com'],
  subject: 'NeuroPause read-back proof',
  bodyPreview: 'The demo is Friday.',
  sentDateTime: '2026-08-19T12:00:03Z',
};

describe('S5.4 Phase 0 — verifyGovernedSend (READ-ONLY orchestration)', () => {
  it('builds a corroboration target: id null by default, subject/body fingerprinted, symmetric window', () => {
    const t = buildVerificationTarget(ref);
    expect(t.internetMessageId).toBeNull();
    expect(t.recipient).toBe('neuropause033@gmail.com');
    expect(t.subjectFingerprint).toBe('neuropause read-back proof');
    expect(t.bodyFingerprint).toBe('the demo is friday.');
    expect(t.sentAtWindow.fromMs).toBe(SENT_AT - 10 * 60_000);
    expect(t.sentAtWindow.toMs).toBe(SENT_AT + 10 * 60_000);
  });

  it('VERIFIED_SUCCESS — a corroborating Sent Items row (recipient + subject + timestamp)', async () => {
    const r = await verifyGovernedSend(ref, reader([corroboratingSentRow]), clock, { backoffMs: [0] });
    expect(r.state).toBe('VERIFIED_SUCCESS');
    expect(r.matchedMessageId).toBe('<abc@PROD.OUTLOOK.COM>');
    expect(r.bounceReason).toBeNull();
  });

  it('VERIFY_FAILED — a bounce/NDR referencing our recipient is a definitive negative', async () => {
    const ndr: InboxItem = {
      from: 'postmaster@outlook.com',
      subject: 'Undeliverable: NeuroPause read-back proof',
      bodyPreview: 'Delivery has failed 5.1.1 to neuropause033@gmail.com',
      receivedDateTime: '2026-08-19T12:00:05Z',
    };
    const r = await verifyGovernedSend(ref, reader([], [ndr]), clock, { backoffMs: [0] });
    expect(r.state).toBe('VERIFY_FAILED');
    expect(r.bounceReason).toContain('5.1.1');
  });

  it('HOLD — nothing observed after the bounded backoff is UNKNOWN, never auto-promoted to SUCCESS', async () => {
    const r = await verifyGovernedSend(ref, reader([], []), clock, { backoffMs: [0, 0] });
    expect(r.state).toBe('HOLD');
    expect(r.matchedMessageId).toBeNull();
    expect(r.state).not.toBe('VERIFIED_SUCCESS');
  });

  it('READ-ONLY — it drives only the reader; it exposes no send/mutate path', async () => {
    const rd = reader([corroboratingSentRow]);
    await verifyGovernedSend(ref, rd, clock, { backoffMs: [0] });
    expect(rd.readSentItems).toHaveBeenCalled();
    // The surface of this module is exactly two readers + a clock — nothing that could emit an external effect.
    expect(Object.keys(rd)).toEqual(['readSentItems', 'readInbox']);
  });

  it('idempotent — a prior TERMINAL is returned without re-reading', async () => {
    const rd = reader([]);
    const prior = { state: 'VERIFIED_SUCCESS' as const, matchedMessageId: '<x@y>', bounceReason: null, attempts: 1, detail: 'prior' };
    const r = await verifyGovernedSend(ref, rd, clock, { prior });
    expect(r).toBe(prior);
    expect(rd.readSentItems).not.toHaveBeenCalled();
  });
});
