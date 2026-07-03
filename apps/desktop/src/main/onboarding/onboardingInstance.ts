/** The onboarding service singleton, backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { createOnboardingService } from './onboardingService';

export const onboardingService = createOnboardingService({
  filePath: join(app.getPath('userData'), 'onboarding.json'),
});
