/**
 * NeuroPause OS — Wave 2 / Slice 15. First-real-send SAFETY GUARD.
 *
 * Enforced BEFORE the certified executor (a `__NP_E2E__`-gated, dynamically-imported hook in the FROZEN
 * `connectors/index.ts`). It NEVER weakens the certified path — governedSend / CST / scopesOk / actor / admission are
 * untouched; this only REFUSES, up front, in the first-real-send mode:
 *
 *   1. RECIPIENT ALLOWLIST (all fields) — `to` must be EXACTLY the one compiled-in operator address; ANY cc/bcc → DENIED;
 *      any recipient structure it cannot confidently parse → DENIED. Fail closed. It parses the SAME normalized params
 *      the executor reads (`strArr`/`optStrArr` from `actionSdk`).
 *   2. SINGLE-SEND LATCH (durable, survives restart) — AT MOST ONE send. The latch is written BEFORE the send, so a
 *      failed attempt CONSUMES the send; re-running requires deliberately deleting the latch file (Slice-15 condition 4).
 *
 * INERT unless `NEUROPAUSE_FIRST_REAL_SEND=1`. Zero top-level side effects — the latch path is resolved lazily (no
 * `app.getPath` at module scope). Compile-stripped from release (see verify-e2e-strip.sh).
 */
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { app } from 'electron';
import type { ConnectorWriteResult } from '@neuropause/shared';
import { strArr, optStrArr, type WriteParams } from './m365/actionSdk';

/** Compiled-in — the operator's OWN address ONLY. The first real send can reach nobody else. */
const FIRST_REAL_SEND_ALLOWLIST = ['neuropause033@gmail.com'];
const LATCH_FILE = 'first-real-send.latch';

const active = (): boolean => process.env.NEUROPAUSE_FIRST_REAL_SEND === '1';
const latchPath = (): string => join(app.getPath('userData'), LATCH_FILE); // lazy — never resolved at module scope

export type FirstRealSendGuardResult = { ok: true } | { ok: false; refusal: ConnectorWriteResult };

const deny = (reason: string, detail: string): FirstRealSendGuardResult => ({
  ok: false,
  refusal: { ok: false, message: detail, data: { outcome: 'DENIED', reason } },
});

export function firstRealSendGuard(rawParams: unknown): FirstRealSendGuardResult {
  if (!active()) return { ok: true }; // fully inert unless the first-real-send mode is explicitly on

  // Parse EXACTLY what the executor will read. Anything we cannot confidently parse → DENIED (fail closed).
  let to: string[];
  let cc: string[];
  let bcc: string[];
  try {
    const p = rawParams as WriteParams;
    if (!p || typeof p !== 'object') throw new Error('params not an object');
    to = strArr(p, 'to');
    cc = optStrArr(p, 'cc');
    bcc = optStrArr(p, 'bcc');
  } catch {
    return deny('UNPARSEABLE_RECIPIENTS', 'First real send refused — recipient params could not be confidently parsed (fail closed).');
  }

  if (cc.length > 0 || bcc.length > 0) {
    return deny('CC_BCC_PRESENT', 'First real send refused — cc/bcc are not permitted.');
  }

  const norm = to.map((a) => a.trim().toLowerCase());
  if (norm.length !== 1 || !FIRST_REAL_SEND_ALLOWLIST.includes(norm[0])) {
    return deny('RECIPIENT_NOT_ALLOWLISTED', 'First real send refused — only the compiled-in operator address is permitted.');
  }

  const latch = latchPath();
  if (existsSync(latch)) {
    return deny('SINGLE_SEND_LATCH', 'First real send refused — the single send has already been used (no retry). Delete the latch deliberately to re-run.');
  }
  // Latch BEFORE the send → at-most-once: a failed attempt consumes it. `wx` fails if it already exists (race-safe).
  writeFileSync(latch, JSON.stringify({ at: new Date().toISOString(), to: norm }), { flag: 'wx' });
  return { ok: true };
}
