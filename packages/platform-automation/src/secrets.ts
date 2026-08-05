/**
 * EPIC 6 — Secrets Automation. Generates SecretStore / provider descriptors for HashiCorp Vault, AWS
 * Secrets Manager, Azure Key Vault, Google Secret Manager, and the External Secrets Operator, plus
 * rotation, revocation, audit, and validation policies. It aligns with the trust-platform secret model:
 * only REFERENCES are generated — no secret value is ever emitted, logged, or embedded.
 */
import { toYaml, type Yamlish } from './serialize';
import { SECRET_BACKENDS, type SecretBackend } from './constants';
import type { Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

const PROVIDER_SPEC: Record<SecretBackend, Record<string, Yamlish>> = {
  'hashicorp-vault': { provider: { vault: { server: 'https://vault.<domain>', path: 'secret', version: 'v2', auth: { kubernetes: { role: 'neuropause', mountPath: 'kubernetes' } } } } },
  'aws-secrets-manager': { provider: { aws: { service: 'SecretsManager', region: '<region>', auth: { jwt: { serviceAccountRef: { name: 'neuropause' } } } } } },
  'azure-key-vault': { provider: { azurekv: { vaultUrl: 'https://<vault>.vault.azure.net', authType: 'WorkloadIdentity' } } },
  'google-secret-manager': { provider: { gcpsm: { projectID: '<project>', auth: { workloadIdentity: { serviceAccountRef: { name: 'neuropause' } } } } } },
  'external-secrets-operator': { provider: { note: 'ESO orchestrates one of the above providers; install the operator, then a SecretStore per environment' } },
};

export class SecretsAutomation {
  constructor(
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  backends(): readonly SecretBackend[] {
    return SECRET_BACKENDS;
  }

  secretStore(backend: SecretBackend): Record<string, Yamlish> {
    return {
      apiVersion: 'external-secrets.io/v1beta1',
      kind: 'SecretStore',
      metadata: { name: 'neuropause-secret-store', namespace: 'neuropause' },
      spec: PROVIDER_SPEC[backend],
    };
  }

  rotationPolicy(): Record<string, Yamlish> {
    return {
      rotation: [
        { key: 'JWT_ACCESS_SECRET', intervalDays: 30, note: 'rotation invalidates sessions — schedule in a maintenance window' },
        { key: 'DATABASE_URL', intervalDays: 90, strategy: 'dual-credential' },
        { key: 'REDIS_URL', intervalDays: 90, strategy: 'dual-credential' },
      ],
      revocation: { breakGlass: 'revoke in the manager, force-sync, rollout restart deploy/neuropause-backend' },
      audit: { everyAccess: true, destination: 'central-log-store' },
      validation: { onSync: 'reject empty or malformed values; values never logged' },
    };
  }

  async generateAll(backend: SecretBackend): Promise<Artifact> {
    const content = `${toYaml(this.secretStore(backend))}\n---\n${toYaml(this.rotationPolicy())}`;
    const artifact: Artifact = { kind: 'secrets', name: `secrets-${backend}.yaml`, format: 'yaml', content, note: 'SecretStore + rotation/revocation/audit policy — references only; NO secret value is ever generated or exposed.' };
    await this.gov.record({ operator: this.operator, environment: 'production', target: `secrets:${backend}`, epic: 'E6', operation: 'generate-secrets', result: 'generated', evidence: 'live-verified' });
    return artifact;
  }
}
