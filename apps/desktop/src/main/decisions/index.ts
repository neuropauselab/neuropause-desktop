/**
 * Decision subsystem IPC — the governance memory made readable.
 *
 * A Decision Record that nothing can read is not a record, it is a write to
 * /dev/null with extra steps. The whole point of Phase F ("why did we approve
 * this?") is reconstruction, so the store needs a real read path, and an open
 * Hold needs a real resolve path — otherwise a hold is a modal that vanished.
 *
 * Authorization: reads carry `governance:read`, resolving carries
 * `governance:manage` and is bridge-audited. Both are stamped in
 * `ipc/runtimeAuthz.ts` alongside every other privileged runtime channel, so
 * this subsystem cannot ship unclassified — the boot invariant would fail.
 */
import {
  DecisionRecordGetRequest,
  DecisionRecordListRequest,
  HoldListRequest,
  HoldResolveRequest,
  HOLD_OUTCOME_LABELS,
  IpcChannel,
} from '@neuropause/shared';
import type { DecisionRecordDetail, HoldCenterView, HoldRecord } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { DecisionRecordStore } from './decisionService';
import type { HoldStore } from './holdStore';

export interface DecisionSubsystemDeps {
  /**
   * The stores are injected rather than imported from `./instances`, which
   * binds Electron's `app.getPath`. Injection is what lets this whole surface
   * be exercised under plain Node with real files — the alternative is testing
   * the stores and *hoping* the handlers use them correctly.
   */
  decisionRecords: DecisionRecordStore;
  holds: HoldStore;
  /** Whether dependency assessment is bound to the real relationship store. */
  assessmentLive: () => boolean;
  /** Count of declared relationships — 0 means the assessor can find nothing. */
  relationshipsDeclared: () => number;
  actor: () => string | null;
  audit: (action: string, target: string, summary: string) => void;
}

export interface DecisionSubsystem {
  handlers: SecureHandlerDef[];
}

export function initDecisions(deps: DecisionSubsystemDeps): DecisionSubsystem {
  const { decisionRecords: decisionRecordStore, holds: holdStore } = deps;
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.DecisionRecordList,
      schema: DecisionRecordListRequest,
      handler: (p) => decisionRecordStore.list((p as DecisionRecordListRequest).limit ?? 100),
    },
    {
      channel: IpcChannel.DecisionRecordGet,
      schema: DecisionRecordGetRequest,
      handler: (p): DecisionRecordDetail | null => {
        const record = decisionRecordStore.get((p as DecisionRecordGetRequest).id);
        if (!record) return null;
        return {
          record,
          subjectHistory: decisionRecordStore.forSubject(record.subject),
          hold: record.holdId ? holdStore.get(record.holdId) : null,
        };
      },
    },
    {
      channel: IpcChannel.HoldList,
      schema: HoldListRequest,
      handler: (p): HoldCenterView => {
        const limit = (p as HoldListRequest).limit ?? 100;
        const all = holdStore.list(limit);
        return {
          open: all.filter((h) => h.status === 'open'),
          resolved: all.filter((h) => h.status === 'resolved'),
          assessmentLive: deps.assessmentLive(),
          relationshipsDeclared: deps.relationshipsDeclared(),
        };
      },
    },
    {
      channel: IpcChannel.HoldResolve,
      schema: HoldResolveRequest,
      audit: true,
      handler: (p): HoldRecord | null => {
        const req = p as HoldResolveRequest;
        const note = req.note?.trim() || HOLD_OUTCOME_LABELS[req.outcome];
        const hold = holdStore.resolve(req.id, req.outcome, note);
        if (!hold) return null;
        // Resolving a hold is itself a consequential decision: it closes a
        // governed pause. It gets its own record so the pair reconciles and
        // the reconstruction has no gap between "held" and "then what".
        decisionRecordStore.record({
          actor: deps.actor(),
          requestedAction: `Resolve hold: ${hold.title}`,
          subject: hold.subject,
          assessment: {
            risk: hold.reason === 'insufficient_evidence' ? 'insufficient_evidence' : 'high_risk',
            recommendation: hold.resolution,
            evidence: hold.known.map((detail) => ({ label: 'Known at hold time', detail, count: null })),
            alternative: null,
          },
          outcome: req.outcome,
          executed: note,
          holdId: hold.id,
        });
        deps.audit('hold.resolved', hold.subject, `${hold.title}: ${req.outcome} — ${note}`);
        return hold;
      },
    },
  ];
  return { handlers };
}
