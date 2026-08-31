/**
 * GATE 22 (PERFORMANCE) — the one hot path the existing perf suite never measured.
 *
 * `tenantPerformance.bench.test.ts` measures `resolveTenantScope(session)` — the
 * principal/session PRECEDENCE wrapper — but stubs the session, so it never
 * exercises `tenantContext.resolveFull()` → `orgStore.usersFor(orgId)`, the
 * O(users) membership scan that runs on EVERY scoped read (enterprise/index.ts
 * documents it: "resolveFull() is on the read path of every scoped store"). And
 * `moduleRegistry.readableSummaries()` multiplies it — ~3 resolves per module ×
 * 106 modules each time the Business view opens.
 *
 * This benchmarks the REAL `createTenantContextResolver` over a REAL seeded
 * `OrgStore` at growing user counts (100 / 1k / 10k), with the signed-in member
 * placed LAST so the scan is worst-case, and reports:
 *   • resolveFull() p50 — the per-scoped-read cost;
 *   • the "open Business view" aggregate (318 = 106 × 3 resolves) — the most
 *     multiplied real interaction.
 *
 * ASSERTIONS ARE LOOSE, ORDER-OF-MAGNITUDE guards (matching this suite's
 * philosophy): they prove the linear scan did NOT become pathological/quadratic.
 * The printed figures are the evidence; they are not product SLOs. Electron-free,
 * so it runs deterministically in Node/CI as a reproducible baseline.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope, Workspace } from '@neuropause/shared';
import { OrgStore } from '../../enterprise/org/orgStore';
import { ORG_ID, OWNER_USER_ID } from '../../enterprise/org/seed';
import { createTenantContextResolver } from '../tenantContext';

const paths: string[] = [];
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});
function tempPath(): string {
  const p = join(tmpdir(), `np-resolve-perf-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function summarize(samples: number[]): { n: number; p50: number; p95: number | null } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return {
    n: s.length,
    p50: Number(at(0.5).toFixed(4)),
    p95: s.length >= 20 ? Number(at(0.95).toFixed(4)) : null,
  };
}
function measure(iterations: number, fn: () => void): number[] {
  fn(); // warm the JIT + any lazy load
  const out: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return out;
}
function report(label: string, samples: number[], extra = ''): void {
  const { n, p50, p95 } = summarize(samples);
  const p95s = p95 === null ? 'n/a (n<20)' : `${p95}ms`;
  // eslint-disable-next-line no-console
  console.log(
    `PERF ${label.padEnd(52)} n=${String(n).padStart(4)}  p50=${String(p50).padStart(9)}ms  p95=${p95s.padStart(12)}  ${extra}`,
  );
}

const SIGNED_IN = 'perf-signed-in@bench.test';
const WS: Workspace = {
  id: 'ws-perf',
  name: 'Perf',
  organizationId: ORG_ID,
  isolation: 'isolated',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};

/** A resolver wired exactly like production (enterprise/index.ts) over a real OrgStore. */
function realResolver(store: OrgStore): ReturnType<typeof createTenantContextResolver> {
  return createTenantContextResolver({
    sessionEmail: () => SIGNED_IN,
    isLoaded: () => true,
    activeWorkspaceId: () => WS.id,
    workspace: (id) => (id === WS.id ? WS : null),
    organization: (id) => store.organization(id),
    usersFor: (orgId) => store.usersFor(orgId), // the O(users) scan under test
    rolesFor: (orgId) => store.rolesFor(orgId),
    ownerMember: () => store.user(OWNER_USER_ID),
  });
}

async function seededStore(userCount: number): Promise<OrgStore> {
  const store = new OrgStore(tempPath());
  store.bindScope(() => ({ tenantId: ORG_ID, workspaceId: WS.id }) as TenantScope);
  await store.load(); // seeds the default org + owner
  // Fill the tenant with `userCount` members; the signed-in member goes LAST so
  // the membership `.find()` scans the whole list (worst case).
  for (let i = 0; i < userCount - 1; i += 1) {
    store.createUser({ orgId: ORG_ID, name: `User ${i}`, email: `user-${i}@bench.test`, title: 'Member' });
  }
  store.createUser({ orgId: ORG_ID, name: 'Signed In', email: SIGNED_IN, title: 'Member' });
  return store;
}

describe('Gate 22 — resolveFull() scaling with org user count', () => {
  for (const users of [100, 1_000, 10_000]) {
    it(`resolveFull + Business-view aggregate at ${users} users (worst-case last-match)`, async () => {
      const store = await seededStore(users);
      const resolver = realResolver(store);

      // Correctness first: a fast wrong answer is not a pass.
      expect(resolver.resolveFull().ok).toBe(true);

      const single = measure(2_000, () => void resolver.resolveFull());
      // The most-multiplied real interaction: opening the Business view runs
      // readableSummaries → ~3 resolves per module × 106 modules = 318 resolves.
      const RESOLVES_PER_BUSINESS_OPEN = 106 * 3;
      const businessOpen = measure(50, () => {
        for (let i = 0; i < RESOLVES_PER_BUSINESS_OPEN; i += 1) void resolver.resolveFull();
      });

      report(`resolveFull            (${users} users, 1 call)`, single);
      report(`Business-view open     (${users} users, 318 resolves)`, businessOpen);

      // Order-of-magnitude guards — the scan must stay LINEAR, never pathological.
      // A single scoped read over 10k members in >5ms, or a whole Business-view
      // open in >1s, would mean the linear scan had degraded. The real p50s
      // (printed above) are the baseline the evidence quotes.
      expect(summarize(single).p50).toBeLessThan(5);
      expect(summarize(businessOpen).p50).toBeLessThan(1_000);

      await store.flush();
    }, 30_000);
  }
});
