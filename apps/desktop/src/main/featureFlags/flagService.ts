/**
 * The feature-flag service: evaluates flags against the active plan plus persisted
 * per-install overrides. Overrides are written atomically to a JSON file. The pure
 * evaluation lives in the shared flag core; this layer adds persistence and the plan
 * context. The file path is injected so the service is unit-testable without Electron.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { FeatureFlagKey, FeatureFlagState, PlanTier } from '@neuropause/shared';
import { evaluateFlag, featureFlag, FEATURE_FLAGS } from '@neuropause/shared';

interface FlagFileData {
  version: 1;
  overrides: Partial<Record<FeatureFlagKey, boolean>>;
}

function emptyData(): FlagFileData {
  return { version: 1, overrides: {} };
}

export interface FlagService {
  load(): Promise<void>;
  evaluate(planTier: PlanTier): FeatureFlagState[];
  isEnabled(key: FeatureFlagKey, planTier: PlanTier): boolean;
  getOverride(key: FeatureFlagKey): boolean | undefined;
  setOverride(key: FeatureFlagKey, value: boolean): Promise<void>;
  clearOverride(key: FeatureFlagKey): Promise<void>;
  listOverrides(): Partial<Record<FeatureFlagKey, boolean>>;
}

export function createFlagService(opts: { filePath: string }): FlagService {
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
      const raw = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as Partial<FlagFileData>;
      data = { version: 1, overrides: raw.overrides ?? {} };
    } catch {
      data = emptyData();
    }
    loaded = true;
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    evaluate(planTier): FeatureFlagState[] {
      return FEATURE_FLAGS.map((def) =>
        evaluateFlag(def, { override: data.overrides[def.key], planTier }),
      );
    },

    isEnabled(key, planTier): boolean {
      const def = featureFlag(key);
      if (!def) return false;
      return evaluateFlag(def, { override: data.overrides[key], planTier }).enabled;
    },

    getOverride(key): boolean | undefined {
      return data.overrides[key];
    },

    async setOverride(key, value): Promise<void> {
      await ensureLoaded();
      data.overrides[key] = value;
      await persist();
    },

    async clearOverride(key): Promise<void> {
      await ensureLoaded();
      delete data.overrides[key];
      await persist();
    },

    listOverrides(): Partial<Record<FeatureFlagKey, boolean>> {
      return { ...data.overrides };
    },
  };
}
