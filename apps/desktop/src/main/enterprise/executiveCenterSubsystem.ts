/**
 * Executive Intelligence Center — subsystem wiring.
 *
 * Connects the pure composer to the REAL existing producers and exposes one IPC
 * handler the renderer calls. No new intelligence; it calls V2.2/V2.3 build
 * functions and the V2.3 health model.
 */
import { EmptyRequest, IpcChannel, type ExecutiveCenterSnapshot } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildFounderProactiveItems } from '../ai/founderProactive';
import { buildOrgIntelligenceItems, collectOrgHealthInputs } from './orgIntelligence';
import { composeExecutiveSnapshot } from './executiveCenter';

const log = createLogger('executive-center');

export interface ExecutiveCenterSubsystem {
  handlers: SecureHandlerDef[];
  snapshot: () => ExecutiveCenterSnapshot;
}

export function initExecutiveCenter(): ExecutiveCenterSubsystem {
  const snapshot = (): ExecutiveCenterSnapshot =>
    composeExecutiveSnapshot({
      now: () => new Date(),
      founderItems: () => buildFounderProactiveItems('morning'),
      orgItems: () => buildOrgIntelligenceItems(),
      orgHealthInputs: (nowMs) => collectOrgHealthInputs(nowMs),
    });

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.ExecutiveCenterSnapshot,
      schema: EmptyRequest,
      handler: () => snapshot(),
    },
  ];

  log.info('Executive Intelligence Center initialized');
  return { handlers, snapshot };
}
