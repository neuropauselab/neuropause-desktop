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
