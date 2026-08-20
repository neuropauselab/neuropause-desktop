/**
 * Slice 11 wiring — the `capability:m365.propose` secure-handler def (data-only). This is the ONLY capability-propose
 * file that touches singletons; the logic lives in `capabilityProposeCore` so it stays testable. The def is stamped by
 * `withRuntimeAuthz` (requireAuth + `connectors:manage` from RUNTIME_CHANNEL_PERMISSIONS — it THROWS if unclassified).
 *
 * Registered by one additive `defs.push(...capabilityHandlers)` in `runtimeCore.ts` (FG-2). The handler produces DATA
 * ONLY: it has no import path to the executor / CST / admission, never sets `confirmed`, and returns a reviewable
 * proposal + provenance or a typed refusal. The human still reviews + confirms downstream through the certified path.
 */
import { IpcChannel, CapabilityProposeM365ActionRequest } from '@neuropause/shared';
import type { CapabilityProposeM365ActionResponse } from '@neuropause/shared';
import { withRuntimeAuthz } from '../ipc/runtimeAuthz';
import { declareChannelResource } from '../ipc/channelResource';
import { activeTenantScope } from '../enterprise';
import { authService } from '../auth/authService';
import { capabilityDiscoveryService } from './capabilityDiscoveryInstance';
import { runProposeM365ActionWithArtifact } from './capabilityProposeCore';
import { runBrainProposeLane } from '../liveBrain/brainProposeLane';
import { actionRecord } from '../connectors/actionRecord';
import { createLogger } from '../logger';

const log = createLogger('capability-propose');

// What this handler ACTUALLY reads (verified from code): the active workspace's connected accounts, via the capability
// catalog, to validate an AI-proposed mail.send. Read-only; it writes no store and performs no effect.
declareChannelResource({
  channel: IpcChannel.CapabilityProposeM365Action,
  store: 'connector-accounts',
  effect: 'read',
  reason:
    "Reads the active workspace's connected accounts (connector-accounts) to build the capability catalog and " +
    'validate an AI-proposed mail.send against it. Read-only: produces a reviewable proposal; no store is written ' +
    'and no external effect occurs. Actor/tenant are resolved server-side at the later M365ActionExecute call.',
});

export const capabilityHandlers = withRuntimeAuthz([
  {
    channel: IpcChannel.CapabilityProposeM365Action,
    schema: CapabilityProposeM365ActionRequest,
    // `req` arrives as `unknown` per the secure-handler def; the bridge has already validated it against `schema`
    // before calling us, so the cast is safe — the standard connector-handler pattern.
    handler: async (req: unknown): Promise<CapabilityProposeM365ActionResponse> => {
      const request = req as CapabilityProposeM365ActionRequest;
      const { response, artifact } = runProposeM365ActionWithArtifact(
        {
          resolveSelection: (r) => capabilityDiscoveryService.resolveSelection(r),
          subjectId: () => {
            const status = authService.getStatus();
            return status.state === 'authenticated' ? status.session.user.id : null;
          },
          scope: () => activeTenantScope(),
        },
        request,
      );
      /**
       * P4-MIN — A REFUSAL MUST BE OBSERVABLE OR IT IS NOT AUDITABLE (F-P24).
       *
       * THE ADMISSION REASON is that a governance system which cannot prove its refusals is
       * unauditable AS GOVERNANCE. That this also makes future investigation cheaper is a
       * CONSEQUENCE, not the reason — an instrumental justification is how scope creep enters
       * a governed programme.
       *
       * Until this line, `capabilityProposeCore` emitted nothing (zero emitters) and the
       * renderer's typed refusal surface sat inside the `import.meta.env.DEV` block, so a
       * production propose refusal was silent in the log AND invisible on screen at the same
       * time. That dual silence is F-P24's instance here.
       *
       * REASON ONLY — `detail` is deliberately NOT logged. Enumerated across all four reason
       * literals: PRINCIPAL_UNRESOLVED carries `'NOT_AUTHENTICATED' | 'NO_TENANT'`,
       * CAPABILITY_NOT_SELECTED carries a selection-status literal, and UNSUPPORTED_ACTION
       * carries `executor:actionId` from the registry — all closed sets. But INVALID_PARAMS
       * carries request-derived text, and two of its branches interpolate a RECIPIENT ADDRESS
       * (`m365ActionProposal.ts:99,101` — `addr.slice(0, 60)`), with a third carrying an
       * untrusted parameter key. `redactCredentialText` would NOT protect it: NP-013 scoped it
       * to credentials and PINNED that an email shape survives (the round-31 W-7 predicate).
       * So the reason alone is logged — it answers the pre-registered question ("refusal
       * emitted → record the exact reason") and carries no untrusted text at all.
       *
       * DECISION-NEUTRAL: this reads `response`, changes no branch, and returns nothing
       * different. It changes what is RECORDED, never what is DECIDED.
       */
      if (!response.ok) log.warn(`propose refused — ${response.reason}`);
      if (!response.ok || artifact === null) return response;
      // S5.4 — the Brain-propose lane: composes the real substrate into a certified L6 Proposal from the VALIDATED
      // artifact, stashes it for the FG-10 execution gate, and returns the FG-9 review fields. Best-effort and
      // ADDITIVE-ONLY: any refusal/failure yields no `brainReview` and the response is exactly as today — the send
      // may still proceed as a human-composed governed send; it is simply not Brain-proposed.
      try {
        const brainReview = await runBrainProposeLane(
          {
            capabilityId: artifact.capabilityId,
            accountId: artifact.accountId,
            to: artifact.review.to,
            subject: artifact.review.subject,
            body: artifact.review.body,
            purpose: artifact.purpose,
          },
          {
            scope: () => activeTenantScope(),
            moduleStore: () => null, // the enterprise registry accessor is private to its runtime — honest UNAVAILABLE
            actions: (tenantKey) => actionRecord.query({ tenantId: tenantKey }),
            nowMs: () => Date.now(),
          },
        );
        return brainReview === null ? response : { ...response, brainReview };
      } catch (err) {
        log.warn('Brain-propose lane failed — returning the propose response without brainReview', err);
        return response;
      }
    },
  },
]);
