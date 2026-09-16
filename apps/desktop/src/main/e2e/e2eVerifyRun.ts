/**
 * NeuroPause OS — Wave 2 / S5.4 Phase 0. Compile-gated E2E READ-BACK runner (MOCK ONLY).
 *
 * STRUCTURALLY ABSENT FROM PRODUCTION (`NEUROPAUSE_E2E_VERIFY_v1` sentinel; only reached from the compile-stripped
 * `e2eSeed` mock, itself `__NP_E2E__`-gated). It closes THE CIRCLE in the real-Electron loop: once the mock Graph has
 * captured a governed send, this drives the DE-GATED, READ-ONLY `verifyGovernedSend` over the REAL `makeM365GraphReader`
 * — whose `fetch` the mock intercepts — so the WHOLE chain (send → ACK → independent read-back → terminal) runs
 * in-process with ZERO real contact, and LOGS the terminal the oracle reaches. It never sends and never mutates.
 *
 * The read-back logic itself is the SHARED production `verifyGovernedSend`; the only thing stripped is this trigger.
 */
import { createLogger } from '../logger';
import { workspaceStore } from '../enterprise/workspace/workspaceInstance';
import { makeM365GraphReader } from '../verification/m365ReadBack';
import { verifyGovernedSend } from '../verification/verifyGovernedSend';
import { getMockGraphState } from './e2eSeed';

export const E2E_VERIFY_SENTINEL = 'NEUROPAUSE_E2E_VERIFY_v1';
const log = createLogger('e2e-verify');
const MOCK_ACCOUNT_ID = 'e2e-entra-acct'; // must match the account e2eSeed seeds

export async function runE2eVerification(): Promise<void> {
  log.warn(`[${E2E_VERIFY_SENTINEL}] mock read-back — READ-ONLY; MUST NEVER RUN IN A RELEASE BUILD`);
  const workspaceId = workspaceStore.activeWorkspaceIdOrNull();
  if (!workspaceId) {
    log.error(`[${E2E_VERIFY_SENTINEL}] no active workspace`);
    return;
  }
  const sent = getMockGraphState().lastSent;
  if (!sent) {
    log.error(`[${E2E_VERIFY_SENTINEL}] no captured send — nothing to verify`);
    return;
  }
  const reader = makeM365GraphReader(workspaceId, 'microsoft-entra', MOCK_ACCOUNT_ID);
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  try {
    // Short bounded backoff so the harness terminates quickly; the 'hold' knob exhausts it fast → HOLD.
    const result = await verifyGovernedSend(
      { recipient: sent.recipient, subject: sent.subject, body: sent.body, sentAtMs: sent.sentAtMs },
      reader,
      { now: () => Date.now(), sleep },
      { backoffMs: [0, 50, 100] },
    );
    log.warn(
      `[${E2E_VERIFY_SENTINEL}] TERMINAL=${result.state} internetMessageId=${result.matchedMessageId ?? 'n/a'} ` +
        `bounce=${result.bounceReason ?? 'none'} attempts=${result.attempts} — ${result.detail}`,
    );
  } catch (err) {
    log.error(`[${E2E_VERIFY_SENTINEL}] read-back error`, err);
  }
}
