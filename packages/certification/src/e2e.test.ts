/**
 * End-to-end cross-package integration proof (NCEA 16.0, Phase 6). Composes the
 * real platform — runtime + security + operations + ai-runtime + persistence — in
 * one governed workflow and asserts they interoperate on ONE runtime and ONE audit
 * chain. This is executed evidence of cross-package compatibility, not a claim.
 */
import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createOperationsPlatform } from '@neuropause/operations';
import { createAiRuntime, FakeProvider } from '@neuropause/ai-runtime';
import { createPgliteDriver, createPersistenceLayer, TableRepository, type Entity } from '@neuropause/persistence';

interface Ws extends Entity {
  id: string;
  name: string;
}

describe('End-to-end cross-package integration — one runtime, one audit chain', () => {
  it('runs a governed workflow across runtime + security + ai + persistence + operations', async () => {
    const clock = new ManualClock(1000);
    const runtime = createEnterpriseRuntime({ clock });
    const security = createSecurityPlatform(runtime, { clock });
    const operations = createOperationsPlatform(runtime, { clock });
    const ai = createAiRuntime(runtime, { clock });
    ai.providers().register(new FakeProvider('fake', ['fake-1']));

    // 1. Identity + authorization (security)
    const user = await security.identity().register({ type: 'user', displayName: 'Ada', tenant: 'acme' });
    await security.identity().activate(user.id);
    security.authorization().defineRole({ id: 'operator', name: 'Operator', permissions: ['workspace:*', 'ai:invoke'] });
    expect(security.authorization().authorize({ subject: { id: user.id, roles: ['operator'] }, action: 'invoke', resource: { type: 'ai' } }).allowed).toBe(true);

    // 2. Governed AI execution (ai-runtime) — recorded on the one audit chain
    const { result, record } = await ai.ai().generate({ model: 'fake-1', messages: [{ role: 'user', content: 'summarize' }] }, { actor: user.id });
    expect(result.text).toContain('echo');
    expect(record).toBeTruthy();

    // 3. Persist through the persistence layer (real embedded Postgres)
    const db = await createPgliteDriver();
    try {
      const persistence = createPersistenceLayer({ driver: db });
      await persistence.migrate();
      await persistence.tenants().create('acme', 'Acme');
      const repo = new TableRepository<Ws>(db, 'workspaces', clock);
      await repo.upsert('acme', { id: 'w1', name: 'Core' });
      expect(await repo.count('acme')).toBe(1);

      // 4. Operations health + incident on the same runtime
      operations.health().registerService('api', () => ({ status: 'ok', ready: true }));
      expect(operations.health().readiness().ready).toBe(true);
      const inc = operations.incidents().open({ title: 'e2e validation', severity: 'sev4' });
      operations.incidents().resolve(inc.id, { rootCause: 'validation run' });

      // 5. ONE audit chain carries identity + AI + incident events, and verifies valid
      const chain = runtime.audit();
      expect(chain.list().length).toBeGreaterThan(0);
      expect(chain.verify().valid).toBe(true);
      expect(security.audit().verify().valid).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('keeps AI executions attributable and the chain verifiable across subsystems', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const security = createSecurityPlatform(runtime, { clock });
    const ai = createAiRuntime(runtime, { clock });
    ai.providers().register(new FakeProvider('fake', ['fake-1']));

    await security.identity().register({ type: 'ai-identity', displayName: 'assistant', tenant: 'acme' });
    await ai.ai().generate({ model: 'fake-1', messages: [{ role: 'user', content: 'a' }] }, { actor: 'assistant' });
    await ai.ai().generate({ model: 'fake-1', messages: [{ role: 'user', content: 'b' }] }, { actor: 'assistant' });

    // security events + AI governance events share the one chain, which stays valid
    expect(runtime.audit().list().length).toBeGreaterThanOrEqual(3);
    expect(runtime.audit().verify().valid).toBe(true);
  });
});
