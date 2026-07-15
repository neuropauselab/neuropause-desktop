/**
 * Workforce intelligence subsystem (V8.4 inc2). Composition root that exposes the
 * derived workforce intelligence over IPC. Reads the existing jobStore (source of
 * truth) and folds it via workforceIntelligence; adds no store, touches no runtime.
 * Registered alongside the other subsystems in runtimeCore.
 */
import { EmptyRequest, IpcChannel } from '@neuropause/shared';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { jobStore } from '../runtime/jobInstance';
import { withWorkforceAuthz } from '../authzGate';
import { workforceIntelligence } from './workforceIntelligence';

export interface WorkforceIntelligenceSubsystem {
  handlers: SecureHandlerDef[];
}

export function initWorkforceIntelligence(): WorkforceIntelligenceSubsystem {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.WorkforceIntelligence,
      schema: EmptyRequest,
      handler: () => workforceIntelligence(jobStore.page({ limit: 2000 }).jobs),
    },
  ];
  // P8.2 — gated to `workforce:read` via the shared classification map.
  return { handlers: withWorkforceAuthz(handlers) };
}
