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
import { Notification } from 'electron';
import { createActionExecutor } from './automationActions';
import { memoryStore } from '../memory/memoryInstance';
import { aiEngine } from '../ai/engineInstance';
import { wireAutomationProducers } from './automationProducer';
import type { PlatformEvent, PlatformEventInput, PlatformEventType } from '@neuropause/shared';

const log = createLogger('automations');

// V4.7 runtime: bounded run history + the runner, wired to the store + the default
// action executor. Completed runs are recorded on the rule and pushed to history.
const runHistory = new AutomationRunHistory();

// V4.8: the platform publisher, injected at init so completed runs emit events
// into the Executive Timeline / Activity Intelligence. No-op until wired.
let publishPlatformEvent: ((input: PlatformEventInput) => void) | null = null;

const runner = new AutomationRunner(() => automationStore.activeRules(), {
  // RC Phase 1 — real execution: each action drives its actual subsystem and
  // reports ok:true ONLY when the effect occurred (see automationActions.ts).
  execute: createActionExecutor({
    notify: ({ title, body }) => {
      if (!Notification.isSupported()) {
        return { ok: false, message: 'Notifications are not supported on this platform' };
      }
      new Notification({ title, body }).show();
      return { ok: true };
    },
    memory: { remember: (input) => memoryStore.remember(input) },
    ai: { isConfigured: () => aiEngine.isConfigured(), run: (req) => aiEngine.run(req) },
  }),
  recordRun: (ruleId, result) => automationStore.recordRun(ruleId, result),
  emitCompleted: (record) => {
    runHistory.add(record);
    // V4.8: surface completed automations on the platform bus (timeline/activity).
    publishPlatformEvent?.({
      type: 'automation.completed',
      category: 'automation',
      source: 'automation-runtime',
      actor: { kind: 'system', id: null },
      resource: { type: 'automation', id: record.ruleId, name: record.ruleName },
      priority: 'normal',
      metadata: {
        durationMs: record.durationMs,
        actions: record.actions.length,
        triggeredBy: record.triggeredBy,
      },
    });
  },
  now: Date.now,
});

/** Exposed so producers (connector/activity/schedule) can feed the runtime. */
export function getAutomationRunner(): AutomationRunner {
  return runner;
}

/** V5.0: the automation monitor rollup for NeuroCore's system-health composition. */
export function getAutomationMonitor(): {
  completed: number;
  failed: number;
  paused: number;
  running: number;
} {
  const m = runHistory.monitor();
  return { completed: m.completed, failed: m.failed, paused: m.paused, running: m.running };
}

/**
 * Phase 6 Stage 5 — recent run records for read-only composition (the
 * recommendation engine's automation-opportunity rule and the assistant's Work
 * Summary). The SAME bounded history the AutomationRunsRecent channel serves.
 */
export function getAutomationRunRecords(limit = 200): AutomationRunRecord[] {
  return runHistory.list(limit);
}

export interface AutomationSubsystem {
  handlers: SecureHandlerDef[];
}

export interface AutomationInitDeps {
  /** Publish a platform event (for completion events). */
  publish?: (input: PlatformEventInput) => void;
  /** Subscribe to platform event types (to wire automatic producers). */
  on?: (
    types: PlatformEventType[],
    handler: (evt: PlatformEvent) => void,
  ) => { dispose: () => void };
}

export function initAutomations(deps: AutomationInitDeps = {}): AutomationSubsystem {
  publishPlatformEvent = deps.publish ?? null;
  // V4.8: wire automatic event producers so saved rules fire on real events.
  if (deps.on) {
    wireAutomationProducers({ on: deps.on, runner });
  }
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
