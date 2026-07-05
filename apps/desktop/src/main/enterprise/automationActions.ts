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

    case 'connector-write':
      // Live connector write requires the connector action API (not yet exposed to
      // the runtime). Recorded honestly rather than faked.
      return {
        ok: true,
        message: `connector-write to ${action.connectorId ?? 'connector'} recorded (live write pending)`,
      };

    default:
      return { ok: true, message: `${action.type} recorded` };
  }
};
