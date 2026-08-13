/**
 * The experience-profile singleton, backed by userData. Telemetry events are
 * wired at init (see onboarding/index.ts) so the service itself stays pure.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { createExperienceProfileService } from './experienceProfileService';

let onEvent: (event: string) => void = () => {};

/** Late-bind the event sink (the platform event publisher, once it exists). */
export function bindExperienceEvents(sink: (event: string) => void): void {
  onEvent = sink;
}

export const experienceProfileService = createExperienceProfileService({
  filePath: join(app.getPath('userData'), 'experience-profile.json'),
  onEvent: (event) => onEvent(event),
});
