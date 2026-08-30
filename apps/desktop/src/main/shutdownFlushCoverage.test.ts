/**
 * P13C ROUND 46 — GATE 16. THE SHUTDOWN-FLUSH COVERAGE LOCK.
 *
 * Round 37 built the barrier and registered the highest-value seven; the
 * remaining ~40 background-write stores (graph, memory, webhooks, workforce,
 * ecosystem, cloud, federation, sandbox, decisions/holds, documents, ERP
 * approvals, medical-device traces, …) stayed OFF it — every one of them
 * coalesces writes in memory, so a quit raced the in-flight write and silently
 * lost the last mutation. This file is the lock that keeps the registration
 * set from rotting: each subsystem's composition file must register its stores
 * on the barrier, by name, at the composition point that already imports them.
 *
 * WHY A SOURCE SCAN (same reasoning as `tenancy/resolverAttachment.test.ts`):
 * a runtime assertion can only see registrations on a path a test composed,
 * and composing `initFederation`/`initEcosystem`/… needs Electron and half the
 * app. The registration is a literal call in a known file, mechanical to read.
 * Its limits are stated at the bottom rather than claimed away.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('.', import.meta.url));

/**
 * Registration name → the composition file that must make it. Each file
 * already imports the store instances it flushes, so the registration adds no
 * new coupling — the `enterprise/index.ts` org/workspace/governance trio is
 * the round-37 precedent.
 */
const REQUIRED: Record<string, string> = {
  // round 37 — the original seven (index.ts's app-log + platform's timeline
  // are asserted separately below; workspace-contexts lives in its instance).
  'org-store': 'enterprise/index.ts',
  'workspace-store': 'enterprise/index.ts',
  'governance-store': 'enterprise/index.ts',
  'enterprise-module-stores': 'enterprise/index.ts',
  'workspace-contexts': 'workspaces/workspaceContextsInstance.ts',
  'app-log': 'index.ts',
  'platform-timeline': 'platform/index.ts',
  // round 46 — the rest of the persisted world.
  'graph-store': 'graph/index.ts',
  'memory-stores': 'memory/index.ts',
  'webhook-store': 'webhooks/index.ts',
  'workforce-stores': 'workforce/index.ts',
  'ecosystem-stores': 'ecosystem/index.ts',
  'cloud-stores': 'cloud/index.ts',
  'federation-stores': 'federation/index.ts',
  'sandbox-stores': 'sandbox/index.ts',
  'sandbox-validation-runs': 'sandbox/validation/index.ts',
  'sandbox-benchmarks': 'sandbox/lab/index.ts',
  'enterprise-adjacent-stores': 'enterprise/index.ts',
  'decision-stores': 'decisions/instances.ts',
  'marketplace-org-policy': 'marketplace/index.ts',
  'ai-routing-usage': 'ai/routingUsageInstance.ts',
  'document-store': 'documents/index.ts',
  'identity-store': 'identity/index.ts',
};

describe('every background-write subsystem registers on the shutdown barrier (Gate 16)', () => {
  it.each(Object.entries(REQUIRED))('%s is registered in %s', (name, rel) => {
    const src = readFileSync(join(MAIN, rel), 'utf8');
    expect(
      src.includes(`registerShutdownFlush('${name}'`),
      `${rel} must call registerShutdownFlush('${name}', …) — its coalesced stores otherwise lose ` +
        'the last write on quit/suspend. Register at the composition point that already imports them.',
    ).toBe(true);
  });

  it('the suspend path drains the same barrier — a lid close is a quit the app never sees', () => {
    const src = readFileSync(join(MAIN, 'runtimeService.ts'), 'utf8');
    expect(src).toContain('runSuspendFlush');
  });
});

/**
 * WHAT THIS LOCK CANNOT SEE, stated rather than claimed away: it proves a
 * registration CALL exists in the file, not that the function it registers
 * flushes every store the subsystem owns — that half lives in each
 * registration's own arrow function, reviewed with the subsystem. A brand-new
 * subsystem with a brand-new store is also outside this list until someone
 * adds it; the failure message on the barrier-summary log line
 * (`Shutdown flush complete {ran:N}`) dropping is the runtime tell.
 */
