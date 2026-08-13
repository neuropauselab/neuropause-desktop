/**
 * userData singleton for the companion device registry (Mobile M1-03). Kept
 * apart from the Electron-free store so the store unit-tests on a temp file.
 * The filename is also declared in storePaths.ts so backups cover it.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { CompanionDeviceStore } from './deviceRegistryStore';

let store: CompanionDeviceStore | null = null;

export function companionDeviceStore(): CompanionDeviceStore {
  if (!store) {
    store = new CompanionDeviceStore(join(app.getPath('userData'), 'companion-devices.json'));
  }
  return store;
}
