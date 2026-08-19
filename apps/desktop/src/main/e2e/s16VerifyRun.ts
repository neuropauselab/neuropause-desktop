/**
 * NeuroPause OS — Wave 2 / Slice 16. Compile-gated IN-SESSION verification runner.
 *
 * STRUCTURALLY ABSENT FROM PRODUCTION (gated by `__NP_E2E__` + `NEUROPAUSE_VERIFY_S15=1`; the auto-trigger is dropped
 * from release, like the seed). It exists so the operator can run the FIRST REAL read-back in their own live session
 * (where the vault unlocks — DECISIONS D-10): it builds the target from the spent latch + the operator's subject, then
 * runs the pure `verifyEffect` oracle via the READ-ONLY Graph reader, and LOGS the terminal outcome + the
 * internetMessageId it observes. It never sends and never mutates.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLogger } from '../logger';
import { connectorStore } from '../connectors/connectorStore';
import { workspaceStore } from '../enterprise/workspace/workspaceInstance';
import { makeM365GraphReader } from '../verification/m365ReadBack';
import { verifyEffect, fingerprint, type VerificationTarget } from '../verification/verifyEffect';
import { actionRecord } from '../connectors/actionRecord';

export const S16_VERIFY_SENTINEL = 'NEUROPAUSE_S16_VERIFY_v1';
const log = createLogger('s16-verify');
const WINDOW_MS = 10 * 60_000;

export async function runS16Verification(): Promise<void> {
  log.warn(`[${S16_VERIFY_SENTINEL}] in-session read-back verification — READ-ONLY; MUST NEVER RUN IN A RELEASE BUILD`);
  const workspaceId = workspaceStore.activeWorkspaceIdOrNull();
  if (!workspaceId) {
    log.error(`[${S16_VERIFY_SENTINEL}] no active workspace`);
    return;
  }
  const accounts = connectorStore.byConnector('microsoft-entra');
  const account = accounts.find((a) => a.workspaceId === workspaceId) ?? accounts[0];
  if (!account) {
    log.error(`[${S16_VERIFY_SENTINEL}] no connected microsoft-entra account`);
    return;
  }

  const latchPath = join(app.getPath('userData'), 'first-real-send.latch');
  if (!existsSync(latchPath)) {
    log.error(`[${S16_VERIFY_SENTINEL}] no first-real-send.latch — nothing to verify`);
    return;
  }
  const latch = JSON.parse(readFileSync(latchPath, 'utf8')) as { at: string; to: string[] };
  const sentMs = Date.parse(latch.at);
  const subject = process.env.NEUROPAUSE_VERIFY_SUBJECT ?? 'NeuroPause S15 first real send, 18 Aug 2026';

  const target: VerificationTarget = {
    internetMessageId: null, // the 202 carried none — corroborate on recipient + subject + timestamp
    recipient: latch.to[0],
    subjectFingerprint: fingerprint(subject),
    bodyFingerprint: '',
    sentAtWindow: { fromMs: sentMs - WINDOW_MS, toMs: sentMs + WINDOW_MS },
  };

  const reader = makeM365GraphReader(workspaceId, 'microsoft-entra', account.id);
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  try {
    const result = await verifyEffect(target, { ...reader, now: () => Date.now(), sleep });
    log.warn(
      `[${S16_VERIFY_SENTINEL}] TERMINAL=${result.state} internetMessageId=${result.matchedMessageId ?? 'n/a'} ` +
        `bounce=${result.bounceReason ?? 'none'} attempts=${result.attempts} — ${result.detail}`,
    );
    // S19 feeder — attach the verification terminal to the action record so
    // EXTERNALLY_OBSERVED counts real verified effects. PROSPECTIVE-ONLY: it attaches
    // only to an EXISTING transition record (the observer must have been running at
    // send time). The historical S15/S16 chain has NO record — the FG-5 observer landed
    // after it — so nothing attaches and NOTHING is retro-inserted (a backfilled row
    // would be a fabricated observation). That chain lives in certification evidence.
    const recs = await actionRecord.query({ tenantId: workspaceId, recipient: latch.to[0] });
    const match = recs.filter((r) => r.outcome === 'ACKNOWLEDGED').slice(-1)[0];
    if (match) {
      await actionRecord.recordVerification(match.transitionId, {
        terminal: result.state,
        internetMessageId: result.matchedMessageId ?? null,
        at: new Date().toISOString(),
      });
      log.warn(`[${S16_VERIFY_SENTINEL}] verification attached to ${match.transitionId} (${result.state})`);
    } else {
      log.warn(
        `[${S16_VERIFY_SENTINEL}] no action record for this send — prospective-only; the historical S15 chain is ` +
          `never retro-inserted (observer not running then), it lives in certification evidence`,
      );
    }
  } catch (err) {
    log.error(`[${S16_VERIFY_SENTINEL}] verification error`, err);
  }
}
