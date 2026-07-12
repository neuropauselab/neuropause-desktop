/**
 * Slack Socket Mode transport (P5 — Increment 2) — the desktop-native realtime path.
 *
 * Socket Mode lets a desktop app receive Slack events over an OUTBOUND WebSocket with NO public URL:
 * we exchange an app-level token for a WSS url (`apps.connections.open`), connect, and Slack streams
 * event envelopes down the socket. Each envelope is ACKed by id immediately (Slack requires an ack
 * within 3s); `events_api` / `slash_commands` / `interactive` envelopes are handed to the sink (which
 * triggers a targeted sync). The socket is trusted because it was opened with our app token, so no HMAC
 * is needed on this path. On a `disconnect` control frame or a socket close we reconnect with bounded
 * backoff.
 *
 * Fully dependency-injected — the connection opener, the socket factory, the event sink, the timer —
 * so it unit-tests against a fake socket with no network, and it stays inert unless an app-level token
 * is configured.
 */
import { createLogger } from '../../logger';

const log = createLogger('slack-socket');

/** The subset of a WebSocket the client uses; the real global `WebSocket` satisfies it. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: unknown) => void): void;
}

export interface SlackSocketModeDeps {
  /** App-level token (`xapp-…`) used to open the connection. */
  appToken: string;
  /** POST apps.connections.open with the app token → the WSS url. Injected for tests. */
  openConnection: (appToken: string) => Promise<string>;
  /** Open a socket to the WSS url. Injected for tests (real: `(u) => new WebSocket(u)`). */
  connect: (url: string) => SocketLike;
  /** Called with each `events_api`/`slash_commands`/`interactive` payload (already ACKed). */
  onEvent: (payload: unknown) => void;
  /** Reconnect backoff schedule in ms (index clamped to last). */
  backoffMs?: number[];
  /** Schedule a delayed reconnect. Injected for tests (real: setTimeout). */
  setTimer?: (fn: () => void, ms: number) => void;
}

const DEFAULT_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000];

interface SlackEnvelope {
  type?: string; // 'hello' | 'disconnect' | 'events_api' | 'slash_commands' | 'interactive'
  envelope_id?: string;
  payload?: unknown;
}

export class SlackSocketMode {
  private socket: SocketLike | null = null;
  private stopped = false;
  private failures = 0;

  constructor(private readonly deps: SlackSocketModeDeps) {}

  /** Open the connection and begin streaming. Use stop() to tear down. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.openOnce();
  }

  stop(): void {
    this.stopped = true;
    this.closeSocket();
  }

  private async openOnce(): Promise<void> {
    if (this.stopped) return;
    let url: string;
    try {
      url = await this.deps.openConnection(this.deps.appToken);
    } catch (err) {
      log.warn('apps.connections.open failed; will retry', { err });
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    try {
      const socket = this.deps.connect(url);
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.failures = 0;
        log.info('Slack Socket Mode connected');
      });
      socket.addEventListener('message', (ev) => this.onMessage(socket, ev));
      socket.addEventListener('close', () => this.onClose(socket));
      socket.addEventListener('error', () => log.warn('Slack Socket Mode socket error')); // close follows; reconnect there
    } catch (err) {
      // A socket-construction failure (e.g. no WebSocket implementation) must degrade to a bounded
      // retry like every other openOnce failure — never escape as an unhandled rejection.
      log.warn('Slack socket construction failed; will retry', { err });
      this.scheduleReconnect();
    }
  }

  private onMessage(socket: SocketLike, ev: unknown): void {
    const data = extractData(ev);
    if (data == null) return;
    let env: SlackEnvelope;
    try {
      env = JSON.parse(data) as SlackEnvelope;
    } catch {
      return;
    }
    // ACK the RECEIVING socket immediately (Slack drops the connection if not ACKed within 3s).
    if (env.envelope_id) {
      try {
        socket.send(JSON.stringify({ envelope_id: env.envelope_id }));
      } catch {
        /* socket may be closing; the reconnect path recovers */
      }
    }
    if (env.type === 'disconnect') {
      this.reconnect(); // Slack asks us to reconnect (server refresh)
      return;
    }
    if (env.type === 'events_api' || env.type === 'slash_commands' || env.type === 'interactive') {
      try {
        this.deps.onEvent(env.payload);
      } catch (err) {
        log.warn('Slack event sink threw', { err });
      }
    }
  }

  private onClose(socket: SocketLike): void {
    // Only the CURRENT socket closing unexpectedly should schedule a reconnect. A socket we already
    // replaced (intentional reconnect on a `disconnect` frame) must be ignored — otherwise its trailing
    // close event double-opens the connection and leaks a zombie socket on every Slack server refresh.
    if (socket !== this.socket) return;
    this.socket = null;
    if (!this.stopped) this.scheduleReconnect();
  }

  private reconnect(): void {
    this.closeSocket();
    if (!this.stopped) void this.openOnce();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const schedule = this.deps.backoffMs ?? DEFAULT_BACKOFF_MS;
    const ms = schedule[Math.min(this.failures, schedule.length - 1)] ?? DEFAULT_BACKOFF_MS[0]!;
    this.failures += 1;
    const timer = this.deps.setTimer ?? ((fn, delay) => void setTimeout(fn, delay));
    timer(() => void this.openOnce(), ms);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null; // null FIRST so the ensuing close() (sync OR async) is seen as intentional by onClose
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Pull the string payload out of a WebSocket 'message' event (real events wrap it in `.data`). */
function extractData(ev: unknown): string | null {
  if (typeof ev === 'string') return ev;
  const d = (ev as { data?: unknown })?.data;
  return typeof d === 'string' ? d : null;
}
