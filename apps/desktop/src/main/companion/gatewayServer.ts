/**
 * Companion Gateway server (Mobile M1-03) — the LAN front door a paired phone
 * reaches. HTTP only in M1-03; realtime WebSocket push arrives in M1-06.
 *
 * Every request and response body is an end-to-end SEALED envelope
 * (@neuropause/companion-protocol): the transport carries ciphertext, the
 * desktop's static X25519 identity is the pinned trust root, and each paired
 * device is pinned by its own static key (learned out of band via the pairing
 * QR — trust on first use). The gateway:
 *
 *   • /pair  — verifies a one-time QR token inside a sealed PairingRequest,
 *              registers the device, seals back a PairingResponse.
 *   • /rpc   — authenticates the sender against the device registry, enforces
 *              the replay guard, refuses when the desktop is signed out, then
 *              dispatches a small op table (reads → view-models; writes are
 *              added by later increments and go through the secure pipeline).
 *   • /health— an unauthenticated reachability probe (protocol version only).
 *
 * `handlePairing` / `handleRpc` are pure of the socket so they unit-test
 * directly. Binding to the LAN is deliberate and safe: unpaired or unknown
 * senders are refused, and nothing but ciphertext crosses the wire.
 */
import type { Duplex } from 'node:stream';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  CompanionRequestSchema,
  COMPANION_PROTOCOL_VERSION,
  DEFAULT_MAX_SKEW_MS,
  PairingRequestSchema,
  checkReplay,
  companionErrorCode,
  errResponse,
  fromB64,
  generatePairingToken,
  encodePairingQr,
  okResponse,
  seal,
  toB64,
  unseal,
  verifyPairingToken,
  type CompanionEventFrame,
  type CompanionKeyPair,
  type PairingResponse,
  type SealedEnvelope,
} from '@neuropause/companion-protocol';
import type { CompanionPairingQrDto, PlatformEvent } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { CompanionDeviceRecord, CompanionDeviceStore } from './deviceRegistryStore';
import { principalForOwnedWork } from '../tenancy/backgroundFanOut';
import { runAsPrincipal } from '../tenancy/backgroundPrincipal';

const log = createLogger('companion-gateway');

const MAX_BODY_BYTES = 256 * 1024;
const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;
const WS_AUTH_TIMEOUT_MS = 10_000;

/** Normalize a ws payload (Buffer | ArrayBuffer | Buffer[]) to text. */
function wsDataToText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export interface CompanionOpContext {
  device: CompanionDeviceRecord;
  now: string;
}

/** An authenticated op the phone can invoke. Later increments add entries. */
export type CompanionOpHandler = (params: unknown, ctx: CompanionOpContext) => Promise<unknown>;
export type CompanionOpTable = Record<string, CompanionOpHandler>;

export interface CompanionGatewayDeps {
  identity: CompanionKeyPair;
  devices: CompanionDeviceStore;
  /** The desktop has a signed-in session (the gateway refuses requests otherwise). */
  isSignedIn: () => boolean;
  /** Desktop session email to bind a device to at pairing (null when signed out). */
  currentMember: () => string | null;
  /** The tenant to bind a device to at pairing. Null when none resolves. */
  currentTenantId: () => string | null;
  desktopName: () => string;
  orgName: () => string;
  ops: CompanionOpTable;
  now?: () => number;
}

type GatewayResult = { ok: true; envelope: SealedEnvelope } | { ok: false; httpStatus: number };

/**
 * A minted, not-yet-redeemed pairing capability.
 *
 * P13C ROUND 11 — M-9. THE OWNER IS PART OF THE CAPABILITY, NOT OF THE MOMENT IT
 * IS SPENT. A QR was stamped with `orgName()` at MINT time and `handlePairing`
 * resolved `currentTenantId()` at REDEEM time, up to five minutes later, with
 * nothing clearing this map on a workspace switch. So a code that said "Alpha"
 * bound the phone into Beta whenever the desktop user switched inside the
 * window — silently, and the phone was then told "Beta" in its pairing response,
 * so neither side could tell that the answer had changed underneath them.
 *
 * Recording both here makes the two reads the same read.
 */
