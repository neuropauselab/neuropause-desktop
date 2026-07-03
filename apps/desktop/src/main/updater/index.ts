/**
 * Updater subsystem. Exposes the application self-update channels behind the
 * secure IPC bridge and bridges updater status changes to the renderer as a
 * broadcast. The side-effecting channels (check, download, install, set-channel)
 * are audited; install requires an explicit user action in the renderer.
 */
import { IpcChannel, EmptyRequest, UpdateSetChannelRequest } from '@neuropause/shared';
import type { UpdateSetChannelRequest as TUpdateSetChannelRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { appUpdater } from '../services/appUpdater';

const log = createLogger('updater');

export interface UpdaterDeps {
  broadcast: (channel: string, payload: unknown) => void;
}

export interface UpdaterModule {
  handlers: SecureHandlerDef[];
}

export function initUpdater(deps: UpdaterDeps): UpdaterModule {
  appUpdater.on('status', (status) => deps.broadcast(IpcChannel.UpdateEventBroadcast, { status }));

  const handlers: SecureHandlerDef[] = [
    { channel: IpcChannel.UpdateGetStatus, schema: EmptyRequest, handler: () => appUpdater.status() },
    { channel: IpcChannel.UpdateCheckNow, schema: EmptyRequest, audit: true, handler: () => appUpdater.checkNow() },
    { channel: IpcChannel.UpdateDownload, schema: EmptyRequest, audit: true, handler: () => appUpdater.download() },
    {
      channel: IpcChannel.UpdateInstallOnQuit,
      schema: EmptyRequest,
      audit: true,
      handler: () => appUpdater.installOnRestart(),
    },
    {
      channel: IpcChannel.UpdateSetChannel,
      schema: UpdateSetChannelRequest,
      audit: true,
      handler: (p) => appUpdater.setChannel((p as TUpdateSetChannelRequest).channel),
    },
  ];

  const status = appUpdater.status();
  log.info('Updater subsystem initialized', { channel: status.channel, supported: status.supported });
  return { handlers };
}
