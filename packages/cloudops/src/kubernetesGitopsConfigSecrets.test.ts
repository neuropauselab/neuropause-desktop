import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createCloudOpsPlatform, type CloudOpsPlatform } from './platform';
import { K8S_KINDS } from './constants';

describe('Modules 4,5,6,7 — Kubernetes, GitOps, Configuration, Secrets', () => {
  let runtime: EnterpriseRuntime;
  let ops: CloudOpsPlatform;
  let clock: ManualClock;
  let envId: string;

  beforeAll(async () => {
    clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    ops = createCloudOpsPlatform(runtime, { clock });
    envId = (await ops.environments().create({ tier: 'production', name: 'prod' })).id;
  });

  it('describes and validates all eleven Kubernetes manifest kinds (never applied)', async () => {
    for (const kind of K8S_KINDS) {
      const m = await ops.kubernetes().describe(kind, { name: 'nems', namespace: 'apps' });
      expect(m.evidence).toBe('adapter-verified');
      expect(m.note).toContain('INFRA-PENDING'); // real apply is never claimed
      const v = ops.kubernetes().validate(m);
      expect(v.valid, `${kind}: ${v.problems.join(', ')}`).toBe(true);
    }
    expect(ops.kubernetes().count()).toBe(K8S_KINDS.length);
    const dep = ops.kubernetes().list('Deployment')[0];
    expect((dep.spec as Record<string, unknown>).kind).toBe('Deployment');
  });

  it('detects GitOps drift with a real in-process diff (reconciliation infra-pending)', async () => {
    const repo = await ops.gitops().registerRepository({ url: 'git@example.com:acme/nems.git', engine: 'argocd' });
    expect(repo.evidence).toBe('adapter-verified');
    expect(repo.note).toContain('INFRA-PENDING');
    const m1 = await ops.kubernetes().describe('Deployment', { name: 'a' });
    const m2 = await ops.kubernetes().describe('Service', { name: 'a' });
    await ops.gitops().commit(repo.id, 'init', [m1.id, m2.id]);
    expect(ops.gitops().desiredState(repo.id).length).toBe(2);

    // observed is missing m2 → drift: m2 is declared-but-not-observed
    const drift = ops.gitops().detectDrift(repo.id, [m1.id]);
    expect(drift.inSync).toBe(false);
    expect(drift.added).toContain(m2.id);
    expect(drift.evidence).toBe('live-verified'); // the diff is a real in-process computation
    expect(ops.gitops().detectDrift(repo.id, [m1.id, m2.id]).inSync).toBe(true);

    // commit history + rollback restore the desired state
    await ops.gitops().commit(repo.id, 'drop service', [m1.id]);
    expect(ops.gitops().history(repo.id).length).toBe(2);
    const firstSha = ops.gitops().history(repo.id)[0]!.sha;
    await ops.gitops().rollback(repo.id, firstSha);
    expect(ops.gitops().desiredState(repo.id).sort()).toEqual([m1.id, m2.id].sort());
  });

  it('stores secret-backed config encrypted at rest in the reused vault', async () => {
    await ops.config().setEnv(envId, 'LOG_LEVEL', 'info');
    const entry = await ops.config().setSecret(envId, 'DB_PASSWORD', 'super-secret-value');
    expect(entry.secret).toBe(true);
    expect(entry.value).toBeUndefined(); // the entry never holds the plaintext

    // real AES-256-GCM: the ciphertext envelope does not contain the plaintext
    const ct = ops.config().ciphertext(envId, 'DB_PASSWORD')!;
    expect(ct).toBeTruthy();
    expect(JSON.stringify(ct)).not.toContain('super-secret-value');
    // reveal decrypts through the reused vault
    expect(await ops.config().reveal(envId, 'DB_PASSWORD')).toBe('super-secret-value');

    // config policy is a real in-process evaluation
    ops.config().definePolicy({ environmentId: envId, requiredKeys: ['LOG_LEVEL', 'DB_PASSWORD'] });
    expect(ops.config().evaluatePolicy(envId).passed).toBe(true);
    ops.config().definePolicy({ environmentId: envId, requiredKeys: ['MISSING_KEY'] });
    expect(ops.config().evaluatePolicy(envId).passed).toBe(false);
    expect(ops.config().versions(envId, 'LOG_LEVEL').length).toBeGreaterThanOrEqual(1);
  });

  it('manages secret references with rotation/expiry (no real synchronization)', async () => {
    const ref = await ops.secrets().reference({ backend: 'hashicorp-vault', path: 'secret/db', environmentId: envId, rotationDays: 30 });
    expect(ref.evidence).toBe('adapter-verified');
    expect(ref.note).toContain('INFRA-PENDING');
    expect(ops.secrets().validate(ref.id).valid).toBe(true);
    expect(ops.secrets().needsRotation(ref.id)).toBe(false);

    // advance the clock past expiry → validation flags rotation due
    clock.advance(31 * 86_400_000);
    expect(ops.secrets().validate(ref.id).valid).toBe(false);
    expect(ops.secrets().needsRotation(ref.id)).toBe(true);
    await ops.secrets().rotateMetadata(ref.id);
    expect(ops.secrets().needsRotation(ref.id)).toBe(false);
    expect(ops.secrets().byBackend('hashicorp-vault').length).toBe(1);
  });
});
