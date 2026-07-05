/**
 * Floating Voice Widget (V2.7) — RENDERER.
 *
 * ⚠️ VERIFICATION NOTE: this component drives real audio (mic/STT/TTS) and animated
 * UI. It CANNOT be visually or behaviorally verified in the CI container (no mic,
 * no audio, no headless browser). It typechecks and follows the existing renderer
 * conventions, but its appearance and audio behavior MUST be verified on macOS by
 * running the app. Production-shaped scaffold pending on-device verification.
 *
 * Composition (reuses everything already built):
 *   - voiceSessionReducer / parseVoiceCommand  (V2.7 tested cores)
 *   - WebSpeechRecognizer / WebSpeechSynthesizer / requestMicPermission (audio svc)
 *   - ipc VoiceTurn → the V2.6 brain (intent routing + evidence-grounded response)
 *   - useShell().setSection → deep-link navigation (V2.5)
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { VoiceResponse } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { useShell } from '@renderer/state/ShellProvider';
import { deepLinkToSection } from '@renderer/enterprise/executiveCenterNav';
import { INITIAL_SESSION, isCapturing, voiceSessionReducer } from '@neuropause/shared';
import { parseVoiceCommand, interruptsSpeech, endsSession } from '@neuropause/shared';
import { voiceStateToRuntimeState } from '@neuropause/shared';
import { WebSpeechRecognizer, WebSpeechSynthesizer, requestMicPermission } from './voiceAudio';

/**
 * Note on imports from @main: the session machine + command parser are pure,
 * dependency-free modules. If the build restricts renderer→main imports, move
 * those two files to a shared location; they import nothing electron-specific.
 */

export function VoiceWidget(): JSX.Element | null {
  const { setSection } = useShell();
  const [session, dispatch] = useReducer(voiceSessionReducer, INITIAL_SESSION);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState<string>('');

  const recognizerRef = useRef<WebSpeechRecognizer | null>(null);
  const synthRef = useRef<WebSpeechSynthesizer | null>(null);

  useEffect(() => {
    recognizerRef.current = new WebSpeechRecognizer();
    synthRef.current = new WebSpeechSynthesizer();
    return () => {
      recognizerRef.current?.stop();
      synthRef.current?.cancel();
    };
  }, []);

  const handleFinal = useCallback(
    async (text: string) => {
      // In-conversation control commands take priority over routing.
      const command = parseVoiceCommand(text);
      if (interruptsSpeech(command)) {
        synthRef.current?.cancel();
        dispatch({ type: 'interrupt' });
        return;
      }
      if (endsSession(command)) {
        synthRef.current?.cancel();
        dispatch({ type: 'goodbye' });
        setReply('Goodbye.');
        return;
      }

      dispatch({ type: 'finalTranscript', text });
      let response: VoiceResponse;
      try {
        response = await ipc.intelligence.voiceTurn(text);
      } catch {
        dispatch({ type: 'error' });
        setReply('Something went wrong.');
        return;
      }
      dispatch({ type: 'thinkingDone' });
      setReply(response.speech);

      // Navigate if the response carries a deep-link (reuses V2.5 routing).
      if (response.deepLink) setSection(deepLinkToSection(response.deepLink));

      // Speak, then wait for a follow-up.
      dispatch({ type: 'speakStart' });
      await synthRef.current?.speak(response.speech);
      dispatch({ type: 'speakEnd' });
    },
    [setSection],
  );

  const startTurn = useCallback(async () => {
    const perm = await requestMicPermission();
    if (perm === 'denied') {
      dispatch({ type: 'permissionRequired' });
      return;
    }
    setOpen(true);
    dispatch({ type: 'wake' });
    dispatch({ type: 'startListening' });
    recognizerRef.current?.start(
      (partial) => dispatch({ type: 'partialTranscript', text: partial }),
      (final) => void handleFinal(final),
    );
  }, [handleFinal]);

  const close = useCallback(() => {
    recognizerRef.current?.stop();
    synthRef.current?.cancel();
    dispatch({ type: 'reset' });
    setOpen(false);
    setReply('');
  }, []);

  // V4.1: the runtime tray can start/pause listening from the menu bar. Wire its
  // commands into the same start/close paths (no duplicate voice logic).
  useEffect(() => {
    const unsubscribe = ipc.tray.onCommand((payload) => {
      if (payload.action === 'start-listening') void startTurn();
      else if (payload.action === 'pause-listening') close();
    });
    return unsubscribe;
  }, [startTurn, close]);

  // V5.2: report the live voice state up to main so NeuroCore's system-health
  // dashboard reflects real voice activity (idle/listening/thinking/speaking).
  useEffect(() => {
    void ipc.voice.reportStatus(voiceStateToRuntimeState(session.state)).catch(() => {});
  }, [session.state]);

  const capturing = isCapturing(session.state);

  return (
    <>
      {/* Launcher — a small mic button pinned bottom-right. */}
      <button
        onClick={() => (open ? close() : void startTurn())}
        aria-label={open ? 'Close voice assistant' : 'Talk to NeuroPause'}
        className={cn(
          'fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition',
          'border border-white/10 backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
          capturing ? 'bg-red-500/80' : 'bg-white/10 hover:bg-white/20',
        )}
      >
        <span
          className={cn(
            'h-2.5 w-2.5 rounded-full',
            capturing ? 'animate-pulse bg-white' : 'bg-white/70',
          )}
        />
      </button>

      {/* Floating panel — appears while a conversation is open. */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-80 rounded-2xl border border-white/10 bg-black/70 p-4 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-white/50">
              {stateLabel(session.state)}
            </span>
            <button
              onClick={close}
              className="text-white/40 hover:text-white/80"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {session.transcript && (
            <p className="mb-2 text-sm text-white/80">“{session.transcript}”</p>
          )}
          {reply && <p className="text-sm text-white">{reply}</p>}
          {!session.transcript && !reply && (
            <p className="text-sm text-white/40">
              Listening… ask about engineering, org health, risks, or your brief.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function stateLabel(state: string): string {
  switch (state) {
    case 'listening':
    case 'recognizing':
      return 'Listening';
    case 'thinking':
      return 'Thinking';
    case 'speaking':
      return 'Speaking';
    case 'waiting':
      return 'Your turn';
    case 'permission-required':
      return 'Microphone needed';
    case 'error':
      return 'Error';
    default:
      return 'Voice';
  }
}