interface PendingToken {
  token: Uint8Array;
  expIso: string;
  /** The tenant that authorized this pairing. `null` = none resolved at mint. */
  tenantId: string | null;
  /** The organization name PRINTED IN THE QR, so the response cannot disagree. */
  orgName: string;
}

/** First non-internal IPv4 address, or null when only loopback is available. */
export function detectLanHost(): string | null {
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

export class CompanionGateway {
  private server: Server | null = null;
  private boundPort: number | null = null;
  private boundHost: string | null = null;
  private readonly pending = new Map<string, PendingToken>();
  private readonly responseSeq = new Map<string, number>();
  private wss: WebSocketServer | null = null;
  /** Live realtime sockets per paired device id. */
  private readonly sockets = new Map<string, Set<WebSocket>>();

  constructor(private readonly deps: CompanionGatewayDeps) {}

  private nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  address(): { host: string | null; port: number | null } {
    return { host: this.boundHost, port: this.boundPort };
  }

  /**
   * Mint a one-time pairing token and the QR text the phone scans.
   *
   * P13C ROUND 11 — M-9. The organization is captured HERE, alongside the token,
   * because this is the moment the authorization happens: `companion:pairingQr`
   * is `org:manage`, so whoever minted this held that right in THIS organization
   * and in no other. `handlePairing` spends what was minted.
   */
  mintPairingQr(port: number): CompanionPairingQrDto {
    const host = detectLanHost() ?? '127.0.0.1';
    const { token, tokenB64 } = generatePairingToken();
    const expIso = new Date(this.nowMs() + PAIRING_TOKEN_TTL_MS).toISOString();
    const orgName = this.deps.orgName();
    this.prunePending();
    this.pending.set(tokenB64, {
      token,
      expIso,
      tenantId: this.deps.currentTenantId(),
      orgName,
    });
    const qr = encodePairingQr({
      v: COMPANION_PROTOCOL_VERSION,
      host,
      port,
      name: this.deps.desktopName(),
      org: orgName,
      dpk: toB64(this.deps.identity.publicKey),
      token: tokenB64,
      exp: expIso,
    });
    return { qr, host, port, expiresAt: expIso };
  }

  private prunePending(): void {
    const now = this.nowMs();
    for (const [key, entry] of this.pending) {
      const exp = Date.parse(entry.expIso);
      if (!Number.isFinite(exp) || now > exp) this.pending.delete(key);
    }
  }

  /**
   * Consume the first pending token that matches (single-use, constant-time).
   *
   * Returns the CAPABILITY rather than a boolean (P13C Round 11 — M-9) so the
   * caller binds the device to the organization that authorized the pairing. A
   * boolean forced `handlePairing` to go and ask the live resolver, which is
   * precisely the wrong question at redeem time.
   */
  private consumePairingToken(presentedB64: string): PendingToken | null {
    const nowIso = this.nowIso();
    for (const [key, entry] of this.pending) {
      if (
        verifyPairingToken({ presentedB64, expected: entry.token, nowIso, expIso: entry.expIso })
      ) {
        this.pending.delete(key);
        return entry;
      }
    }
    return null;
  }

  /** Handle a sealed PairingRequest → sealed PairingResponse. Socket-free. */
  async handlePairing(rawEnvelope: unknown): Promise<GatewayResult> {
    let opened;
    try {
      opened = unseal({ envelope: rawEnvelope, recipientKeys: this.deps.identity });
    } catch {
      return { ok: false, httpStatus: 400 };
    }
    const parsed = PairingRequestSchema.safeParse(opened.body);
    if (!parsed.success) return { ok: false, httpStatus: 400 };
    const capability = this.consumePairingToken(parsed.data.token);
    if (capability === null) {
      log.warn('Companion pairing rejected: bad or expired token');
      return { ok: false, httpStatus: 401 };
    }
    const now = this.nowIso();
    const device = await this.deps.devices.register({
      name: parsed.data.device.name,
      platform: parsed.data.device.platform,
      model: parsed.data.device.model ?? null,
      publicKeyB64: toB64(opened.senderPublicKey),
      boundMember: this.deps.currentMember(),
      // P13C Part 3 — a device is a companion to one ORGANIZATION's work, not
      // to the machine. Captured at pairing so the event push can ask whether
      // an event is this device's to receive.
      //
      // P13C ROUND 11 — M-9. The owner is the organization that MINTED this QR,
      // not whichever one is open now. `boundTenantId` keeps the live reading
      // only as the value the store ignores in favour of `mintedTenantId`; the
      // two are passed together deliberately, so a reader can see that the
      // question changed rather than that an argument moved.
      boundTenantId: this.deps.currentTenantId(),
      mintedTenantId: capability.tenantId,
      now,
    });
    const response: PairingResponse = {
      kind: 'pairing-response',
      deviceId: device.id,
      desktopName: this.deps.desktopName(),
      // The name the QR printed, so the phone's stored session label names the
      // organization it was actually bound into.
      orgName: capability.orgName,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
    };
    log.info('Companion device paired', { deviceId: device.id, platform: device.platform });
    return { ok: true, envelope: this.sealTo(opened.senderPublicKey, device.id, response) };
  }

  /** Handle a sealed CompanionRequest → sealed CompanionResponse. Socket-free. */
  async handleRpc(rawEnvelope: unknown): Promise<GatewayResult> {
    let opened;
    try {
      opened = unseal({ envelope: rawEnvelope, recipientKeys: this.deps.identity });
    } catch {
      return { ok: false, httpStatus: 400 };
    }
    const device = this.deps.devices.activeByPublicKey(toB64(opened.senderPublicKey));
    if (!device) return { ok: false, httpStatus: 403 };

    const replay = checkReplay({
      seq: opened.seq,
      sentAt: opened.sentAt,
      nowMs: this.nowMs(),
      state: { lastSeq: device.lastSeq },
    });
    if (!replay.ok) {
      return this.sealError(
        device,
        'unknown-request',
        'replay',
        'Message rejected by the replay guard.',
      );
    }
    if (!this.deps.isSignedIn()) {
      return this.sealError(
        device,
        'unknown-request',
        'not-signed-in',
        'Sign in on the desktop to continue.',
      );
    }
    const parsed = CompanionRequestSchema.safeParse(opened.body);
    if (!parsed.success) {
      return this.sealError(device, 'unknown-request', 'invalid', 'Malformed companion request.');
    }
    const op = this.deps.ops[parsed.data.op];
    if (!op) {
      return this.sealError(device, parsed.data.id, 'not-found', `Unknown op: ${parsed.data.op}`);
    }
    await this.deps.devices.touch(device.id, opened.seq, this.nowIso());

    /**
     * P13C ROUND 3 — THE OP RUNS AS THE DEVICE'S OWN TENANT.
     *
     * The push path got this right: `:418` refuses to send an event whose owner
     * is not `device.boundTenantId`. The PULL path did not — it invoked the op
     * with no principal, so every read resolved through the desktop's ambient
     * `activeTenantScope()`.
     *
     * The attack that leaves: a phone paired while organization A was open stays
     * bound to A. The desktop user later switches to B. The A-bound phone calls
     * `dashboard.family`, `timeline.list`, `search.query` or `briefing.get` and
     * receives B's records — over a socket bound to 0.0.0.0, which makes this
     * external egress rather than a local disclosure. `approvals.act` makes it a
     * cross-tenant WRITE.
     *
     * A device with no bound tenant is REFUSED rather than run ambiently. That
     * is a pre-P13C pairing, and running it as whoever is currently signed in is
     * precisely the guess this program does not make. Re-pairing restores it.
     */
    const boundTenantId = device.boundTenantId ?? null;
    if (boundTenantId === null || boundTenantId === '') {
      return this.sealError(
        device,
        parsed.data.id,
        'not-signed-in',
        'This device is not bound to an organization. Pair it again from the desktop.',
      );
    }
    const principal = principalForOwnedWork({
      jobId: `companion:${parsed.data.op}`,
      tenantId: boundTenantId,
      workspaceId: null,
    });
    if (principal === null) {
      return this.sealError(device, parsed.data.id, 'not-signed-in', 'This device has no organization.');
    }

    try {
      const result = await runAsPrincipal(principal, async () =>
        op(parsed.data.params, { device, now: this.nowIso() }),
      );
      return { ok: true, envelope: this.sealResponse(device, okResponse(parsed.data.id, result)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error.';
      return this.sealError(device, parsed.data.id, companionErrorCode(err), message);
    }
  }

  private sealError(
    device: CompanionDeviceRecord,
    id: string,
    code: Parameters<typeof errResponse>[1],
    message: string,
  ): GatewayResult {
    return { ok: true, envelope: this.sealResponse(device, errResponse(id, code, message)) };
  }

  private nextResponseSeq(deviceId: string): number {
    const next = (this.responseSeq.get(deviceId) ?? -1) + 1;
    this.responseSeq.set(deviceId, next);
    return next;
  }

  private sealResponse(device: CompanionDeviceRecord, body: unknown): SealedEnvelope {
    return seal({
      body,
      seq: this.nextResponseSeq(device.id),
      sentAt: this.nowIso(),
      senderKeys: this.deps.identity,
      recipientPublicKey: fromB64(device.publicKeyB64),
    });
  }

  private sealTo(recipientPublicKey: Uint8Array, deviceId: string, body: unknown): SealedEnvelope {
    return seal({
      body,
      seq: this.nextResponseSeq(deviceId),
      sentAt: this.nowIso(),
      senderKeys: this.deps.identity,
      recipientPublicKey,
    });
  }

  async start(port: number): Promise<{ host: string | null; port: number }> {
    if (this.server) return { host: this.boundHost, port: this.boundPort ?? port };
    const server = createServer((req, res) => {
      void this.route(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // Bind all interfaces so a LAN phone can reach it; every payload is sealed.
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.boundPort = port;
    this.boundHost = detectLanHost();
    // M1-06b — realtime push over the same LAN socket: the phone authenticates
    // with one sealed frame, then receives sealed event frames.
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
    log.info('Companion gateway listening', { host: this.boundHost, port });
    return { host: this.boundHost, port };
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.boundPort = null;
    this.boundHost = null;
    this.pending.clear();
    for (const set of this.sockets.values()) for (const ws of set) ws.close(1001);
    this.sockets.clear();
    this.wss?.close();
    this.wss = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    log.info('Companion gateway stopped');
  }

  /**
   * Authenticate a WS hello: unseal + match a paired, non-revoked device. Socket-free.
   *
   * P13C ROUND 11 — M-9. THE HELLO IS FRESHNESS-CHECKED; `/rpc` ALSO CHECKS THE
   * SEQUENCE, AND THIS DELIBERATELY DOES NOT. THE DIFFERENCE IS STATED RATHER
   * THAN GLOSSED.
   *
   * WHAT WAS WRONG. `/rpc` runs `checkReplay`, and this ran nothing. The gateway
   * listens on `0.0.0.0` and the WebSocket carries the sealed envelope as
   * plaintext JSON over TCP, so an on-path listener can capture a hello frame
   * verbatim. Replaying it opened a socket authenticated AS THAT DEVICE, which
   * then received that organization's live event pushes — `EventResource` carries
   * record ids and names. Indefinitely, because nothing about the frame expired.
   *
   * WHAT IS FIXED HERE. The `sentAt` inside the seal must be within the same
   * clock-skew window `/rpc` enforces, so a captured frame stops working after
   * ninety seconds instead of never. `sentAt` travels INSIDE the ciphertext
   * (see envelope.ts), so it cannot be edited without the device's key.
   *
   * WHAT IS NOT FIXED HERE, AND WHY IT IS NOT SILENTLY LEFT OUT. The full guard
   * is monotonic-sequence, and the phone cannot currently satisfy it: the mobile
   * client's `sealHello()` sends `seq: 0` HARDCODED on every connect while its
   * RPC counter advances, both against the one `device.lastSeq` high-water mark.
   * Enforcing the sequence here would refuse every reconnect after the phone's
   * first RPC — a product break, not a fix — so closing it needs a matching
   * change in `apps/mobile/src/lib/sealedClient.ts` (a per-channel counter, or a
   * hello nonce). Reported as an open item rather than half-done under a comment
   * that claims otherwise.
   */
  authenticateWsFrame(rawEnvelope: unknown): CompanionDeviceRecord | null {
    let opened;
    try {
      opened = unseal({ envelope: rawEnvelope, recipientKeys: this.deps.identity });
    } catch {
      return null;
    }
    const sentMs = Date.parse(opened.sentAt);
    if (!Number.isFinite(sentMs) || Math.abs(this.nowMs() - sentMs) > DEFAULT_MAX_SKEW_MS) {
      return null;
    }
    return this.deps.devices.activeByPublicKey(toB64(opened.senderPublicKey));
  }

  /**
   * Close every live socket belonging to a device. P13C ROUND 11 — M-9.
   *
   * Revocation tombstoned the row and left the socket OPEN. Every other door
   * consulted the tombstone immediately — `activeByPublicKey` excludes revoked
   * devices, so `/rpc` and any new `/events` connection were refused — but an
   * ALREADY-ESTABLISHED socket was only torn down opportunistically, inside
   * `broadcastEvent`, on the next event that happened to arrive. On a quiet
   * install that is never, and "unpair this phone" has to mean the phone is off
   * the wire now, not off it at the convenience of the next event.
   *
   * Idempotent and safe on an unknown id, because the revoke handler calls it
   * whether or not the gateway is running.
   */
  disconnectDevice(deviceId: string): void {
    const set = this.sockets.get(deviceId);
    if (!set) return;
    for (const ws of set) ws.close(4401);
    this.sockets.delete(deviceId);
  }

  /** Seal a realtime event frame to a device (socket-free; tested directly). */
  encodeEventFrame(
    device: CompanionDeviceRecord,
    type: string,
    at: string,
    data: unknown,
  ): SealedEnvelope {
    const frame: CompanionEventFrame = { kind: 'event', type, at, data };
    return this.sealResponse(device, frame);
  }

  /**
   * Push a platform event to the devices ENTITLED TO IT.
   *
   * P13C PART 3 — THIS WAS AN UNSCOPED CROSS-TENANT PUSH, OVER THE NETWORK.
   *
   * The subscription is the whole bus, and this method pushed every event it
   * received to every live socket of every paired device. `PlatformEvent`
   * has carried a `tenantId` since Program 13B and this function never read it.
   * `EventResource` carries record ids and NAMES, and `EventActor` carries
   * identity — so a phone paired while tenant A was open received tenant B's
   * record names for as long as it stayed connected.
   *
   * It is the same defect Part 2a closed in the webhook producer — one event
   * fanned to every destination regardless of ownership — on a different
   * transport, and a worse one: this leaves the machine over a LAN socket to a
   * device with no tenant selector and no way to know which organization it is
   * being told about.
   *
   * The rule is the webhook rule: the destination is selected BY THE EVENT'S
   * OWNER. A device receives an event when its bound tenant matches, and never
   * otherwise. Two deliberate consequences:
   *
   *  · A SYSTEM event reaches every device. `scopeKind: 'system'` is stamped
   *    only from a system principal, which carries no tenant and so cannot have
   *    read customer data into its payload — the same reasoning the notification
   *    broadcast uses.
   *  · An UNOWNED event reaches nobody. Events published before 13B, or with no
   *    tenant resolvable, have no owner; pushing one would mean choosing a
   *    recipient, and every available choice is someone not entitled to it.
   */
  broadcastEvent(event: PlatformEvent): void {
    if (this.sockets.size === 0) return;
    const isSystem = event.scopeKind === 'system';
    const owner = event.tenantId ?? null;
    // Unowned and not system: nobody may have it. Returning early also avoids
    // walking every socket to decide nothing.
    if (!isSystem && (owner === null || owner === '')) return;

    const data = {
      resource: event.resource,
      actor: event.actor,
      priority: event.priority,
      category: event.category,
    };
    for (const [deviceId, set] of this.sockets) {
      // `getForDelivery`, not `get`: this loop has no session, and the ownership
      // decision below is a comparison of two STORED owners rather than of the
      // reader's scope. See the note on the accessor.
      const device = this.deps.devices.getForDelivery(deviceId);
      if (!device || device.revoked) {
        for (const ws of set) ws.close(4401);
        this.sockets.delete(deviceId);
        continue;
      }
      /**
       * A device paired before `boundTenantId` existed has no tenant, and is
       * NOT adopted into the event's — that would be the "first tenant to send
       * it something claims it" fallback. It gets system events only, until it
       * is paired again.
       */
      if (!isSystem && (device.boundTenantId ?? null) !== owner) continue;
      let text: string;
      try {
        text = JSON.stringify(this.encodeEventFrame(device, event.type, event.timestamp, data));
      } catch {
        continue;
      }
      for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }

  /**
   * P13C ROUND 11 — M-9. A BROWSER MAY NOT OPEN THIS SOCKET.
   *
   * `handleUpgrade` validated the PATH and nothing else, on a listener bound to
   * `0.0.0.0`. WebSocket handshakes are not subject to the same-origin policy —
   * a page on any origin the user visits can open a socket to
   * `ws://<lan-ip>:47600/events` and the browser will send the request. It cannot
   * authenticate, because the hello must be sealed to the desktop's static key
   * and the page has no device private key, so the disclosure risk is bounded by
   * that seal. What it CAN do without one is consume a connection slot and hold
   * it for the ten-second auth window, from any tab, in a loop.
   *
   * A browser is required to send `Origin`; the phone's native client does not.
   * So the presence of the header is the signal, and refusing on it costs the
   * real client nothing. Refused at the upgrade, before `ws` allocates anything.
   *
   * NOT CLAIMED: this is not an authentication check and does not replace one —
   * a non-browser attacker simply omits the header. It removes the one caller who
   * cannot omit it, which is the one that can be aimed by a link.
   */
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (req.url !== '/events' || !this.wss || req.headers.origin !== undefined) {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onWsConnection(ws));
  }

  private onWsConnection(ws: WebSocket): void {
    // The phone must authenticate with a single sealed frame promptly, or we drop it.
    const timer = setTimeout(() => ws.close(4408), WS_AUTH_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    ws.once('message', (raw: RawData) => {
      clearTimeout(timer);
      let envelope: unknown;
      try {
        envelope = JSON.parse(wsDataToText(raw));
      } catch {
        ws.close(4400);
        return;
      }
      const device = this.authenticateWsFrame(envelope);
      if (!device || !this.deps.isSignedIn()) {
        ws.close(4401);
        return;
      }
      const set = this.sockets.get(device.id) ?? new Set<WebSocket>();
      set.add(ws);
      this.sockets.set(device.id, set);
      ws.on('close', () => {
        set.delete(ws);
        if (set.size === 0) this.sockets.delete(device.id);
      });
    });
    ws.on('error', () => {
      clearTimeout(timer);
      ws.close();
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return this.send(res, 200, { status: 'ok', protocol: COMPANION_PROTOCOL_VERSION });
      }
      if (req.method === 'POST' && (req.url === '/pair' || req.url === '/rpc')) {
        const body = await this.readBody(req);
        if (body === null) return this.sendEmpty(res, 413);
        let envelope: unknown;
        try {
          envelope = JSON.parse(body);
        } catch {
          return this.sendEmpty(res, 400);
        }
        const result =
          req.url === '/pair' ? await this.handlePairing(envelope) : await this.handleRpc(envelope);
        if (!result.ok) return this.sendEmpty(res, result.httpStatus);
        return this.send(res, 200, result.envelope);
      }
      return this.sendEmpty(res, 404);
    } catch (err) {
      log.error('Companion gateway route error', { error: String(err) });
      this.sendEmpty(res, 500);
    }
  }

  private readBody(req: IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private sendEmpty(res: ServerResponse, status: number): void {
    res.writeHead(status);
    res.end();
  }
}
