/**
 * S5.4 Phase 0 — the mock-Graph read-back seam, proven to close THE CIRCLE over the REAL oracle at module level.
 *
 * For each harness knob we (1) let the mock record a governed send from a real Graph sendMail body, then (2) drive the
 * REAL `verifyGovernedSend`/`verifyEffect` through a reader that maps the mock's Sent Items / Inbox rows exactly as the
 * production `makeM365GraphReader` does — and assert the certified terminal. The mock never invents a success the
 * oracle would not corroborate: the 'success' knob makes Sent Items agree, 'bounce' makes the Inbox carry an NDR, and
 * 'hold' observes nothing (UNKNOWN → HOLD, never auto-promoted).
 */
import { describe, it, expect } from 'vitest';
import {
  createMockGraphState,
  mockGraphResponse,
  resolveVerifyOutcome,
  type MockGraphState,
  type MockVerifyOutcome,
} from './mockGraph';
import { verifyGovernedSend, type GovernedSendRef, type ReadBackReader } from '../verification/verifyGovernedSend';
import type { SentItem, InboxItem } from '../verification/verifyEffect';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SENT_AT = Date.parse('2026-08-19T12:00:00Z');

// The exact Graph body the certified mail.send path POSTs (see connectors/m365/mail.ts).
const sendBody = JSON.stringify({
  message: {
    subject: 'NeuroPause circle proof',
    body: { contentType: 'text', content: 'The demo is Friday.' },
    toRecipients: [{ emailAddress: { address: 'neuropause033@gmail.com' } }],
  },
  saveToSentItems: true,
});

// Faithful mirror of makeM365GraphReader's Graph→SentItem/InboxItem mapping — over the mock responses.
function readerFor(state: MockGraphState, outcome: MockVerifyOutcome, nowMs: number): ReadBackReader {
  const getValue = (url: string): Array<Record<string, unknown>> => {
    const res = mockGraphResponse(url, null, state, outcome, nowMs);
    if (!res) throw new Error(`mock did not answer ${url}`);
    return (JSON.parse(res.body) as { value?: Array<Record<string, unknown>> }).value ?? [];
  };
  const addr = (r: unknown): string =>
    (r as { emailAddress?: { address?: string } } | undefined)?.emailAddress?.address ?? '';
  return {
    readSentItems: async (): Promise<SentItem[]> =>
      getValue(`${GRAPH}/me/mailFolders/sentitems/messages?$top=25`).map((m) => ({
        internetMessageId: (m.internetMessageId as string) ?? null,
        toRecipients: ((m.toRecipients as unknown[]) ?? []).map(addr).filter(Boolean),
        subject: (m.subject as string) ?? '',
        bodyPreview: (m.bodyPreview as string) ?? '',
        sentDateTime: (m.sentDateTime as string) ?? '',
      })),
    readInbox: async (): Promise<InboxItem[]> =>
      getValue(`${GRAPH}/me/mailFolders/inbox/messages?$top=25`).map((m) => ({
        from: addr(m.from),
        subject: (m.subject as string) ?? '',
        bodyPreview: (m.bodyPreview as string) ?? '',
        receivedDateTime: (m.receivedDateTime as string) ?? '',
      })),
  };
}

function sendThen(outcome: MockVerifyOutcome) {
  const state = createMockGraphState();
  // (1) the mock records the governed send exactly as the executor would emit it
  const send = mockGraphResponse(`${GRAPH}/me/sendMail`, sendBody, state, outcome, SENT_AT);
  expect(send?.status).toBe(202);
  expect(state.lastSent).not.toBeNull();
  const s = state.lastSent!;
  const ref: GovernedSendRef = { recipient: s.recipient, subject: s.subject, body: s.body, sentAtMs: s.sentAtMs };
  const clock = { now: () => SENT_AT + 1000, sleep: () => Promise.resolve() };
  return { state, ref, clock };
}

describe('S5.4 Phase 0 — mock-Graph read-back seam closes the circle over the real oracle', () => {
  it('records a governed send verbatim from the Graph sendMail body', () => {
    const { state } = sendThen('success');
    expect(state.lastSent).toEqual({
      recipient: 'neuropause033@gmail.com',
      subject: 'NeuroPause circle proof',
      body: 'The demo is Friday.',
      sentAtMs: SENT_AT,
    });
  });

  it("knob 'success' — Sent Items echoes the send ⇒ VERIFIED_SUCCESS with a corroborated id", async () => {
    const { state, ref, clock } = sendThen('success');
    const r = await verifyGovernedSend(ref, readerFor(state, 'success', SENT_AT + 1000), clock, { backoffMs: [0] });
    expect(r.state).toBe('VERIFIED_SUCCESS');
    expect(r.matchedMessageId).toContain('@MOCK.OUTLOOK.COM');
  });

  it("knob 'bounce' — Inbox returns an NDR referencing the recipient ⇒ VERIFY_FAILED", async () => {
    const { state, ref, clock } = sendThen('bounce');
    const r = await verifyGovernedSend(ref, readerFor(state, 'bounce', SENT_AT + 1000), clock, { backoffMs: [0] });
    expect(r.state).toBe('VERIFY_FAILED');
    expect(r.bounceReason).toContain('5.1.1');
  });

  it("knob 'hold' — nothing observed ⇒ HOLD (UNKNOWN, never auto-promoted to SUCCESS)", async () => {
    const { state, ref, clock } = sendThen('hold');
    const r = await verifyGovernedSend(ref, readerFor(state, 'hold', SENT_AT + 1000), clock, { backoffMs: [0, 0] });
    expect(r.state).toBe('HOLD');
    expect(r.state).not.toBe('VERIFIED_SUCCESS');
  });

  it('the knob defaults to the honest verifiable path (success); unknown values do not weaken it', () => {
    expect(resolveVerifyOutcome({})).toBe('success');
    expect(resolveVerifyOutcome({ NEUROPAUSE_E2E_VERIFY: 'nonsense' } as NodeJS.ProcessEnv)).toBe('success');
    expect(resolveVerifyOutcome({ NEUROPAUSE_E2E_VERIFY: 'hold' } as NodeJS.ProcessEnv)).toBe('hold');
    expect(resolveVerifyOutcome({ NEUROPAUSE_E2E_VERIFY: 'bounce' } as NodeJS.ProcessEnv)).toBe('bounce');
  });

  it('non-Graph and unrelated Graph URLs pass through (null) — the mock is scoped', () => {
    const state = createMockGraphState();
    expect(mockGraphResponse('https://example.com/x', null, state, 'success', SENT_AT)).toBeNull();
    expect(mockGraphResponse(`${GRAPH}/me/drive/root`, null, state, 'success', SENT_AT)).toBeNull();
  });
});
