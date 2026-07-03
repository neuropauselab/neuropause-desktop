/**
 * The live sync service singleton — constructs the real service (HTTP transport +
 * persisted queue/mirror, both under userData), holds the active cloud org (set from
 * the renderer, null when signed out), and generates a stable device id used for
 * echo-exclusion on pull. This module wires Electron/app state, so it is not
 * unit-tested; the logic it composes is covered by the livesync module tests.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLogger } from '../../logger';
import { createHttpSyncTransport } from './transport';
import { createLiveSyncService, type LiveSyncService } from './liveSyncService';

const log = createLogger('livesync');

function loadOrCreateDeviceId(): string {
  const file = join(app.getPath('userData'), 'livesync-device-id');
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim();
      if (existing) return existing;
    }
  } catch {
    // fall through and create a new id
  }
  const id = randomUUID();
  try {
    writeFileSync(file, id, { mode: 0o600 });
  } catch (err) {
    log.warn('Could not persist device id; using an ephemeral one', { error: String(err) });
  }
  return id;
}

let activeOrgId: string | null = null;

/** Set from the renderer when the active cloud org changes (null when signed out). */
export function setLiveSyncActiveOrg(orgId: string | null): void {
  activeOrgId = orgId;
}

export function getLiveSyncActiveOrg(): string | null {
  return activeOrgId;
}

/** The live sync service singleton, backed by userData. */
export const liveSync: LiveSyncService = createLiveSyncService({
  deviceId: loadOrCreateDeviceId(),
  storeFilePath: join(app.getPath('userData'), 'livesync-queue.json'),
  mirrorFilePath: join(app.getPath('userData'), 'livesync-mirror.json'),
  transport: createHttpSyncTransport(),
  getActiveOrgId: () => activeOrgId,
});
