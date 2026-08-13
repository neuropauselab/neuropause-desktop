/**
 * Replay protection (M1-02). The sealed payload carries { seq, sentAt };
 * each receiver keeps, per peer, the last accepted sequence number. A message
 * is accepted only if its seq strictly advances AND its sentAt is inside the
 * clock-skew window. Pure functions — the desktop persists state per device,
 * the phone per desktop; neither side trusts anything outside the seal.
 */

export interface ReplayState {
  lastSeq: number;
}

export function initialReplayState(): ReplayState {
  return { lastSeq: -1 };
}

export const DEFAULT_MAX_SKEW_MS = 90_000;

export type ReplayVerdict =
  { ok: true; state: ReplayState } | { ok: false; reason: 'seq-reused' | 'clock-skew' };

export function checkReplay(input: {
  seq: number;
  sentAt: string;
  nowMs: number;
  state: ReplayState;
  maxSkewMs?: number;
}): ReplayVerdict {
  if (!Number.isInteger(input.seq) || input.seq <= input.state.lastSeq) {
    return { ok: false, reason: 'seq-reused' };
  }
  const sentMs = Date.parse(input.sentAt);
  const maxSkew = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (!Number.isFinite(sentMs) || Math.abs(input.nowMs - sentMs) > maxSkew) {
    return { ok: false, reason: 'clock-skew' };
  }
  return { ok: true, state: { lastSeq: input.seq } };
}
