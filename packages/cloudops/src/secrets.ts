/**
 * Module 7 — Secret Operations. Manages secret REFERENCES (never values): rotation metadata,
 * expiration, validation, and audit, with adapter shapes for HashiCorp Vault / AWS Secrets
 * Manager / Azure Key Vault / GCP Secret Manager. No real secret synchronization occurs — the
 * reference names where a secret lives; live sync/fetch/write is INFRA-PENDING.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { SecretReference } from './types';
import { SECRET_BACKENDS, type SecretBackend } from './constants';

const DAY_MS = 86_400_000;

export interface CreateSecretRefInput {
  backend: SecretBackend;
  path: string;
  environmentId: string;
  rotationDays?: number;
}

export interface SecretRefValidation {
  id: string;
  valid: boolean;
  problems: string[];
}

export class SecretOperations {
  private readonly refs = new Map<string, SecretReference>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
  ) {}

  async reference(input: CreateSecretRefInput): Promise<SecretReference> {
    if (!SECRET_BACKENDS.includes(input.backend)) throw new Error(`unknown secret backend: ${input.backend}`);
    if (!input.path) throw new Error('secret reference requires a path');
    const now = this.clock.now();
    const ref: SecretReference = {
      id: randomId('secref'),
      backend: input.backend,
      path: input.path,
      environmentId: input.environmentId,
      ...(input.rotationDays ? { rotationDays: input.rotationDays, expiresAt: now + input.rotationDays * DAY_MS } : {}),
      createdAt: now,
      evidence: 'adapter-verified',
      note: `${input.backend} reference shape registered — live secret synchronization is INFRA-PENDING (needs real backend credentials + network)`,
    };
    this.refs.set(ref.id, ref);
    await this.governance.record({ actor: 'system', operation: `secret.reference.${input.backend}`, targetId: ref.id, evidence: 'adapter-verified', scope: input.environmentId, detail: ref.note });
    return ref;
  }

  /** Real in-process validation of the reference shape + expiry — not a backend call. */
  validate(id: string): SecretRefValidation {
    const ref = this.require(id);
    const problems: string[] = [];
    if (!SECRET_BACKENDS.includes(ref.backend)) problems.push('unknown backend');
    if (!ref.path) problems.push('empty path');
    if (ref.expiresAt !== undefined && this.clock.now() > ref.expiresAt) problems.push('expired — rotation due');
    return { id, valid: problems.length === 0, problems };
  }

  needsRotation(id: string): boolean {
    const ref = this.require(id);
    return ref.expiresAt !== undefined && this.clock.now() >= ref.expiresAt;
  }

  /** Rotation METADATA only — records intent and resets expiry. No real secret is rotated. */
  async rotateMetadata(id: string): Promise<SecretReference> {
    const ref = this.require(id);
    if (ref.rotationDays) ref.expiresAt = this.clock.now() + ref.rotationDays * DAY_MS;
    await this.governance.record({ actor: 'system', operation: 'secret.rotateMetadata', targetId: id, evidence: 'adapter-verified', scope: ref.environmentId, detail: 'metadata only — no real synchronization' });
    return ref;
  }

  private require(id: string): SecretReference {
    const ref = this.refs.get(id);
    if (!ref) throw new Error(`no secret reference ${id}`);
    return ref;
  }

  get(id: string): SecretReference | undefined {
    return this.refs.get(id);
  }
  list(environmentId?: string): SecretReference[] {
    const all = [...this.refs.values()];
    return environmentId ? all.filter((r) => r.environmentId === environmentId) : all;
  }
  byBackend(backend: SecretBackend): SecretReference[] {
    return this.list().filter((r) => r.backend === backend);
  }
  count(): number {
    return this.refs.size;
  }
}
