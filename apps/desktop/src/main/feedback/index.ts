/**
 * Feedback subsystem. Exposes IPC for the early-access feedback loop: submit a
 * categorized entry, list entries, export them (for attaching to a support
 * conversation alongside the existing support bundle), and clear (support/QA;
 * audited). Local + export-based — no remote ingestion, matching crash/telemetry.
 * appVersion is accepted by the store but left null here until buildInfo is
 * threaded through (named follow-up).
 */
import { promises as fs } from 'node:fs';
import { dialog } from 'electron';
import { EmptyRequest, FeedbackSubmitRequest, IpcChannel } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { feedbackStore } from './feedbackInstance';
import { activeTenantScope } from '../enterprise/index';

/**
 * P13C ROUND 3 — these five channels came OFF the public allowlist.
 *
 * They carried no `requireAuth` and no permission, so any renderer message read
 * every organization's feedback text and could write it to an arbitrary path.
 * Reads move to `dashboard:read` — the universal signed-in read scope this
 * codebase already uses for per-user surfaces whose owner is resolved
 * server-side, and the same choice N7 made for assistant conversations.
 * `clear` and `exportToFile` are destructive and egress respectively, so both
 * take `org:manage`.
 */

export interface FeedbackSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initFeedback(): Promise<FeedbackSubsystem> {
  feedbackStore.bindScope(activeTenantScope);
  await feedbackStore.load();
  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    {
      channel: IpcChannel.FeedbackSubmit,
      schema: FeedbackSubmitRequest,
      requireAuth: true,
      permission: 'dashboard:read',
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
      requireAuth: true,
      permission: 'dashboard:read',
      handler: () => feedbackStore.list(),
    },
    {
      channel: IpcChannel.FeedbackExport,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'dashboard:read',
      handler: () => feedbackStore.exportAll(),
    },
    {
      channel: IpcChannel.FeedbackClear,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'org:manage',
      audit: true,
      handler: () => feedbackStore.clear(),
    },
    {
      channel: IpcChannel.FeedbackExportToFile,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'org:manage',
      audit: true,
      handler: async () => {
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export feedback',
          defaultPath: `neuropause-feedback-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (canceled || !filePath) return null;
        await fs.writeFile(filePath, JSON.stringify(feedbackStore.exportAll(), null, 2), 'utf8');
        return filePath;
      },
    },
  ];
}
