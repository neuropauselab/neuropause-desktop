/**
 * Onboarding subsystem. Loads the persisted first-run state and exposes IPC for the
 * wizard and the welcome checklist: read status, start, complete a step, dismiss,
 * and reset (QA; audited). Follows the same handler-registration pattern as the
 * other subsystems.
 */
import {
  EmptyRequest,
  ExperienceProfileSetRequest,
  IpcChannel,
  OnboardingCompleteStepRequest,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { onboardingService } from './onboardingInstance';
import { experienceProfileService } from './experienceProfileInstance';
import { createLogger } from '../logger';

const log = createLogger('onboarding');

export interface OnboardingSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initOnboarding(): Promise<OnboardingSubsystem> {
  await onboardingService.load();
  await experienceProfileService.load();
  // Boot evidence for the dev terminal: this line printing proves the
  // Private-First main process is the one running, and says whether the
  // first-run experience will show ('pending') or why not.
  const profile = experienceProfileService.get();
  log.info('Experience profile', {
    state: profile.state,
    workspaceType: profile.workspaceType,
    aiModeChosen: profile.aiModeChosen,
  });
  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    {
      channel: IpcChannel.OnboardingStatus,
      schema: EmptyRequest,
      handler: () => onboardingService.getStatus(),
    },
    {
      channel: IpcChannel.OnboardingStart,
      schema: EmptyRequest,
      handler: () => onboardingService.start(),
    },
    {
      channel: IpcChannel.OnboardingCompleteStep,
      schema: OnboardingCompleteStepRequest,
      handler: (p) => onboardingService.completeStep((p as OnboardingCompleteStepRequest).step),
    },
    {
      // The first-run experience profile: pending/completed/skipped, workspace
      // type, AI-mode-chosen. Read by the shell to decide whether the
      // experience shows; written as each decision is made.
      channel: IpcChannel.ExperienceProfileGet,
      schema: EmptyRequest,
      handler: () => experienceProfileService.get(),
    },
    {
      channel: IpcChannel.ExperienceProfileSet,
      schema: ExperienceProfileSetRequest,
      handler: (p) => experienceProfileService.set(p as ExperienceProfileSetRequest),
    },
    {
      // Back to first run. The service has always supported this; until now
      // nothing could call it, so "you can answer these later" was not true.
      channel: IpcChannel.ExperienceProfileReset,
      schema: EmptyRequest,
      audit: true,
      handler: () => experienceProfileService.reset(),
    },
    {
      channel: IpcChannel.OnboardingDismiss,
      schema: EmptyRequest,
      handler: () => onboardingService.dismiss(),
    },
    {
      channel: IpcChannel.OnboardingReset,
      schema: EmptyRequest,
      audit: true,
      handler: () => onboardingService.reset(),
    },
  ];
}
