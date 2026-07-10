/**
 * P2.4 — Microsoft 365 write layer assembly.
 *
 * Collects every domain's write actions and builds the executor. All actions ride the `microsoft-entra`
 * connector's authenticated Graph session (no new OAuth), exactly like the read modules.
 */
import type { WriteAction } from './actionSdk';
import { mailActions } from './mail';
import { calendarActions } from './calendar';
import { driveActions } from './drive';
import { teamsActions } from './teams';
import { contactActions } from './contacts';
import { M365Executor, type M365ExecutorDeps } from './executor';

/** Every Microsoft 365 write action, in domain order. */
export const ALL_M365_ACTIONS: WriteAction[] = [
  ...mailActions,
  ...calendarActions,
  ...driveActions,
  ...teamsActions,
  ...contactActions,
];

export function createM365Executor(deps: M365ExecutorDeps): M365Executor {
  return new M365Executor(deps, ALL_M365_ACTIONS);
}

export { M365Executor } from './executor';
export type { M365ExecutorDeps } from './executor';
export type { WriteAction, WriteActionContext, WriteActionResult } from './actionSdk';
