import { describe, expect, it } from 'vitest';
import {
  INITIAL_SESSION,
  isCapturing,
  isTerminal,
  voiceSessionReducer,
  type VoiceSession,
} from '@neuropause/shared';
import { parseVoiceCommand, interruptsSpeech, endsSession } from '@neuropause/shared';

// ── Session machine ─────────────────────────────────────────────────────────

function run(
  events: Parameters<typeof voiceSessionReducer>[1][],
  from = INITIAL_SESSION,
): VoiceSession {
  return events.reduce(voiceSessionReducer, from);
}

describe('voiceSessionReducer', () => {
  it('starts idle and inactive', () => {
    expect(INITIAL_SESSION.state).toBe('idle');
    expect(INITIAL_SESSION.active).toBe(false);
  });

  it('wake activates the session', () => {
    const s = voiceSessionReducer(INITIAL_SESSION, { type: 'wake' });
    expect(s.state).toBe('wake');
    expect(s.active).toBe(true);
  });

  it('ignores startListening when not active', () => {
    const s = voiceSessionReducer(INITIAL_SESSION, { type: 'startListening' });
    expect(s.state).toBe('idle'); // no-op
  });

  it('runs a full happy-path turn', () => {
    const s = run([
      { type: 'wake' },
      { type: 'startListening' },
      { type: 'partialTranscript', text: 'how is' },
      { type: 'finalTranscript', text: 'how is engineering' },
      { type: 'thinkingDone' },
      { type: 'speakStart' },
      { type: 'speakEnd' },
    ]);
    expect(s.state).toBe('waiting'); // ready for a follow-up
    expect(s.active).toBe(true);
    expect(s.lastFinal).toBe('how is engineering');
  });

  it('partial transcript moves to recognizing and captures text', () => {
    const s = run([
      { type: 'wake' },
      { type: 'startListening' },
      { type: 'partialTranscript', text: 'hello' },
    ]);
    expect(s.state).toBe('recognizing');
    expect(s.transcript).toBe('hello');
    expect(isCapturing(s.state)).toBe(true);
  });

  it('interrupt returns to listening and clears transcript', () => {
    const s = run([
      { type: 'wake' },
      { type: 'startListening' },
      { type: 'finalTranscript', text: 'summarize everything' },
      { type: 'thinkingDone' },
      { type: 'speakStart' },
      { type: 'interrupt' },
    ]);
    expect(s.state).toBe('listening');
    expect(s.transcript).toBe('');
  });

  it('goodbye ends the conversation', () => {
    const s = run([{ type: 'wake' }, { type: 'goodbye' }]);
    expect(s.state).toBe('conversation-ended');
    expect(s.active).toBe(false);
    expect(isTerminal(s.state)).toBe(true);
  });

  it('timeout and cancel are terminal + deactivate', () => {
    expect(
      voiceSessionReducer({ ...INITIAL_SESSION, active: true }, { type: 'timeout' }).state,
    ).toBe('conversation-timeout');
    expect(
      voiceSessionReducer({ ...INITIAL_SESSION, active: true }, { type: 'cancel' }).active,
    ).toBe(false);
  });

  it('mute then unmute returns to listening when active, idle otherwise', () => {
    const active = run([{ type: 'wake' }, { type: 'mute' }, { type: 'unmute' }]);
    expect(active.state).toBe('listening');
    const inactive = run([{ type: 'mute' }, { type: 'unmute' }]);
    expect(inactive.state).toBe('idle');
  });

  it('permissionRequired and offline are handled', () => {
    expect(voiceSessionReducer(INITIAL_SESSION, { type: 'permissionRequired' }).state).toBe(
      'permission-required',
    );
    expect(voiceSessionReducer(INITIAL_SESSION, { type: 'offline' }).state).toBe('offline');
  });

  it('reset returns to the initial session', () => {
    const s = run([{ type: 'wake' }, { type: 'finalTranscript', text: 'x' }, { type: 'reset' }]);
    expect(s).toEqual(INITIAL_SESSION);
  });
});

// ── Command parser ──────────────────────────────────────────────────────────

describe('parseVoiceCommand', () => {
  it('detects stop/cancel/pause and marks them as speech-interrupting', () => {
    for (const word of ['stop', 'cancel', 'pause']) {
      const cmd = parseVoiceCommand(word);
      expect(cmd).toBe(word);
      expect(interruptsSpeech(cmd)).toBe(true);
    }
  });

  it('detects goodbye and marks it as session-ending', () => {
    expect(parseVoiceCommand('goodbye NeuroPause')).toBe('goodbye');
    expect(endsSession('goodbye')).toBe(true);
  });

  it('detects repeat, continue, start over, thank you', () => {
    expect(parseVoiceCommand('say that again')).toBe('repeat');
    expect(parseVoiceCommand('keep going')).toBe('continue');
    expect(parseVoiceCommand('start over')).toBe('start-over');
    expect(parseVoiceCommand('thanks')).toBe('thank-you');
  });

  it('returns none for a normal request (handled by the brain)', () => {
    expect(parseVoiceCommand('how is engineering')).toBe('none');
    expect(parseVoiceCommand('')).toBe('none');
  });

  it('start-over interrupts speech; thank-you and repeat do not', () => {
    expect(interruptsSpeech('start-over')).toBe(true);
    expect(interruptsSpeech('thank-you')).toBe(false);
    expect(interruptsSpeech('repeat')).toBe(false);
  });
});
