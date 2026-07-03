/**
 * Build identity. Resolves the version/commit/channel/build-time that identify
 * this exact build, plus the runtime versions, for the updater and the Release
 * Diagnostics surface.
 *
 * The commit/channel/build-time come from `resources/build-info.json`, written
 * at package time by `scripts/generate-build-info.cjs`. Environment variables
 * override the file (useful for CI), and everything has a safe dev fallback so
 * `npm run dev` never throws.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { UpdateChannel } from '@neuropause/shared';
import { resolveChannel } from './services/updater/updateChannels';

interface GeneratedBuildInfo {
  commit?: string;
  channel?: string;
  buildTime?: string;
}

function readGenerated(): GeneratedBuildInfo {
  // Look in the layouts electron-builder may place resources under, plus the
  // dev repo path. The first one that parses wins; absence is expected in dev.
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'build-info.json') : '',
    join(app.getAppPath(), 'build-info.json'),
    join(app.getAppPath(), 'resources', 'build-info.json'),
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as GeneratedBuildInfo;
    } catch {
      /* not present in this layout; try the next */
    }
  }
  return {};
}

const generated = readGenerated();

export interface BuildInfo {
  version: string;
  channel: UpdateChannel;
  commit: string;
  buildTime: string;
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  runtime: { electron: string; node: string; chrome: string; v8: string };
}

export function getBuildInfo(): BuildInfo {
  return {
    version: app.getVersion(),
    channel: resolveChannel(process.env.NEUROPAUSE_CHANNEL ?? generated.channel),
    commit: process.env.NEUROPAUSE_BUILD_COMMIT ?? generated.commit ?? 'unknown',
    buildTime: process.env.NEUROPAUSE_BUILD_TIME ?? generated.buildTime ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    runtime: {
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      v8: process.versions.v8 ?? 'unknown',
    },
  };
}
