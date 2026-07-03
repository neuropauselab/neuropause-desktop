/**
 * The single trusted entry point for renderer -> main calls.
 *
 * Every channel here is:
 *   1. On the shared INVOKABLE_CHANNELS allowlist (no ad-hoc channels).
 *   2. Bound to a Zod schema; the raw payload is validated before any handler
 *      runs, so untrusted renderer input is never used by shape alone.
 *   3. Accepted only from our own renderer frame (sender origin check).
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ZodSchema } from 'zod';
import {
  INVOKABLE_CHANNELS,
  IpcChannel,
  type IpcChannelName,
  EmptyRequest,
  EmailCredentialsRequest,
  LoginOAuthRequest,
  SetThemeSourceRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import * as authHandlers from './handlers/auth';
import * as appHandlers from './handlers/app';

const log = createLogger('ipc');

interface Route {
  schema: ZodSchema;
  handle: (payload: unknown) => unknown | Promise<unknown>;
}

const routes: Partial<Record<IpcChannelName, Route>> = {
  [IpcChannel.AuthGetStatus]: { schema: EmptyRequest, handle: () => authHandlers.getStatus() },
  [IpcChannel.AuthLoginOAuth]: {
    schema: LoginOAuthRequest,
    handle: (p) => authHandlers.loginOAuth(p as LoginOAuthRequest),
  },
  [IpcChannel.AuthLoginEmail]: {
    schema: EmailCredentialsRequest,
    handle: (p) => authHandlers.loginEmail(p as EmailCredentialsRequest),
  },
  [IpcChannel.AuthRegisterEmail]: {
    schema: EmailCredentialsRequest,
    handle: (p) => authHandlers.registerEmail(p as EmailCredentialsRequest),
  },
  [IpcChannel.AuthLogout]: { schema: EmptyRequest, handle: () => authHandlers.logout() },

  [IpcChannel.AppGetInfo]: { schema: EmptyRequest, handle: () => appHandlers.getAppInfo() },
  [IpcChannel.AppGetThemeSource]: {
    schema: EmptyRequest,
    handle: () => appHandlers.getThemeSource(),
  },
  [IpcChannel.AppSetThemeSource]: {
    schema: SetThemeSourceRequest,
    handle: (p) => appHandlers.setThemeSource(p as SetThemeSourceRequest),
  },

  [IpcChannel.WindowClose]: { schema: EmptyRequest, handle: () => appHandlers.closeWindow() },

  // Broadcast-only channels are never invoked, but must exist in the map.
  [IpcChannel.AuthStatusChanged]: { schema: EmptyRequest, handle: () => undefined },
  [IpcChannel.ThemeChanged]: { schema: EmptyRequest, handle: () => undefined },
  [IpcChannel.MenuCommand]: { schema: EmptyRequest, handle: () => undefined },
};

let allowedSenderOrigins: string[] = [];

/** Records which origins our renderer can legitimately be served from. */
export function setAllowedSenderOrigins(origins: string[]): void {
  allowedSenderOrigins = origins;
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  // Packaged builds load from file://; dev loads from the Vite origin.
  if (url.startsWith('file://')) return true;
  return allowedSenderOrigins.some((origin) => url.startsWith(origin));
}

/** Shared with the secure bridge so both entry points enforce the same origins. */
export function isTrustedSenderFrame(event: IpcMainInvokeEvent): boolean {
  return isTrustedSender(event);
}

export function registerIpcHandlers(): void {
  for (const channel of INVOKABLE_CHANNELS) {
    const route = routes[channel];
    if (!route) continue;
    ipcMain.handle(channel, async (event, rawPayload: unknown) => {
      if (!isTrustedSender(event)) {
        log.warn('Rejected IPC from untrusted sender', { channel });
        throw new Error('Untrusted sender');
      }
      const parsed = route.schema.safeParse(rawPayload ?? {});
      if (!parsed.success) {
        log.warn('Rejected IPC with invalid payload', { channel });
        throw new Error(`Invalid payload for ${channel}`);
      }
      return route.handle(parsed.data);
    });
  }
  log.info('IPC handlers registered', { count: INVOKABLE_CHANNELS.length });
}
