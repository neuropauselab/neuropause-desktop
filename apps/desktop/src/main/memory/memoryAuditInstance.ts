/**
 * The application's MemoryAuditLog singleton, backed by a file under Electron's
 * userData directory. Kept apart from memoryAuditLog.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { MemoryAuditLog } from './memoryAuditLog';

export const memoryAuditLog = new MemoryAuditLog(
  join(app.getPath('userData'), 'memory-audit.json'),
);
