/**
 * NeuroPause OS — Wave 2 / S5.4 Phase 0. PURE mock-Microsoft-Graph seam (send + READ-BACK), no electron, no I/O.
 *
 * ── STRUCTURALLY ABSENT FROM PRODUCTION ──────────────────────────────────────────────────────────────────────
 * This module is imported ONLY by `e2e/e2eSeed.ts` (itself `__NP_E2E__` + `NEUROPAUSE_E2E`-gated and compile-stripped).
 * The `MOCK_GRAPH_SENTINEL` below is a grep target proving it is absent from every release bundle. It touches NO
 * frozen surface and weakens NO validation: the certified send path runs unchanged; this only shapes the EXTERNAL
 * Graph HTTP responses an intercepted `fetch` returns — the send 202, and now the read-back Sent Items / Inbox rows.
 *
 * ── WHY A READ-BACK MOCK ─────────────────────────────────────────────────────────────────────────────────────
 * The real-Electron loop must prove the WHOLE circle — send → ACK → INDEPENDENT read-back → terminal — not merely
 * executor-ack (constitutional §2 #14). So the mock, on a governed send, records what was sent, then answers the
 * READ-ONLY reader's Sent Items / Inbox GETs so the REAL `verifyEffect` oracle reaches a real terminal. Which terminal
 * is chosen by a single harness knob (`NEUROPAUSE_E2E_VERIFY`), so all three certified outcomes are drivable:
 *   success (default) — Sent Items echoes the send ⇒ VERIFIED_SUCCESS
 *   bounce            — Inbox returns an NDR referencing the recipient ⇒ VERIFY_FAILED
 *   hold              — nothing is observed ⇒ the bounded backoff exhausts ⇒ HOLD (never auto-promoted)
 * The mock is PURE and deterministic (clock injected); it never invents a success the oracle would not corroborate.
 */
export const MOCK_GRAPH_SENTINEL = 'NEUROPAUSE_MOCK_GRAPH_v1'; // grep target — must be 0× in any release bundle

export type MockVerifyOutcome = 'success' | 'hold' | 'bounce';

/** The corroboration inputs the mock captured from a governed send (never a token or callable). */
export interface MockSentRef {
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  readonly sentAtMs: number;
}

export interface MockGraphState {
  lastSent: MockSentRef | null;
}

export interface MockResponse {
  readonly status: number;
  readonly body: string;
}

export function createMockGraphState(): MockGraphState {
  return { lastSent: null };
}

/** Which terminal the read-back mock should steer toward. Deny-by-default to the honest, verifiable path (success). */
export function resolveVerifyOutcome(env: NodeJS.ProcessEnv): MockVerifyOutcome {
  const v = (env.NEUROPAUSE_E2E_VERIFY ?? '').toLowerCase();
  return v === 'hold' || v === 'bounce' ? v : 'success';
}

const isGraph = (url: string): boolean => /graph\.microsoft\.com/.test(url);
const iso = (ms: number): string => new Date(ms).toISOString();

interface GraphSendBody {
  message?: {
    subject?: string;
    body?: { content?: string };
    toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  };
}

/** Parse a Graph `/me/sendMail` POST body into the corroboration ref and record it as `lastSent`. Returns the ref. */
export function recordSend(state: MockGraphState, bodyText: string | null, nowMs: number): MockSentRef | null {
  if (!bodyText) return null;
  let parsed: GraphSendBody;
  try {
    parsed = JSON.parse(bodyText) as GraphSendBody;
  } catch {
    return null;
  }
  const msg = parsed.message ?? {};
  const recipient = msg.toRecipients?.[0]?.emailAddress?.address ?? '';
  const ref: MockSentRef = {
    recipient,
    subject: msg.subject ?? '',
    body: msg.body?.content ?? '',
    sentAtMs: nowMs,
  };
  state.lastSent = ref;
  return ref;
}

/** A Graph message row, in exactly the shape `m365ReadBack` (`makeM365GraphReader`) maps back. */
function sentItemsValue(state: MockGraphState, outcome: MockVerifyOutcome, nowMs: number): unknown[] {
  const s = state.lastSent;
  if (outcome !== 'success' || !s) return []; // hold/bounce/no-send ⇒ nothing in Sent Items
  return [
    {
      internetMessageId: `<mock-${encodeURIComponent(s.subject).slice(0, 12)}-${nowMs}@MOCK.OUTLOOK.COM>`,
      toRecipients: [{ emailAddress: { address: s.recipient } }],
      subject: s.subject,
      bodyPreview: s.body,
      sentDateTime: iso(nowMs),
    },
  ];
}

function inboxValue(state: MockGraphState, outcome: MockVerifyOutcome, nowMs: number): unknown[] {
  const s = state.lastSent;
  if (outcome !== 'bounce' || !s) return []; // only the bounce knob returns an NDR
  return [
    {
      from: { emailAddress: { address: 'postmaster@outlook.com' } },
      subject: `Undeliverable: ${s.subject}`,
      bodyPreview: `Delivery has failed to these recipients. 5.1.1 The email address ${s.recipient} was not found.`,
      receivedDateTime: iso(nowMs),
    },
  ];
}

/**
 * The mock's answer for a Graph request, or `null` to pass the request through to the real fetch. A `/me/sendMail`
 * POST is recorded (side effect on `state`) and answered 202; the read-back GETs are answered per `outcome`.
 */
export function mockGraphResponse(
  url: string,
  bodyText: string | null,
  state: MockGraphState,
  outcome: MockVerifyOutcome,
  nowMs: number,
): MockResponse | null {
  if (!isGraph(url)) return null;
  if (/sendMail/i.test(url)) {
    recordSend(state, bodyText, nowMs);
    return { status: 202, body: '{}' }; // Graph /me/sendMail returns 202 Accepted, no body
  }
  if (/mailFolders\/sentitems\/messages/i.test(url)) {
    return { status: 200, body: JSON.stringify({ value: sentItemsValue(state, outcome, nowMs) }) };
  }
  if (/mailFolders\/inbox\/messages/i.test(url)) {
    return { status: 200, body: JSON.stringify({ value: inboxValue(state, outcome, nowMs) }) };
  }
  return null;
}
