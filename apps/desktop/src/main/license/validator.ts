/**
 * The license validator: fetches the org's license from the backend, persists the
 * last-known-good OrgLicense atomically to a JSON file, and answers status reads by
 * re-evaluating the stored snapshot with the injected clock. That re-evaluation is
 * the point: an expired license cannot hide behind being offline (grace decays and
 * expiry happens from the stored period dates), and a valid one survives a network
 * outage. A failed refresh falls back to the cache and reports the error; it never
 * throws. The file path, transport, and clock are injected, so the validator is
 * unit-testable without Electron.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { LicenseValidationStatus, OrgLicense } from '@neuropause/shared';
import { evaluateLicense } from '@neuropause/shared';
import type { LicenseTransport } from './types';
import { readStoreFile } from '../storage/storeEnvelope';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'org-license-cache',
  scope: 'TENANT',
  persistence: 'file',
  // Nothing mutates this through a user-facing surface. `refresh` fetches the
  // authoritative snapshot from the backend for the CALLER'S OWN organization
  // and overwrites that key; there is no path that authors a license locally.
  authority: 'SYSTEM',
  classification: 'CUSTOMER_DERIVED',
  retention:
    'No cap, no eviction and no delete path. The file is `{ [orgId]: OrgLicense }` — one row per ' +
    "organization — and the ONLY write is `data.licenses[orgId] = license`, which replaces that " +
    "organization's own row and can reach no other key. So there is no removal here that could " +
    "destroy another tenant's entitlement snapshot. The file is in the backup set " +
    "(`license-status.json` under the `configuration` domain), so a restore replaces it wholesale.",
  reason:
    'WHY TENANT: the store is KEYED BY ORGANIZATION ID and every read goes through ' +
    '`statusFor(orgId)`, which reads exactly one key. The boundary is the key, not a filter — a ' +
    'caller that resolves to no organization gets the empty id, which matches nothing. The IPC layer ' +
    'is the half that makes that true: `license/index.ts` resolves the id from `activeTenantScope()` ' +
    'and IGNORES the payload id, because both channels are on the PUBLIC allowlist and taking the id ' +
    'from the request made this an existence oracle for arbitrary organizations (P13C N2). WHAT ' +
    "DATA: the organization's plan tier, entitled plan, subscription state, seat counts, grace days " +
    'and period dates — a description of one customer\'s commercial relationship, so CUSTOMER_DERIVED ' +
    'even though it holds none of their records.',
});

interface LicenseFileData {
  version: 1;
  licenses: Record<string, OrgLicense>;
}

function emptyData(): LicenseFileData {
  return { version: 1, licenses: {} };
}

export interface LicenseValidator {
  load(): Promise<void>;
  /** The current status from the stored snapshot, re-evaluated at read time. */
  getStatus(orgId: string): LicenseValidationStatus;
  /** Fetch from the backend; on failure, fall back to the cache with the error. */
  refresh(orgId: string): Promise<LicenseValidationStatus>;
}

export function createLicenseValidator(opts: {
  filePath: string;
  transport: LicenseTransport;
  now?: () => Date;
}): LicenseValidator {
  const now = opts.now ?? ((): Date => new Date());
  let data = emptyData();
  let loaded = false;
  const lastErrors = new Map<string, string>();
  // Serialize persists so concurrent refresh() calls (e.g. StrictMode double-invoke,
  // or multiple views) can't race on a shared temp path — the same ENOENT-on-rename
  // fix proven in HealthHistoryStore/ExecutionStore.
  let writeChain: Promise<void> = Promise.resolve();

  async function writeNow(): Promise<void> {
    const tmp = `${opts.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(dirname(opts.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, opts.filePath);
  }

  function persist(): Promise<void> {
    const run = writeChain.then(() => writeNow());
    writeChain = run.catch(() => {});
    return run;
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    // Phase 8 (8.3/8.20): envelope read — the last-known-good entitlement
    // snapshot is quarantined (preserved) on corruption, never silently reset.
    const result = await readStoreFile<Partial<LicenseFileData>>(opts.filePath);
    data =
      result.state === 'loaded' && result.data
        ? { version: 1, licenses: result.data.licenses ?? {} }
        : emptyData();
    loaded = true;
  }

  function statusFor(orgId: string, source: 'remote' | 'cache'): LicenseValidationStatus {
    const stored = data.licenses[orgId];
    if (!stored) {
      return {
        orgId,
        source: 'none',
        snapshot: null,
        evaluation: null,
        checkedAt: null,
        lastError: lastErrors.get(orgId) ?? null,
      };
    }
    return {
      orgId,
      source,
      snapshot: stored.snapshot,
      evaluation: evaluateLicense(stored.snapshot, now()),
      checkedAt: stored.checkedAt,
      lastError: lastErrors.get(orgId) ?? null,
    };
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    getStatus(orgId): LicenseValidationStatus {
      return statusFor(orgId, 'cache');
    },

    async refresh(orgId): Promise<LicenseValidationStatus> {
      await ensureLoaded();
      try {
        const license = await opts.transport.fetchLicense(orgId);
        data.licenses[orgId] = license;
        lastErrors.delete(orgId);
        await persist();
        return statusFor(orgId, 'remote');
      } catch (err) {
        lastErrors.set(orgId, (err as Error).message || 'License refresh failed');
        return statusFor(orgId, 'cache');
      }
    },
  };
}
