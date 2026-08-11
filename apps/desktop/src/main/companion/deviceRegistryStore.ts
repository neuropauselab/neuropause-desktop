/**
 * Companion device registry (Mobile M1-03) — the paired phones and the
 * gateway's own on/off + port settings, persisted under the Phase 8 store
 * envelope so a corrupt file is QUARANTINED (bytes preserved) rather than
 * silently reset. Electron-free: the file path is injected, so it unit-tests
 * on a temp file. The userData singleton lives in deviceRegistryInstance.ts.
 *
 * A device is pinned by its static X25519 public key (established out of band
 * at pairing via the QR). Re-pairing the same key replaces its record — one
 * identity per key — and revocation is a tombstone, never a delete, so an
 * unpaired phone can never silently re-appear.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CompanionDeviceDto } from '@neuropause/shared';
import { createLogger } from '../logger';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { declareStoreScope } from '../tenancy/storeScope';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'companion-device-registry',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: 'No cap. `revoke` tombstones ONE device and requires the caller to own it (Round 8).',
  reason: "A paired device is a companion to one organization's work, not to the machine: rows carry boundTenantId and the bound member's email. ROUND 8 FINDING: the field existed and no read consulted it, while CompanionDevices sat on the PUBLIC allowlist and CompanionRevoke was org:manage — so one tenant could list and unpair another tenant's phones.",
});

const log = createLogger('companion-devices');

/** Default LAN port the gateway binds/advertises when the user has not chosen one. */
export const DEFAULT_COMPANION_PORT = 47600;

export interface CompanionDeviceRecord {
  id: string;
  name: string;
  platform: 'ios' | 'android';
  model: string | null;
  /** Base64url X25519 static public key — the device's pinned identity. */
  publicKeyB64: string;
  /** Desktop member (email) this device was bound to at pairing. */
  boundMember: string | null;
  /**
   * The TENANT this device was paired into (P13C Part 3).
   *
   * A device is a companion to one organization's work, not to the machine.
   * Without this field the gateway had no way to ask "is this event this
   * device's to receive", and so it did not ask: `broadcastEvent` pushed every
   * event on the bus to every paired device.
   *
   * ABSENT means a device paired before this field existed. Such a device is
   * not adopted into whichever tenant is open now — that is the guess this
   * exists to remove — so it receives only SYSTEM-scoped events until it is
   * paired again. Fewer notifications is a reportable annoyance; another
   * customer's record names on a phone is not.
   */
  boundTenantId?: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
  /** Replay guard high-water mark (last accepted request sequence). */
  lastSeq: number;
}

interface CompanionDeviceFile {
  /** Store schema stamp — absent on legacy files (= v1). */
  schemaVersion?: number;
  /** Whether the user has switched the gateway on. */
  enabled?: boolean;
  /** LAN port the gateway binds/advertises. */
  port?: number;
  devices: CompanionDeviceRecord[];
}

export interface RegisterDeviceInput {
  name: string;
  platform: 'ios' | 'android';
  model: string | null;
  publicKeyB64: string;
  boundMember: string | null;
  /** The tenant this device is paired into. Null when none resolves. */
  boundTenantId: string | null;
  now: string;
}

export class CompanionDeviceStore {
  /** P13C Round 8 — the boundary this store never had. See `bindScope`. */
  private readonly tenancy = new TenantOwnership('companion-device-registry');

