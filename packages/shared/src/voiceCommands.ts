/**
 * Voice control-command parser (V2.7, STEP 7).
 *
 * Pure function: a recognized transcript → a VoiceCommand (stop/cancel/pause/
 * continue/repeat/start-over/goodbye/thank-you/none). These are the in-conversation
 * controls that interrupt or steer the session; anything that isn't a control
 * command returns 'none' and is handled as a normal request by the V2.6 brain.
 * Deterministic + offline; matched before the request router so "stop" never gets
 * treated as a query.
 */
import type { VoiceCommand } from './types/voice';

const PATTERNS: Array<{ command: VoiceCommand; test: RegExp }> = [
  {
    command: 'goodbye',
    test: /\b(goodbye|good bye|bye)\s+neuropause\b|\bgoodbye\b|\bthat'?s all\b|\bwe'?re done\b/i,
  },
  { command: 'thank-you', test: /\b(thank you|thanks|thank you neuropause)\b/i },
  { command: 'start-over', test: /\bstart over\b|\bstart again\b|\breset\b/i },
  { command: 'repeat', test: /\brepeat\b|\bsay that again\b|\bwhat did you say\b|\bagain\b/i },
  { command: 'continue', test: /\b(continue|go on|keep going|resume)\b/i },
  { command: 'pause', test: /\bpause\b|\bhold on\b|\bwait\b/i },
  { command: 'cancel', test: /\bcancel\b|\bnever mind\b|\bforget it\b/i },
  { command: 'stop', test: /\bstop\b|\bquiet\b|\benough\b|\bshut up\b/i },
];

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const t = transcript.trim();
  if (!t) return 'none';
  for (const p of PATTERNS) {
    if (p.test.test(t)) return p.command;
  }
  return 'none';
}

/** Commands that must interrupt speech immediately (STEP 7). */
export function interruptsSpeech(command: VoiceCommand): boolean {
  return (
    command === 'stop' || command === 'cancel' || command === 'pause' || command === 'start-over'
  );
}

/** Commands that end the conversation session. */
export function endsSession(command: VoiceCommand): boolean {
  return command === 'goodbye';
}
