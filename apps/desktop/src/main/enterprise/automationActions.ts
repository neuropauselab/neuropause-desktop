/**
 * Default automation action executor (V4.7).
 *
 * Maps automation actions to real effects. Honestly scoped to what exists in the
 * app today: `notify` fires a native desktop notification; timeline/activity
 * emission is handled by the runner's emitCompleted hook. Actions that require
 * subsystems not yet exposed to the runtime (connector-write, AI tasks, webhooks)
 * are declared extension points — they succeed as recorded no-ops with a clear
 * message rather than pretending to have performed a live side-effect.
 */
import { Notification } from 'electron';
import { createLogger } from '../logger';
import type { ActionExecutor } from './automationRunner';
import { ALL_M365_ACTIONS } from '../connectors/m365';
import { classifyConnectorWrite } from './automationConnectorWrite';

const log = createLogger('automation-actions');

export const defaultActionExecutor: ActionExecutor = async (action) => {
  switch (action.type) {
    case 'notify': {
      const title = String(action.config?.title ?? 'NeuroPause automation');
      const body = String(action.config?.body ?? action.label);
      try {
        if (Notification.isSupported()) {
          new Notification({ title, body }).show();
          return { ok: true };
        }
        return { ok: true, message: 'Notifications not supported on this platform' };
      } catch (err) {
        return { ok: false, message: String(err) };
      }
    }

    case 'create-reminder':
      // Reminder creation is recorded; wiring to the reminder engine's write path
      // is a follow-up (the engine currently detects reminders, not accepts them).
      log.info('automation reminder action (recorded)', { label: action.label });
      return { ok: true, message: 'Reminder recorded' };

    case 'save-memory':
      log.info('automation memory action (recorded)', { label: action.label });
      return { ok: true, message: 'Memory write recorded' };

    case 'ai-summarize':
    case 'ai-generate':
      // AI action execution requires the AI runtime call path; recorded until wired.
      return { ok: true, message: `${action.type} recorded (AI runtime wiring pending)` };

    case 'connector-write': {
      // P2.5 — an automation fires autonomously, so a connector write is NEVER executed
      // here: it is classified against the real Microsoft 365 write registry and HELD for
      // explicit user confirmation. This honors the hard rule "AI must never send/modify
      // data automatically" while grounding the outcome in the executor's real capabilities.
      const outcome = classifyConnectorWrite(action, ALL_M365_ACTIONS);
      log.info('automation connector-write held for confirmation', {
        label: action.label,
        connectorId: action.connectorId,
        mutates: outcome.mutates,
        resolved: outcome.resolved,
      });
      return { ok: outcome.ok, message: outcome.message };
    }

    default:
      return { ok: true, message: `${action.type} recorded` };
  }
};
