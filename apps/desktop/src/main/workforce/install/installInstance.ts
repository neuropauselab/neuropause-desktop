/**
 * P8.5 — Singletons for the worker-install subsystem. Binds the electron-free store
 * and signing key to userData-relative paths (mode 0o600), mirroring registryInstance.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { InstallStore } from './installStore';
import { WorkerSigningKey } from './signingKey';

export const workerInstallStore = new InstallStore(join(app.getPath('userData'), 'workforce-installs.json'));
export const workerSigningKey = new WorkerSigningKey(join(app.getPath('userData'), 'workforce-signing-key.json'));
