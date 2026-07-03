/**
 * The application's AuditLog singleton, backed by a file under Electron's
 * userData directory. Kept apart from auditLog.ts so the class stays
 * electron-free and unit-testable.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { AuditLog } from './auditLog';

export const auditLog = new AuditLog(join(app.getPath('userData'), 'workforce-audit.json'));