  private devices = new Map<string, CompanionDeviceRecord>();
  private enabled = false;
  private port = DEFAULT_COMPANION_PORT;
  private loaded = false;
  /** Where a corrupt/newer store file was preserved at load, if any. */
  quarantinedTo: string | null = null;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const result = await readStoreFile<Partial<CompanionDeviceFile>>(this.filePath);
    if (result.state === 'loaded' && result.data) {
      const data = result.data;
      for (const d of data.devices ?? []) if (d && d.id) this.devices.set(d.id, d);
      this.enabled = data.enabled ?? false;
      this.port = typeof data.port === 'number' ? data.port : DEFAULT_COMPANION_PORT;
    } else if (result.state !== 'first-run') {
      this.quarantinedTo = result.quarantinedTo;
      log.warn('Companion device registry quarantined at load', {
        quarantinedTo: result.quarantinedTo,
      });
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const file: CompanionDeviceFile = {
      ...envelopeStamp(),
      enabled: this.enabled,
      port: this.port,
      devices: [...this.devices.values()],
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getPort(): number {
    return this.port;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await this.persist();
  }

  /**
   * Bind the tenant boundary. UNBOUND DENIES. Chainable.
   *
   * P13C ROUND 8 — FINDING (structural gate). Rows have carried `boundTenantId`
   * since the companion subsystem shipped, and NO READ CONSULTED IT. Meanwhile
   * `CompanionDevices` sat on the PUBLIC channel allowlist and `CompanionRevoke`
   * was `org:manage` — which every organization's Owner holds. So one tenant could
   * enumerate another tenant's paired phones (device name, platform, the bound
   * member's email, last-seen) and UNPAIR them.
   *
   * Found by the scope gate rather than by a sweep: the store persists, it never
   * declared a scope, and declaring it forced the question nobody had asked.
   */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /** The CALLER'S devices. Unowned rows reach nobody. */
  private mine(rows: readonly CompanionDeviceRecord[]): CompanionDeviceRecord[] {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null) return [];
    return rows.filter((d) => d.boundTenantId === scope.tenantId);
  }

  list(): CompanionDeviceRecord[] {
    return this.mine([...this.devices.values()]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** One device, IF the caller's organization paired it. Was a bare id. */
  get(id: string): CompanionDeviceRecord | null {
    const d = this.devices.get(id) ?? null;
    return d !== null && this.mine([d]).length === 1 ? d : null;
  }

  /**
   * One device REGARDLESS of the reading scope. FOR EGRESS DELIVERY ONLY.
   *
   * P13C ROUND 8 — a deliberate, named bypass, because the alternative is worse.
   *
   * `broadcastEvent` decides delivery by comparing the EVENT'S owner to the
   * DEVICE'S owner. That is a relationship check between two stored facts, and the
   * reader's active organization is not one of them — the push happens on a socket
   * loop with no session, and forcing it through the caller filter would make
   * delivery depend on whichever organization the human happened to have open.
   *
   * It is safe because the caller does the ownership check itself and this method
   * discloses nothing on its own: the gateway compares `device.boundTenantId` to
   * `event.tenantId` and drops the event when they differ, and an unowned device
   * receives SYSTEM events only. The one thing this must never become is a read
   * path for a user-facing surface, which is why it is not called `get`.
   */
  getForDelivery(id: string): CompanionDeviceRecord | null {
    return this.devices.get(id) ?? null;
  }

  /** An active (non-revoked) device pinned to this static public key, if any. */
  activeByPublicKey(publicKeyB64: string): CompanionDeviceRecord | null {
    for (const d of this.devices.values()) {
      if (!d.revoked && d.publicKeyB64 === publicKeyB64) return d;
    }
    return null;
  }

  /**
   * Pair a device to the CALLER'S organization.
   *
   * P13C Round 8 — the owner is STAMPED FROM THE RESOLVER, not taken from
   * `input.boundTenantId`. A caller-supplied owner is not an owner; it is a
   * suggestion, and this store's entire finding was that the suggestion was
   * recorded and then never read. Resolving it here means the stamp and the filter
   * cannot disagree.
   *
   * An unresolved pairing produces an UNOWNED device, which reaches nobody — see
   * `mine`. That is the safe direction: an unowned device is unusable, where a
   * device filed under the wrong organization is another tenant's phone on your
   * account.
   */
  async register(input: RegisterDeviceInput): Promise<CompanionDeviceRecord> {
    // Re-pairing the same key replaces the prior record (one identity per key),
    // preserving its first-seen time and resetting the replay high-water mark.
    const existing = this.activeByPublicKey(input.publicKeyB64);
    const id = existing?.id ?? `cd_${randomUUID()}`;
    const record: CompanionDeviceRecord = {
      id,
      name: input.name,
      platform: input.platform,
      model: input.model,
      publicKeyB64: input.publicKeyB64,
      boundMember: input.boundMember,
      boundTenantId: this.tenancy.scopeOrDeny()?.tenantId ?? input.boundTenantId ?? null,
      createdAt: existing?.createdAt ?? input.now,
      lastSeenAt: input.now,
      revoked: false,
      lastSeq: -1,
    };
    this.devices.set(id, record);
    await this.persist();
    return record;
  }

  /** Advance a device's last-seen + replay high-water mark after an accepted request. */
  async touch(id: string, seq: number, now: string): Promise<void> {
    const d = this.devices.get(id);
    if (!d) return;
    d.lastSeenAt = now;
    if (seq > d.lastSeq) d.lastSeq = seq;
    await this.persist();
  }

  /**
   * Revoke one of the CALLER'S devices.
   *
   * Took a bare payload id. Unpairing another organization's phone is a control
   * mutation, not a disclosure: it silently cuts that organization off from its own
   * companion device and nothing in their UI explains why.
   */
  async revoke(id: string): Promise<boolean> {
    if (this.get(id) === null) return false;
    const d = this.devices.get(id);
    if (!d || d.revoked) return false;
    d.revoked = true;
    await this.persist();
    return true;
  }

  activeCount(): number {
    let n = 0;
    for (const d of this.devices.values()) if (!d.revoked) n += 1;
    return n;
  }
}

export function toCompanionDeviceDto(d: CompanionDeviceRecord): CompanionDeviceDto {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    model: d.model,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    revoked: d.revoked,
  };
}
