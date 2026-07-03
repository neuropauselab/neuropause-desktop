/**
 * Pilot mode: a persisted per-install opt-in marking this machine as part of the
 * early-access pilot. What it does: records the choice (joinedAt / leftAt) and
 * lets the UI badge the install and emphasize feedback. What it deliberately does
 * NOT do: change the update/release channel, unlock features, or alter any
 * runtime behavior — those would be separate, explicit decisions. joinedAt is the
 * first time the install ever joined and is preserved across leave/rejoin.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { PilotStatus } from '@neuropause/shared';

interface PilotFileData {
  version: 1;
  enabled: boolean;
  joinedAt: string | null;
  leftAt: string | null;
}

function emptyData(): PilotFileData {
  return { version: 1, enabled: false, joinedAt: null, leftAt: null };
}

export interface PilotService {
  load(): Promise<void>;
  getStatus(): PilotStatus;
  setEnabled(enabled: boolean): Promise<PilotStatus>;
}

export function createPilotService(opts: { filePath: string; now?: () => Date }): PilotService {
  const now = opts.now ?? ((): Date => new Date());
  let data = emptyData();
  let loaded = false;

  async function persist(): Promise<void> {
    const tmp = `${opts.filePath}.tmp`;
    await fs.mkdir(dirname(opts.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, opts.filePath);
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    try {
      const raw = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as Partial<PilotFileData>;
      data = {
        version: 1,
        enabled: raw.enabled ?? false,
        joinedAt: raw.joinedAt ?? null,
        leftAt: raw.leftAt ?? null,
      };
    } catch {
      data = emptyData();
    }
    loaded = true;
  }

  function status(): PilotStatus {
    return { enabled: data.enabled, joinedAt: data.joinedAt, leftAt: data.leftAt };
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    getStatus(): PilotStatus {
      return status();
    },

    async setEnabled(enabled): Promise<PilotStatus> {
      await ensureLoaded();
      if (enabled === data.enabled) return status();
      data.enabled = enabled;
      if (enabled) {
        if (!data.joinedAt) data.joinedAt = now().toISOString();
        data.leftAt = null;
      } else {
        data.leftAt = now().toISOString();
      }
      await persist();
      return status();
    },
  };
}
