/**
 * Slice-16 — the read-back oracle, mock-proven with fault injection. The safety spine: uncertainty is never success;
 * a corroborated match (never id alone) is required for VERIFIED_SUCCESS; a HOLD (UNRESOLVED) never auto-promotes.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  verifyEffect,
  matchesTuple,
  bounceReason,
  fingerprint,
  type VerificationTarget,
  type SentItem,
  type InboxItem,
  type VerifyDeps,
} from './verifyEffect';

const NOW = 1_000_000;
const TARGET: VerificationTarget = {
  internetMessageId: '<msg-123@np>',
  recipient: 'neuropause033@gmail.com',
  subjectFingerprint: fingerprint('NeuroPause S15 first real send, 18 Aug 2026'),
  bodyFingerprint: fingerprint('the demo is friday'),
  sentAtWindow: { fromMs: NOW - 60_000, toMs: NOW + 60_000 },
};

const MATCHING_SENT: SentItem = {
  internetMessageId: '<msg-123@np>',
  toRecipients: ['neuropause033@gmail.com'],
  subject: 'NeuroPause S15 first real send, 18 Aug 2026',
  bodyPreview: 'the demo is Friday — sent by NeuroPause',
  sentDateTime: new Date(NOW).toISOString(),
};

const BOUNCE: InboxItem = {
  from: 'postmaster@outlook.com',
  subject: 'Undeliverable: NeuroPause S15 first real send',
  bodyPreview: "Your message to neuropause033@gmail.com couldn't be delivered. 5.1.1 user unknown",
  receivedDateTime: new Date(NOW + 5000).toISOString(),
};

function deps(over: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    readSentItems: () => Promise.resolve([]),
    readInbox: () => Promise.resolve([]),
    now: () => NOW,
    sleep: () => Promise.resolve(),
    backoffMs: [0, 0, 0], // three fast attempts
    ...over,
  };
}

describe('matchesTuple — corroboration, never id alone', () => {
  it('matches when recipient + subject + timestamp (+ id) all agree', () => {
    expect(matchesTuple(MATCHING_SENT, TARGET)).toBe(true);
  });
  it('does NOT match on id alone — wrong recipient is rejected even with the right id', () => {
    expect(matchesTuple({ ...MATCHING_SENT, toRecipients: ['someone-else@x.com'] }, TARGET)).toBe(false);
  });
  it('does NOT match on id alone — wrong subject is rejected even with the right id', () => {
    expect(matchesTuple({ ...MATCHING_SENT, subject: 'a totally different subject' }, TARGET)).toBe(false);
  });
  it('does NOT match outside the timestamp window', () => {
    expect(matchesTuple({ ...MATCHING_SENT, sentDateTime: new Date(NOW + 10 * 60_000).toISOString() }, TARGET)).toBe(false);
  });
  it('rejects a mismatched id when the target has one', () => {
    expect(matchesTuple({ ...MATCHING_SENT, internetMessageId: '<other@np>' }, TARGET)).toBe(false);
  });
  it('when the target has NO id, corroborates on the other three (the 202-no-id case)', () => {
    expect(matchesTuple({ ...MATCHING_SENT, internetMessageId: null }, { ...TARGET, internetMessageId: null })).toBe(true);
  });
  it('rejects more than one recipient', () => {
    expect(matchesTuple({ ...MATCHING_SENT, toRecipients: ['neuropause033@gmail.com', 'x@y.com'] }, TARGET)).toBe(false);
  });
});

describe('bounceReason — NDR detection', () => {
  it('detects a postmaster NDR referencing our recipient and extracts the code', () => {
    expect(bounceReason(BOUNCE, TARGET)).toMatch(/5\.1\.1/);
  });
  it('ignores an NDR that does not reference our recipient', () => {
    expect(bounceReason({ ...BOUNCE, bodyPreview: 'undeliverable to somebody-else@x.com 5.1.1' }, TARGET)).toBeNull();
  });
  it('ignores an ordinary inbox message', () => {
    expect(bounceReason({ from: 'a@b.com', subject: 'hi', bodyPreview: 'hello', receivedDateTime: new Date(NOW).toISOString() }, TARGET)).toBeNull();
  });
});

describe('verifyEffect — state machine', () => {
  it('VERIFIED_SUCCESS when the corroborated message is in Sent Items', async () => {
    const r = await verifyEffect(TARGET, deps({ readSentItems: () => Promise.resolve([MATCHING_SENT]) }));
    expect(r.state).toBe('VERIFIED_SUCCESS');
    expect(r.matchedMessageId).toBe('<msg-123@np>');
  });

  it('VERIFY_FAILED when a bounce/NDR is observed (checked before success)', async () => {
    const r = await verifyEffect(TARGET, deps({ readInbox: () => Promise.resolve([BOUNCE]), readSentItems: () => Promise.resolve([MATCHING_SENT]) }));
    expect(r.state).toBe('VERIFY_FAILED');
    expect(r.bounceReason).toMatch(/5\.1\.1/);
  });

  it('UNKNOWN → HOLD when nothing is observed after bounded backoff (never auto-promoted)', async () => {
    const r = await verifyEffect(TARGET, deps()); // empty sent + inbox
    expect(r.state).toBe('HOLD');
    expect(r.matchedMessageId).toBeNull();
    expect(r.detail).toMatch(/never auto-promoted/i);
  });

  it('bounded backoff: exhausts the schedule then HOLDs (attempts = schedule length)', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const r = await verifyEffect(TARGET, deps({ backoffMs: [0, 10, 20], sleep }));
    expect(r.state).toBe('HOLD');
    expect(r.attempts).toBe(3);
  });

  it('idempotent: a prior TERMINAL outcome is returned without re-reading (no effect re-run, truth not flipped)', async () => {
    const readSentItems = vi.fn(() => Promise.resolve([MATCHING_SENT]));
    const prior = { state: 'VERIFIED_SUCCESS' as const, matchedMessageId: '<msg-123@np>', bounceReason: null, attempts: 1, detail: 'x' };
    const r = await verifyEffect(TARGET, deps({ readSentItems }), prior);
    expect(r).toBe(prior);
    expect(readSentItems).not.toHaveBeenCalled();
  });
});

describe('verifyEffect — fault injection: dropped execute response → UNKNOWN → HOLD → resolves later', () => {
  it('a HOLD is re-attempted, and once the message appears the oracle resolves VERIFIED_SUCCESS', async () => {
    // First pass: the send response was dropped; Sent Items not yet visible → HOLD.
    const hold = await verifyEffect(TARGET, deps());
    expect(hold.state).toBe('HOLD');
    // Later pass (prior=HOLD, non-terminal): the message is now visible → resolve the hold truthfully.
    const resolved = await verifyEffect(TARGET, deps({ readSentItems: () => Promise.resolve([MATCHING_SENT]) }), hold);
    expect(resolved.state).toBe('VERIFIED_SUCCESS');
  });

  it('a HOLD that later reveals a bounce resolves to VERIFY_FAILED (never a false success)', async () => {
    const hold = await verifyEffect(TARGET, deps());
    const resolved = await verifyEffect(TARGET, deps({ readInbox: () => Promise.resolve([BOUNCE]) }), hold);
    expect(resolved.state).toBe('VERIFY_FAILED');
  });
});
