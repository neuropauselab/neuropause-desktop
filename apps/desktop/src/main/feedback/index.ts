/**
 * Feedback subsystem. Exposes IPC for the early-access feedback loop: submit a
 * categorized entry, list entries, export them (for attaching to a support
 * conversation alongside the existing support bundle), and clear (support/QA;
 * audited). Local + export-based — no remote ingestion, matching crash/telemetry.
 * appVersion is accepted by the store but left null here until buildInfo is
 * threaded through (named follow-up).
 */
import { EmptyRequest, FeedbackSubmitRequest, IpcChannel } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { feedbackStore } from './feedbackInstance';

export interface FeedbackSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initFeedback(): Promise<FeedbackSubsystem> {
  await feedbackStore.load();
  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    {
      channel: IpcChannel.FeedbackSubmit,
      schema: FeedbackSubmitRequest,
      handler: (p) => {
        const r = p as FeedbackSubmitRequest;
        return feedbackStore.submit({
          category: r.category,
          message: r.message,
          context: r.context ?? null,
        });
      },
    },
    {
      channel: IpcChannel.FeedbackList,
      schema: EmptyRequest,
      handler: () => feedbackStore.list(),
    },
    {
      channel: IpcChannel.FeedbackExport,
      schema: EmptyRequest,
      handler: () => feedbackStore.exportAll(),
    },
    {
      channel: IpcChannel.FeedbackClear,
      schema: EmptyRequest,
      audit: true,
      handler: () => feedbackStore.clear(),
    },
  ];
}
