/**
 * Onboarding subsystem. Loads the persisted first-run state and exposes IPC for the
 * wizard and the welcome checklist: read status, start, complete a step, dismiss,
 * and reset (QA; audited). Follows the same handler-registration pattern as the
 * other subsystems.
 */
import { EmptyRequest, IpcChannel, OnboardingCompleteStepRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { onboardingService } from './onboardingInstance';

export interface OnboardingSubsystem {
  handlers: SecureHandlerDef[];
}

export async function initOnboarding(): Promise<OnboardingSubsystem> {
  await onboardingService.load();
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
