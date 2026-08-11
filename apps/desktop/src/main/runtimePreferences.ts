/**
 * Runtime preferences (V4.2) — a tiny persisted store for runtime toggles, mirror-
 * ing the existing window-state JSON pattern (userData file, safe read/write). Kept
 * separate + minimal so it's easy to reason about and test.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { declareStoreScope } from './tenancy/storeScope';

/** P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'runtime-preferences',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  // Launch-at-login is a property of the macOS user account, which is the
  // signed-in person's own machine setting — the USER-authority install-global
  // case `storeScope.ts` names.
  authority: 'USER',
  classification: 'USER_PREFERENCE',
  /**
   * P13C ROUND 10 — NONE, not INSTALL. There is no removal on this store at all:
   * one record, one boolean, `persistLoginAtStartup` reads the current value and
   * writes `{...prefs, loginAtStartup}` back. `INSTALL` would claim a removal
   * exists and reaches everything, which is a louder statement than the truth.
   * `NONE` therefore takes `retentionAuthority: 'NONE'` — if nothing is removed
   * there is nobody to authorize — which `declareStoreScope` enforces in both
   * directions.
   *
   * WHAT THE RETENTION SCANNER MATCHED: the words "no eviction" in the prose
   * below. There is no `slice`, `splice`, `shift`, `pop`, `delete` or cap in the
   * file. A false positive here costs one honest enum, which is the trade the
   * gate is designed around.
   */
  retentionScope: 'NONE',
  retentionAuthority: 'NONE',
  retention:
    'One record with one boolean, rewritten whole on every change. No list, no cap, no eviction and ' +
    'no delete path: a write can remove nothing except the previous value of `loginAtStartup`, and ' +
    'an unreadable or absent file falls back to the defaults rather than being truncated.',
  reason:
    'WHY GLOBAL: `loginAtStartup` registers the APPLICATION as a macOS login item — one binary, one ' +
    'launch, one answer per machine. A per-organization value would be unrepresentable at the OS. ' +
    'WHAT DATA: a single boolean. It names no record, counts no activity and describes no customer. ' +
    'CROSS-TENANT COST: none beyond the app starting or not starting at login.',
});

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
