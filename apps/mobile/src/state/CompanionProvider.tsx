/**
 * CompanionProvider (Mobile M1-09) — the one React context that owns the sealed
 * client and drives the launch/auth state machine. It wires the pure pieces to
 * their native side effects:
 *   • device identity + session  → keyStore (expo-secure-store)
 *   • unlock                      → biometrics (expo-local-authentication)
 *   • pairing / rpc               → CompanionClient over the HTTP transport
 * The reducer (companionMachine) decides phases; this component only performs
 * effects and feeds events in. No enterprise data is fetched here — screens call
 * `rpc(...)` once the phase is `ready`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { decodePairingQr, type CompanionEventFrame } from '@neuropause/companion-protocol';
import { CompanionClient, deviceKeysFromB64, type CompanionSession } from '../lib/sealedClient';
import { httpTransport, openEventSocket } from '../lib/transport';
import { requireUnlock } from '../lib/biometrics';
import {
  clearSession,
  loadDevicePrivB64,
  loadSession,
  saveDevicePrivB64,
  saveSession,
} from '../lib/keyStore';
import {
  companionReducer,
  initialCompanionState,
  type CompanionMachineState,
} from './companionMachine';

const APP_VERSION = '0.1.0';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function deviceName(): string {
  return Platform.OS === 'android' ? 'Android · NeuroPause' : 'iPhone · NeuroPause';
}

export interface CompanionContextValue extends CompanionMachineState {
  session: CompanionSession | null;
  /** Scan → pair from QR text; throws on a bad code or an unreachable desktop. */
  pair: (qrText: string) => Promise<void>;
  /** Prompt Face ID / Touch ID; advances locked → ready on success. */
  unlock: () => Promise<void>;
  /** Forget the paired session (keeps the device identity key). */
  signOut: () => Promise<void>;
  /** Re-run boot after an error. */
  retry: () => void;
  /** Invoke an authenticated desktop op over the sealed channel. */
  rpc: <T = unknown>(op: string, params?: unknown) => Promise<T>;
  /** Subscribe to live desktop events (WS push); returns an unsubscribe fn. */
  subscribeEvents: (cb: (frame: CompanionEventFrame) => void) => () => void;
}

const CompanionContext = createContext<CompanionContextValue | null>(null);

export function CompanionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(companionReducer, initialCompanionState);
  const clientRef = useRef<CompanionClient | null>(null);
  const sessionRef = useRef<CompanionSession | null>(null);
  const mounted = useRef(true);
  const listenersRef = useRef<Set<(frame: CompanionEventFrame) => void>>(new Set());

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const boot = useCallback(async () => {
    try {
      const priv = await loadDevicePrivB64();
      const restored = deviceKeysFromB64(priv);
      if (!priv) await saveDevicePrivB64(restored.privB64);
      const saved = await loadSession();
      const client = new CompanionClient(restored.keys, httpTransport);
      if (saved) {
        client.restore(saved);
        sessionRef.current = saved;
      }
      clientRef.current = client;
      if (mounted.current) dispatch({ type: 'booted', hasSession: Boolean(saved) });
    } catch (err) {
      if (mounted.current) dispatch({ type: 'failed', message: errMsg(err) });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Live push: while paired + unlocked, hold a sealed WS to the desktop's
  // /events channel and fan frames out to subscribers. Reconnects on drop;
  // closes on lock / sign-out / unmount (the effect re-runs on phase change).
  useEffect(() => {
    if (state.phase !== 'ready') return;
    const client = clientRef.current;
    const session = sessionRef.current;
    if (!client || !session) return;
    let socket: WebSocket | null = null;
    let closing = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      try {
        socket = openEventSocket({
          host: session.host,
          port: session.port,
          sealedHello: client.sealHello(),
          onFrame: (raw) => {
            try {
              const frame = client.openEvent(raw);
              listenersRef.current.forEach((cb) => cb(frame));
            } catch {
              /* ignore a malformed or unauthenticated frame */
            }
          },
          onClose: () => {
            if (closing || retry) return;
            retry = setTimeout(() => {
              retry = null;
              if (!closing) open();
            }, 3000);
          },
        });
      } catch {
        /* sealHello throws only without a session; ignore */
      }
    };
    open();
    return () => {
      closing = true;
      if (retry) clearTimeout(retry);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
    };
  }, [state.phase]);

  const unlock = useCallback(async () => {
    try {
      if (await requireUnlock()) dispatch({ type: 'unlocked' });
    } catch (err) {
      dispatch({ type: 'failed', message: errMsg(err) });
    }
  }, []);

  const pair = useCallback(async (qrText: string) => {
    const client = clientRef.current;
    if (!client) throw new Error('The app is still starting — try again in a moment.');
    const qr = decodePairingQr(qrText);
    const session = await client.pair(qr, {
      name: deviceName(),
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      appVersion: APP_VERSION,
    });
    await saveSession(session);
    sessionRef.current = session;
    dispatch({ type: 'paired' });
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    sessionRef.current = null;
    dispatch({ type: 'signedOut' });
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: 'retry' });
    void boot();
  }, [boot]);

  const rpc = useCallback(async <T,>(op: string, params?: unknown): Promise<T> => {
    const client = clientRef.current;
    if (!client) throw new Error('The app is still starting — try again in a moment.');
    return client.rpc<T>(op, params);
  }, []);

  const subscribeEvents = useCallback((cb: (frame: CompanionEventFrame) => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const value = useMemo<CompanionContextValue>(
    () => ({
      ...state,
      session: sessionRef.current,
      pair,
      unlock,
      signOut,
      retry,
      rpc,
      subscribeEvents,
    }),
    [state, pair, unlock, signOut, retry, rpc, subscribeEvents],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue {
  const ctx = useContext(CompanionContext);
  if (!ctx) throw new Error('useCompanion must be used within a CompanionProvider.');
  return ctx;
}
