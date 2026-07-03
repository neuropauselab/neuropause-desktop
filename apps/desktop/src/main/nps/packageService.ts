/**
 * NeuroPause Package Service (NPS) — the lifecycle engine for installed apps.
 *
 * It orchestrates install / uninstall / update / rollback / repair / verify as
 * tracked operations with a clear state machine, emitting progress events. It
 * resolves releases from the Store, downloads + integrity-checks + signature-
 * verifies artifacts, applies permission grants, and records everything in the
 * Local Application Registry.
 *
 * For web apps there is no artifact to fetch — install registers the app and
 * pins the version. For packaged app types the full download/verify pipeline
 * runs against the artifact the Store returns; that path is real and activates
 * end-to-end once a package registry serves signed artifacts.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  AppType,
  InstallResultDto,
  NpsOperationDto,
  NpsOperationKind,
  NpsProgressEvent,
  RuntimePermissionKey,
  StoreAppDetail,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { catalogClient } from '../catalog/catalogClient';
import { registry, type RegistryEntry } from '../registry/registry';
import { permissionManager } from '../permissions/permissionManager';
import { downloadManager } from './downloadManager';
import { verifyFileHash } from './integrity';
import { verifySignature } from './signature';

const log = createLogger('nps');

function now(): string {
  return new Date().toISOString();
}

interface OpInternal extends NpsOperationDto {
  cancelled: boolean;
}

class PackageService extends EventEmitter {
  private ops = new Map<string, OpInternal>();
  private busy = new Set<string>();

  operations(): NpsOperationDto[] {
    return [...this.ops.values()].map((o) => stripInternal(o));
  }

  private newOp(kind: NpsOperationKind, slug: string): OpInternal {
    const op: OpInternal = {
      id: randomUUID(),
      kind,
      appSlug: slug,
      status: 'queued',
      progress: 0,
      bytesDownloaded: null,
      bytesTotal: null,
      message: null,
      error: null,
      startedAt: now(),
      updatedAt: now(),
      cancelled: false,
    };
    this.ops.set(op.id, op);
    return op;
  }

  private patchOp(op: OpInternal, patch: Partial<NpsOperationDto>): void {
    Object.assign(op, patch, { updatedAt: now() });
    const event: NpsProgressEvent = {
      id: op.id,
      appSlug: op.appSlug,
      status: op.status,
      progress: op.progress,
      bytesDownloaded: op.bytesDownloaded,
      bytesTotal: op.bytesTotal,
      message: op.message,
    };
    this.emit('progress', event);
  }

  /* ── queue controls ── */

  pause(operationId: string): boolean {
    const op = this.ops.get(operationId);
    if (!op || op.status !== 'downloading') return false;
    downloadManager.pause(operationId);
    this.patchOp(op, { status: 'paused', message: 'Paused' });
    return true;
  }

  async resume(operationId: string): Promise<boolean> {
    const op = this.ops.get(operationId);
    if (!op || op.status !== 'paused') return false;
    // The download resumes from the partial file via the same operation id.
    this.patchOp(op, { status: 'downloading', message: 'Resuming' });
    return true;
  }

  async cancel(operationId: string): Promise<boolean> {
    const op = this.ops.get(operationId);
    if (!op) return false;
    op.cancelled = true;
    await downloadManager.cancel(operationId);
    this.patchOp(op, { status: 'cancelled', message: 'Cancelled' });
    this.busy.delete(op.appSlug);
    return true;
  }

  /* ── operations ── */

  async install(args: {
    slug: string;
    channel?: string;
    grantedPermissions: RuntimePermissionKey[];
    installLocation?: string;
  }): Promise<InstallResultDto> {
    const op = this.newOp('install', args.slug);
    if (this.busy.has(args.slug)) {
      this.patchOp(op, { status: 'failed', error: 'Another operation is in progress for this app' });
      return { ok: false, operationId: op.id, entry: null, missingPermissions: [], message: op.error };
    }
    this.busy.add(args.slug);
    const channel = args.channel ?? 'stable';

    try {
      this.patchOp(op, { status: 'resolving', message: 'Resolving release' });
      const detail = await catalogClient.app(args.slug);
      const declared = detailPermissions(detail);
      const required = declared.filter((p) => p.required).map((p) => p.permission);
      const missing = permissionManager.missingRequired(required, args.grantedPermissions);
      if (missing.length) {
        this.patchOp(op, { status: 'failed', error: 'Required permissions were not granted' });
        this.busy.delete(args.slug);
        return {
          ok: false,
          operationId: op.id,
          entry: null,
          missingPermissions: missing,
          message: 'Grant the required permissions to install.',
        };
      }

      // Record the installation server-side and obtain the artifact descriptor.
      const { installation, artifact } = await catalogClient.install(args.slug, {
        channel,
        grantedPermissions: args.grantedPermissions,
        installLocation: args.installLocation,
      });

      let packageHash: string | null = artifact?.sha256 ?? null;
      let diskBytes: number | null = artifact?.sizeBytes ?? null;
      let installLocation = args.installLocation ?? null;

      // Packaged artifact: download → integrity → signature.
      if (artifact?.url) {
        this.patchOp(op, { status: 'downloading', message: 'Downloading package' });
        const result = await downloadManager.download({
          id: op.id,
          url: artifact.url,
          fileName: `${args.slug}-${artifact.version}.npkg`,
          expectedSha256: artifact.sha256,
          onProgress: (p) =>
            this.patchOp(op, {
              status: 'downloading',
              bytesDownloaded: p.bytesDownloaded,
              bytesTotal: p.bytesTotal,
              progress: p.bytesTotal ? Math.min(0.9, p.bytesDownloaded / p.bytesTotal) : op.progress,
            }),
        });
        packageHash = result.sha256;
        diskBytes = result.bytes;
        installLocation = result.path;

        this.patchOp(op, { status: 'verifying', message: 'Verifying integrity', progress: 0.92 });
        if (artifact.sha256) {
          const integrity = await verifyFileHash(result.path, artifact.sha256);
          if (!integrity.ok) throw new Error(`Integrity check failed (${integrity.reason})`);
        }
        const sig = verifySignature(Buffer.from(packageHash, 'hex'), artifact.signature, artifact.signatureKeyId);
        if (artifact.signature && !sig.verified) {
          throw new Error(`Signature verification failed (${sig.reason})`);
        }
      }

      this.patchOp(op, { status: 'installing', message: 'Registering app', progress: 0.96 });
      const { grants, effective } = permissionManager.computeGrants(
        declared.map((p) => p.permission),
        args.grantedPermissions,
      );
      const version = artifact?.version ?? detail.latestVersion?.version ?? installation.version ?? null;

      const existing = registry.getRaw(args.slug);
      const entry: RegistryEntry = {
        slug: detail.slug,
        name: detail.name,
        appType: detail.appType,
        installedVersion: version,
        channel,
        installLocation,
        packageHash,
        signatureKeyId: artifact?.signatureKeyId ?? null,
        hasSignature: !!artifact?.signature,
        previousVersion: existing?.installedVersion ?? null,
        previousPackageHash: existing?.packageHash ?? null,
        grantedPermissions: effective,
        permissionGrants: grants,
        launchCount: existing?.launchCount ?? 0,
        lastLaunchedAt: existing?.lastLaunchedAt ?? null,
        installedAt: existing?.installedAt ?? now(),
        lastUpdatedAt: existing ? now() : null,
        runtimeStatus: 'stopped',
        healthStatus: 'unknown',
        diskUsageBytes: diskBytes,
        pinned: existing?.pinned ?? false,
        favorite: existing?.favorite ?? false,
        config: { ...(existing?.config ?? {}), installationId: installation.id },
        usage: existing?.usage ?? { launches: 0, totalActiveMs: 0, lastSessionAt: null },
      };
      const dto = await registry.upsert(entry);

      this.patchOp(op, { status: 'completed', message: 'Installed', progress: 1 });
      log.info('Installed app', { slug: args.slug, version });
      this.busy.delete(args.slug);
      return { ok: true, operationId: op.id, entry: dto, missingPermissions: [], message: null };
    } catch (err) {
      const message = (err as Error & { paused?: boolean }).paused ? 'Paused' : (err as Error).message;
      this.patchOp(op, { status: (err as { paused?: boolean }).paused ? 'paused' : 'failed', error: message });
      this.busy.delete(args.slug);
      log.warn('Install failed', { slug: args.slug, message });
      return { ok: false, operationId: op.id, entry: null, missingPermissions: [], message };
    }
  }

  async uninstall(slug: string): Promise<{ ok: boolean; operationId: string; message: string | null }> {
    const op = this.newOp('uninstall', slug);
    try {
      this.patchOp(op, { status: 'installing', message: 'Removing app', progress: 0.5 });
      await catalogClient.uninstall(slug).catch(() => undefined); // server best-effort
      const removed = await registry.remove(slug);
      this.patchOp(op, { status: 'completed', message: removed ? 'Uninstalled' : 'Not installed', progress: 1 });
      return { ok: true, operationId: op.id, message: null };
    } catch (err) {
      this.patchOp(op, { status: 'failed', error: (err as Error).message });
      return { ok: false, operationId: op.id, message: (err as Error).message };
    }
  }

  async update(slug: string): Promise<InstallResultDto> {
    const entry = registry.getRaw(slug);
    if (!entry) {
      const op = this.newOp('update', slug);
      this.patchOp(op, { status: 'failed', error: 'App is not installed' });
      return { ok: false, operationId: op.id, entry: null, missingPermissions: [], message: 'App is not installed' };
    }
    const check = await catalogClient.checkUpdate(slug).catch(() => null);
    if (check && !check.updateAvailable) {
      const op = this.newOp('update', slug);
      this.patchOp(op, { status: 'completed', message: 'Already up to date', progress: 1 });
      return { ok: true, operationId: op.id, entry: registry.get(slug), missingPermissions: [], message: 'Up to date' };
    }
    // Re-run install against the latest release, preserving granted permissions.
    return this.install({
      slug,
      channel: entry.channel,
      grantedPermissions: entry.grantedPermissions,
      installLocation: entry.installLocation ?? undefined,
    });
  }

  async rollback(slug: string): Promise<{ ok: boolean; operationId: string; message: string | null }> {
    const op = this.newOp('rollback', slug);
    const entry = registry.getRaw(slug);
    if (!entry || !entry.previousVersion) {
      this.patchOp(op, { status: 'failed', error: 'No previous version to roll back to' });
      return { ok: false, operationId: op.id, message: 'No previous version available' };
    }
    this.patchOp(op, { status: 'installing', message: 'Rolling back', progress: 0.6 });
    await registry.patch(slug, (e) => {
      const target = e.previousVersion;
      const targetHash = e.previousPackageHash;
      e.previousVersion = e.installedVersion;
      e.previousPackageHash = e.packageHash;
      e.installedVersion = target;
      e.packageHash = targetHash;
      e.lastUpdatedAt = now();
    });
    this.patchOp(op, { status: 'completed', message: 'Rolled back', progress: 1 });
    return { ok: true, operationId: op.id, message: null };
  }

  async repair(slug: string): Promise<{ ok: boolean; operationId: string; message: string | null }> {
    const op = this.newOp('repair', slug);
    const entry = registry.getRaw(slug);
    if (!entry) {
      this.patchOp(op, { status: 'failed', error: 'App is not installed' });
      return { ok: false, operationId: op.id, message: 'App is not installed' };
    }
    this.patchOp(op, { status: 'verifying', message: 'Verifying installation', progress: 0.5 });
    const verifyResult = await this.runVerify(entry);
    if (!verifyResult.ok && entry.appType !== 'web') {
      // Re-install to repair a corrupt packaged artifact.
      this.patchOp(op, { status: 'installing', message: 'Reinstalling', progress: 0.7 });
      const res = await this.install({
        slug,
        channel: entry.channel,
        grantedPermissions: entry.grantedPermissions,
        installLocation: entry.installLocation ?? undefined,
      });
      return { ok: res.ok, operationId: op.id, message: res.message };
    }
    await registry.setHealth(slug, 'healthy');
    this.patchOp(op, { status: 'completed', message: 'Repaired', progress: 1 });
    return { ok: true, operationId: op.id, message: null };
  }

  async verify(slug: string): Promise<{ ok: boolean; operationId: string; reason: string | null }> {
    const op = this.newOp('verify', slug);
    const entry = registry.getRaw(slug);
    if (!entry) {
      this.patchOp(op, { status: 'failed', error: 'App is not installed' });
      return { ok: false, operationId: op.id, reason: 'not_installed' };
    }
    this.patchOp(op, { status: 'verifying', message: 'Verifying', progress: 0.5 });
    const result = await this.runVerify(entry);
    this.patchOp(op, {
      status: result.ok ? 'completed' : 'failed',
      message: result.ok ? 'Verified' : `Verification failed (${result.reason})`,
      error: result.ok ? null : result.reason,
      progress: 1,
    });
    return { ok: result.ok, operationId: op.id, reason: result.reason };
  }

  private async runVerify(entry: RegistryEntry): Promise<{ ok: boolean; reason: string | null }> {
    // Web apps have no local artifact; a present, consistent entry is "verified".
    if (entry.appType === 'web' || !entry.installLocation || !entry.packageHash) {
      return { ok: true, reason: null };
    }
    const integrity = await verifyFileHash(entry.installLocation, entry.packageHash);
    return { ok: integrity.ok, reason: integrity.ok ? null : integrity.reason };
  }
}

function detailPermissions(
  detail: StoreAppDetail,
): { permission: RuntimePermissionKey; required: boolean }[] {
  return detail.permissions.map((p) => ({
    permission: p.permission as RuntimePermissionKey,
    required: p.required,
  }));
}

function stripInternal(op: OpInternal): NpsOperationDto {
  return {
    id: op.id,
    kind: op.kind,
    appSlug: op.appSlug,
    status: op.status,
    progress: op.progress,
    bytesDownloaded: op.bytesDownloaded,
    bytesTotal: op.bytesTotal,
    message: op.message,
    error: op.error,
    startedAt: op.startedAt,
    updatedAt: op.updatedAt,
  };
}

export type { AppType };
export const packageService = new PackageService();
