/**
 * Persistence for the device-local principal (S17 / FG-6, condition 2 / pin 3).
 *
 * The principal's id must be STABLE across restarts — a local principal's owner
 * claim + governed admissions correlate through it. It is persisted under the
 * store envelope (quarantine-not-reset) and registered in `storePaths` so it is
 * covered by backup + pre-migration rollback. Losing the file mints a NEW id
 * (envelope quarantines rather than half-reads); that is a known, recoverable
 * edge (restore recovers the id) — documented in the S17 evidence.
 *
 * This is NOT a secret (a synthetic device id, not a credential), so it is a
 * plain enveloped JSON file, not the encrypted secureStore.
 */
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { app } from 'electron';
import type { LocalPrincipal } from '@neuropause/shared';
import { readStoreFile, envelopeStamp } from '../storage/storeEnvelope';
import { declareStoreScope } from '../tenancy/storeScope';
import { createLogger } from '../logger';

const log = createLogger('local-principal');
const FILE = 'local-principal.json';

// S17/FG-6 — the device-local principal is per-install, not per-tenant.
declareStoreScope({
  name: 'local-principal',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  // Auto-minted on first run; no user-facing surface mutates it.
  authority: 'SYSTEM',
  // A synthetic per-profile UUID + an OS-provided display name + createdAt. It
  // describes the DEVICE's local identity, never a customer's records/activity —
  // so it is not CUSTOMER_DERIVED and INSTALL_GLOBAL is legal.
  classification: 'INSTALL_METADATA',
  // loadOrCreate only mints-once + reads; there is no list, cap, TTL, eviction or
  // delete path (a corrupt file is QUARANTINED, not removed — bytes preserved).
  retentionScope: 'NONE',
  retentionAuthority: 'NONE',
  retention:
    'One record, minted once on first run (or after quarantine) and read thereafter. No list, no ' +
    'cap, no eviction, no delete path: the only write is the initial mint; an unreadable file is ' +
    'preserved (quarantined) rather than truncated, and a fresh id is minted beside it.',
  reason:
    'WHY GLOBAL: one device-local principal per install/profile — the device precedes any tenant, and ' +
    'in local mode there is no tenant at all. A per-organization device id is unrepresentable. ' +
    'WHAT DATA: a synthetic per-profile UUID + an OS-provided display name + a createdAt. It names no ' +
    'customer, counts no activity, describes no records. CROSS-TENANT COST: none — it is the device’s ' +
    'own identity, from which the synthetic non-routable local owner/actor identities are derived.',
});

interface Persisted {
  schemaVersion?: number;
  principal: LocalPrincipal;
}

function osDisplayName(): string {
  try {
    const name = userInfo().username;
    return name && name.trim() !== '' ? name : 'Local User';
  } catch {
    return 'Local User';
  }
}

function isValidPrincipal(p: unknown): p is LocalPrincipal {
  if (!p || typeof p !== 'object') return false;
  const c = p as Partial<LocalPrincipal>;
  return (
    typeof c.id === 'string' &&
    c.id.trim() !== '' &&
    typeof c.displayName === 'string' &&
    typeof c.createdAt === 'string'
  );
}

class LocalPrincipalStore {
  /**
   * Load the stable device-local principal, minting + persisting one on first
   * run (or after quarantine). Idempotent across restarts.
   *
   * @param dir override the data directory (tests); defaults to userData.
   */
  async loadOrCreate(dir?: string): Promise<LocalPrincipal> {
    const filePath = join(dir ?? app.getPath('userData'), FILE);
    const read = await readStoreFile<Persisted>(filePath);
    if (read.state === 'loaded' && read.data && isValidPrincipal(read.data.principal)) {
      return read.data.principal;
    }
    if (read.quarantinedTo) {
      log.warn('local-principal store was quarantined; minting a fresh device id', {
        quarantinedTo: read.quarantinedTo,
      });
    }
    const principal: LocalPrincipal = {
      id: randomUUID(),
      displayName: osDisplayName(),
      createdAt: new Date().toISOString(),
    };
    const payload = JSON.stringify({ ...envelopeStamp(), principal }, null, 2);
    try {
      // Atomic-ish: write a temp file then rename, so a crash mid-write cannot
      // leave a half-written principal (which the envelope would quarantine).
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, filePath);
    } catch (err) {
      log.error('failed to persist the local principal; using the minted id for this session only', err);
    }
    return principal;
  }
}

export const localPrincipalStore = new LocalPrincipalStore();
