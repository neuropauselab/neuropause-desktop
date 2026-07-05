/**
 * Automation Builder subsystem (Module 9) — IPC handlers for rule persistence.
 * Reuses the AutomationStore (which validates via the shared engine). No new rule
 * logic here; this is transport + wiring.
 */
import {
  AutomationIdRequest,
  AutomationSaveRequest,
  AutomationSetStatusRequest,
  EmptyRequest,
  IpcChannel,
  type AutomationRule,
  type AutomationStatus,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { automationStore } from './automationInstance';

const log = createLogger('automations');

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
  ];

  log.info('Automation Builder subsystem initialized');
  return { handlers };
}
