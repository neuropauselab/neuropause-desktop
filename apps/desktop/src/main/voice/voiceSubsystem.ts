/**
 * Executive Voice Assistant — subsystem wiring (V2.6).
 *
 * Exposes ONE entry the audio/renderer layer calls with a recognized transcript;
 * it classifies the intent, pulls the live Executive Center snapshot (V2.4), and
 * composes an evidence-grounded spoken response. It reuses existing systems and
 * adds no AI, context builder, or governance of its own — state-changing actions
 * are flagged `requiresApproval` for the existing governance/approval path.
 *
 * The wake word, STT and TTS are provided by the renderer/native layer through the
 * shared interfaces; this main-process brain is pure and unit-tested.
 */
import { z } from 'zod';
import { IpcChannel, type VoiceResponse } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildFounderProactiveItems } from '../ai/founderProactive';
import { buildOrgIntelligenceItems, collectOrgHealthInputs } from '../enterprise/orgIntelligence';
import { composeExecutiveSnapshot } from '../enterprise/executiveCenter';
import { classifyVoiceIntent } from './voiceIntent';
import { composeVoiceResponse, type VoiceComposerContext } from './voiceComposer';

const log = createLogger('voice');

/** Request schema: a recognized transcript (+ optional display name for greeting). */
export const VoiceTurnRequest = z.object({
  transcript: z.string().min(1),
  displayName: z.string().optional(),
});

function timeOfDay(now: Date): VoiceComposerContext['timeOfDay'] {
  const h = now.getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

export interface VoiceSubsystem {
  handlers: SecureHandlerDef[];
  /** Directly answer a transcript (used by the IPC handler; exported for tests). */
  answer: (transcript: string, displayName?: string) => VoiceResponse;
}

export function initVoice(): VoiceSubsystem {
  const liveSnapshot = () =>
    composeExecutiveSnapshot({
      now: () => new Date(),
      founderItems: () => buildFounderProactiveItems('morning'),
      orgItems: () => buildOrgIntelligenceItems(),
      orgHealthInputs: (nowMs) => collectOrgHealthInputs(nowMs),
    });

  const answer = (transcript: string, displayName?: string): VoiceResponse => {
    const result = classifyVoiceIntent(transcript);
    const snapshot = liveSnapshot();
    const response = composeVoiceResponse(result, snapshot, {
      displayName,
      timeOfDay: timeOfDay(new Date()),
    });
    // Audit the routed intent (no raw audio stored — only the recognized intent).
    log.info('Voice turn', {
      intent: response.intent,
      requiresApproval: response.requiresApproval ?? false,
    });
    return response;
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.VoiceTurn,
      schema: VoiceTurnRequest,
      handler: (p) => {
        const { transcript, displayName } = p as { transcript: string; displayName?: string };
        return answer(transcript, displayName);
      },
    },
  ];

  log.info('Executive Voice Assistant initialized');
  return { handlers, answer };
}
