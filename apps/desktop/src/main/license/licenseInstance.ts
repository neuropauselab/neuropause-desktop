/** The license validator singleton, backed by userData and the real HTTP transport. */
import { join } from 'node:path';
import { app } from 'electron';
import { createLicenseValidator } from './validator';
import { createHttpLicenseTransport } from './transport';

export const licenseValidator = createLicenseValidator({
  filePath: join(app.getPath('userData'), 'license-status.json'),
  transport: createHttpLicenseTransport(),
});
