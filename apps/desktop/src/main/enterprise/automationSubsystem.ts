/**
 * Automation Builder subsystem (Module 9) — IPC handlers for rule persistence +
 * the V4.7 runtime (manual run, monitor, history). Reuses the AutomationStore
 * (validates via the shared engine) and the AutomationRunner. No new rule logic.
 */
import {
  AutomationIdRequest,
  AutomationSaveRequest,
  AutomationSetStatusRequest,
  EmptyRequest,
  IpcChannel,
  type AutomationMonitor,
  type AutomationRule,
  type AutomationRunRecord,
  type AutomationStatus,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { automationStore } from './automationInstance';
import { AutomationRunner } from './automationRunner';
import { AutomationRunHistory } from './automationRunHistory';
import { defaultActionExecutor } from './automationActions';

const log = createLogger('automations');

// V4.7 runtime: bounded run history + the runner, wired to the store + the default
// action executor. Completed runs are recorded on the rule and pushed to history.
const runHistory = new AutomationRunHistory();
const runner = new AutomationRunner(() => automationStore.activeRules(), {
  execute: defaultActionExecutor,
  recordRun: (ruleId, result) => automationStore.recordRun(ruleId, result),
  emitCompleted: (record) => runHistory.add(record),
  now: Date.now,
});

/** Exposed so producers (connector/activity/schedule) can feed the runtime. */
export function getAutomationRunner(): AutomationRunner {
  return runner;
}

export interface AutomationSubsystem {
  handlers: SecureHandlerDef[];
}

export function initAutomations(): AutomationSubsystem {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.AutomationList,
      schema: EmptyRequest,
      handler: (): {
        rules: AutomationRule[];
        summary: ReturnType<typeof automationStore.summary>;
      } => ({
        rules: automationStore.all(),
        summary: automationStore.summary(),
      }),
    },
    {
      channel: IpcChannel.AutomationSave,
      schema: AutomationSaveRequest,
      handler: async (
        payload: unknown,
      ): Promise<{ ok: boolean; rule?: AutomationRule; issues?: string[] }> => {
        const { rule } = payload as { rule: AutomationRule };
        const res = await automationStore.save(rule);
        if (!res.ok) {
          log.info('automation rejected', { issues: res.issues });
          return { ok: false, issues: res.issues };
        }
        return { ok: true, rule: res.rule };
      },
    },
    {
      channel: IpcChannel.AutomationSetStatus,
      schema: AutomationSetStatusRequest,
      handler: async (payload: unknown): Promise<{ rule: AutomationRule | null }> => {
        const { id, status } = payload as { id: string; status: AutomationStatus };
        const rule = await automationStore.setStatus(id, status, new Date().toISOString());
        runHistory.setPaused(automationStore.summary().paused);
        return { rule };
      },
    },
    {
      channel: IpcChannel.AutomationRemove,
      schema: AutomationIdRequest,
      handler: async (payload: unknown): Promise<{ removed: boolean }> => {
        const { id } = payload as { id: string };
        return { removed: await automationStore.remove(id) };
      },
    },
    {
      channel: IpcChannel.AutomationRun,
      schema: AutomationIdRequest,
      handler: async (payload: unknown): Promise<{ record: AutomationRunRecord | null }> => {
        const { id } = payload as { id: string };
        const record = await runner.runById(id, {}, 'manual');
        return { record };
      },
    },
    {
      channel: IpcChannel.AutomationMonitor,
      schema: EmptyRequest,
      handler: (): { monitor: AutomationMonitor } => {
        runHistory.setPaused(automationStore.summary().paused);
        return { monitor: runHistory.monitor() };
      },
    },
    {
      channel: IpcChannel.AutomationHistory,
      schema: EmptyRequest,
      handler: (): { records: AutomationRunRecord[] } => ({ records: runHistory.list() }),
    },
  ];

  log.info('Automation Builder subsystem initialized');
  return { handlers };
}
