/**
 * Runtime preferences (V4.2) — a tiny persisted store for runtime toggles, mirror-
 * ing the existing window-state JSON pattern (userData file, safe read/write). Kept
 * separate + minimal so it's easy to reason about and test.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface RuntimePreferences {
  /** Launch NeuroPause when macOS starts. */
  loginAtStartup: boolean;
}

export const DEFAULT_RUNTIME_PREFERENCES: RuntimePreferences = {
  loginAtStartup: false,
};

function prefsPath(): string {
  return join(app.getPath('userData'), 'runtime-preferences.json');
}

/** Read all runtime preferences, falling back to defaults on any error. */
export function loadRuntimePreferences(): RuntimePreferences {
  try {
    if (!existsSync(prefsPath())) return { ...DEFAULT_RUNTIME_PREFERENCES };
    const raw = JSON.parse(readFileSync(prefsPath(), 'utf-8')) as Partial<RuntimePreferences>;
    return {
      loginAtStartup:
        typeof raw.loginAtStartup === 'boolean'
          ? raw.loginAtStartup
          : DEFAULT_RUNTIME_PREFERENCES.loginAtStartup,
    };
  } catch {
    return { ...DEFAULT_RUNTIME_PREFERENCES };
  }
}

function saveRuntimePreferences(prefs: RuntimePreferences): void {
  try {
    writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf-8');
  } catch {
    /* best-effort; a failed write must never crash the runtime */
  }
}

export function loadLoginAtStartup(): boolean {
  return loadRuntimePreferences().loginAtStartup;
}

export function persistLoginAtStartup(enabled: boolean): void {
  const prefs = loadRuntimePreferences();
  saveRuntimePreferences({ ...prefs, loginAtStartup: enabled });
}
