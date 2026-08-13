/**
 * The phone-side sealed client (Mobile M1-08). Pure over
 * @neuropause/companion-protocol + an injected transport, so it unit-tests in
 * plain Node against a simulated desktop (no React Native, no sockets). The RN
 * glue — the HTTP/WS transport (transport.ts) and the keychain-backed device
 * identity (keyStore.ts) — is injected, never imported here.
 *
 * Trust model (mirrors the desktop gateway): the device holds a static X25519
 * identity; pairing pins the desktop's static key (learned from the QR); every
 * request/response is a sealed envelope. A response is accepted only if it is
 * sealed BY the pinned desktop key (enforced in unseal) AND its id matches the
 * request we sent — so a replayed or mismatched response is rejected.
 */
import {
  CompanionEventFrameSchema,
  fromB64,
  generateIdentityKeyPair,
  publicKeyFromPrivateKey,
  seal,
  toB64,
  unseal,
  type CompanionEventFrame,
  type CompanionKeyPair,
  type CompanionResponse,
  type PairingQrPayload,
  type PairingResponse,
  type SealedEnvelope,
} from '@neuropause/companion-protocol';

export interface CompanionTransport {
  /** POST a sealed envelope; returns the sealed reply, or null on a non-200. */
  postSealed(
    host: string,
    port: number,
    path: '/pair' | '/rpc',
    envelope: SealedEnvelope,
  ): Promise<SealedEnvelope | null>;
}

export interface CompanionDeviceInfo {
  name: string;
  platform: 'ios' | 'android';
  model?: string;
  appVersion: string;
}

export interface CompanionSession {
  host: string;
  port: number;
  deviceId: string;
  desktopName: string;
  orgName: string;
  /** The pinned desktop static public key (base64url). */
  desktopPublicKeyB64: string;
}

/** Restore the device identity from a persisted private key, or mint a new one. */
export function deviceKeysFromB64(privB64: string | null): {
  keys: CompanionKeyPair;
  privB64: string;
} {
  if (privB64) {
    const privateKey = fromB64(privB64);
    return { keys: { privateKey, publicKey: publicKeyFromPrivateKey(privateKey) }, privB64 };
  }
  const keys = generateIdentityKeyPair();
  return { keys, privB64: toB64(keys.privateKey) };
}

export class CompanionClient {
  private seq = 0;

  constructor(
    private readonly keys: CompanionKeyPair,
    private readonly transport: CompanionTransport,
    private readonly now: () => number = Date.now,
    private session: CompanionSession | null = null,
  ) {}

  identityPublicKeyB64(): string {
    return toB64(this.keys.publicKey);
  }

  currentSession(): CompanionSession | null {
    return this.session;
  }

  /** Restore a persisted session (e.g. from the keychain) without re-pairing. */
  restore(session: CompanionSession): void {
    this.session = session;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Pair from a scanned QR; on success stores + returns the session. */
  async pair(qr: PairingQrPayload, device: CompanionDeviceInfo): Promise<CompanionSession> {
    const desktopPublicKey = fromB64(qr.dpk);
    const envelope = seal({
      body: { kind: 'pairing-request', token: qr.token, device },
      seq: 0,
      sentAt: this.nowIso(),
      senderKeys: this.keys,
      recipientPublicKey: desktopPublicKey,
    });
    const reply = await this.transport.postSealed(qr.host, qr.port, '/pair', envelope);
    if (!reply)
      throw new Error('Pairing failed — check the code and that the desktop gateway is on.');
    const opened = unseal({
      envelope: reply,
      recipientKeys: this.keys,
      expectedSenderPublicKey: desktopPublicKey,
    });
    const res = opened.body as PairingResponse | null;
    if (!res || res.kind !== 'pairing-response')
      throw new Error('The desktop sent a malformed pairing response.');
    const session: CompanionSession = {
      host: qr.host,
      port: qr.port,
      deviceId: res.deviceId,
      desktopName: res.desktopName,
      orgName: res.orgName,
      desktopPublicKeyB64: qr.dpk,
    };
    this.session = session;
    this.seq = 0;
    return session;
  }

  /** Invoke an authenticated op. Throws on transport failure or a refusal. */
  async rpc<T = unknown>(op: string, params?: unknown): Promise<T> {
    if (!this.session) throw new Error('Not paired with a desktop yet.');
    const desktopPublicKey = fromB64(this.session.desktopPublicKeyB64);
    const id = `r${this.seq}`;
    const envelope = seal({
      body: { id, op, params },
      seq: this.seq,
      sentAt: this.nowIso(),
      senderKeys: this.keys,
      recipientPublicKey: desktopPublicKey,
    });
    this.seq += 1;
    const reply = await this.transport.postSealed(
      this.session.host,
      this.session.port,
      '/rpc',
      envelope,
    );
    if (!reply) throw new Error('The desktop is unreachable.');
    const opened = unseal({
      envelope: reply,
      recipientKeys: this.keys,
      expectedSenderPublicKey: desktopPublicKey,
    });
    const res = opened.body as CompanionResponse | null;
    if (!res || typeof res !== 'object' || !('ok' in res))
      throw new Error('The desktop sent a malformed response.');
    if (res.id !== id) throw new Error('The desktop response did not match the request.');
    if (!res.ok) throw new Error(res.error?.message ?? 'The request was refused.');
    return res.result as T;
  }

  /**
   * Seal the one-shot WS hello the phone sends on connecting to /events. The
   * desktop authenticates the socket by the envelope's SENDER key (it maps our
   * static public key to a paired, non-revoked device), so the body is minimal.
   */
  sealHello(): SealedEnvelope {
    if (!this.session) throw new Error('Not paired with a desktop yet.');
    return seal({
      body: { kind: 'ws-hello' },
      seq: 0,
      sentAt: this.nowIso(),
      senderKeys: this.keys,
      recipientPublicKey: fromB64(this.session.desktopPublicKeyB64),
    });
  }

  /**
   * Open a sealed realtime event frame pushed by the desktop. Accepted only if
   * sealed by the pinned desktop key (enforced in unseal) and well-formed.
   */
  openEvent(frame: SealedEnvelope): CompanionEventFrame {
    if (!this.session) throw new Error('Not paired with a desktop yet.');
    const opened = unseal({
      envelope: frame,
      recipientKeys: this.keys,
      expectedSenderPublicKey: fromB64(this.session.desktopPublicKeyB64),
    });
    const parsed = CompanionEventFrameSchema.safeParse(opened.body);
    if (!parsed.success) throw new Error('The desktop sent a malformed event frame.');
    return parsed.data;
  }
}
