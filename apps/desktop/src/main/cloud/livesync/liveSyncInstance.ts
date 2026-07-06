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
import { authService } from '../../auth/authService';
import { runtimeIdentity } from '../../runtimeIdentity';

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

/** The stable per-install device id (persisted under userData). Idempotent. */
export function getDeviceId(): string {
  return loadOrCreateDeviceId();
}

let activeOrgId: string | null = null;

/**
 * Recompute the runtime identity (V6.6.3) from the three real sources: the active
 * cloud org (here), the authenticated user (authService), and the device id. Sets
 * identity only when all three are known; clears it otherwise. Idempotent —
 * runtimeIdentity suppresses no-op updates. This is the single wiring point that
 * makes RuntimeIdentityContext live, so the memory-sync bridge can source
 * org/user/device without threading them through every call.
 */
function refreshRuntimeIdentity(): void {
  const status = authService.getStatus();
  if (status.state === 'authenticated' && activeOrgId) {
    runtimeIdentity.set({
      organizationId: activeOrgId,
      userId: status.session.user.id,
      deviceId: getDeviceId(),
    });
  } else {
    runtimeIdentity.clear();
  }
}

/** Set from the renderer when the active cloud org changes (null when signed out). */
export function setLiveSyncActiveOrg(orgId: string | null): void {
  activeOrgId = orgId;
  refreshRuntimeIdentity();
}

export function getLiveSyncActiveOrg(): string | null {
  return activeOrgId;
}

// Keep identity in step with auth: login/restore populates it (once an org is
// active), logout clears it.
authService.on('statusChanged', refreshRuntimeIdentity);

/** The live sync service singleton, backed by userData. */
export const liveSync: LiveSyncService = createLiveSyncService({
  deviceId: loadOrCreateDeviceId(),
  storeFilePath: join(app.getPath('userData'), 'livesync-queue.json'),
  mirrorFilePath: join(app.getPath('userData'), 'livesync-mirror.json'),
  transport: createHttpSyncTransport(),
  getActiveOrgId: () => activeOrgId,
});
