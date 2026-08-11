/**
 * P13C ROUND 9 — REGRESSIONS FOR THE FRESH RED TEAM'S PROVEN FINDINGS.
 *
 * Two of the seven are closed in this round and pinned here. The other five are
 * documented in the Round 9 report and are Round 10's work; they are NOT
 * asserted as fixed, because they are not.
 *
 * Both of these had the same shape, and it is a shape no invariant in this
 * program currently catches: THE SEAM WAS PRESENT AND ATTACHED TO THE WRONG
 * THING. `assertEveryModuleScoped` asked "is a boundary bound?" and the answer
 * was yes. `storeScopeGate` asked "is a scope declared?" and the answer was
 * yes. Neither can ask "is it bound to the RIGHT resolver", and that is the gap
 * these two findings live in.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformEvent, TenantScope } from '@neuropause/shared';
import { EventBus } from '../platform/eventBus';
import { registerSubscribers } from '../platform/subscribers';
import { runAsPrincipal, tenantPrincipal } from './backgroundPrincipal';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

/**
 * HIGH — the 106 ERP/CRM/HR/finance module stores were bound to
 * `tenantContext.scope()`, which reads the active workspace and is NOT
 * principal-aware, while every other store in the same file binds
 * `activeTenantScope`, which is.
 *
 * Asserted as a source invariant rather than by booting the enterprise
 * subsystem, which needs Electron and most of the app. That is a real
 * limitation and is stated rather than hidden: this pins the binding, not the
 * runtime behaviour. The runtime half is covered by the delivery test below and
 * by `backgroundTenancy.test.ts`.
 */
describe('every enterprise store binds the PRINCIPAL-AWARE resolver', () => {
  const src = readFileSync(join(MAIN, 'enterprise/index.ts'), 'utf8');

  it('the module registry does not bind the session-only resolver', () => {
    expect(
      /modules\.registry\.bindScope\(\s*\(\)\s*=>\s*tenantContext\.scope\(\)\s*\)/.test(src),
      'The 106 module stores must not be bound to tenantContext.scope() — it ignores the ' +
        'background principal, so a companion device or sandbox scenario acting for tenant A ' +
        'reads and WRITES the tenant the desktop happens to be showing.',
    ).toBe(false);
    expect(src).toContain('modules.registry.bindScope(activeTenantScope)');
  });

  it('no bindScope in the file uses the session resolver directly', () => {
    const offenders = [...src.matchAll(/\.bindScope\(([^)]*)\)/g)]
      .map((m) => m[1]!.trim())
      .filter((arg) => /tenantContext\.scope/.test(arg));
    expect(
      offenders,
      'bindScope must receive activeTenantScope (or a wrapper of it). tenantContext.scope ' +
        'answers from the active workspace only.',
    ).toEqual([]);
  });
});

/**
 * MEDIUM→HIGH surface — the native notifier was the forwarder's unscoped
 * sibling, eight lines away in the same function.
 */
describe('native notifications do not cross the tenant boundary', () => {
  function harness(viewer: TenantScope | null) {
    const notified: PlatformEvent[] = [];
    const broadcast: PlatformEvent[] = [];
    let actor: TenantScope | null = null;
    const bus = new EventBus({ tenantId: () => actor?.tenantId ?? null });
    registerSubscribers(bus, {
      persist: () => undefined,
      audit: () => undefined,
      notify: (e) => notified.push(e),
      broadcast: (e) => broadcast.push(e),
      viewerScope: () => viewer,
    });
    const publish = (as: TenantScope, name: string): void => {
      actor = as;
      bus.publish({
        type: 'connector.error',
        category: 'runtime',
        source: name,
        priority: 'critical',
        resource: { id: `${name}-id`, name: `${name} — acquisition terms` },
      });
      actor = null;
    };
    return { notified, broadcast, publish };
  }

  it('a critical event owned by A does not notify while the window shows B', () => {
    const h = harness(B);
    h.publish(A, 'A-PROJECT');
    expect(h.broadcast).toHaveLength(0);
    // The finding: broadcast was 0 and notify was 1, carrying A's record name.
    expect(h.notified).toHaveLength(0);
    expect(JSON.stringify(h.notified)).not.toContain('acquisition terms');
  });

  it('A DOES get its own critical notification — not "always no"', () => {
    const h = harness(A);
    h.publish(A, 'A-PROJECT');
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0]!.resource?.name).toContain('acquisition terms');
  });

  it('a background pass for A while the window shows B notifies nobody', () => {
    const h = harness(B);
    runAsPrincipal(tenantPrincipal({ jobId: 'sync', scope: A })!, () => {
      h.publish(A, 'A-PROJECT');
    });
    expect(h.notified).toHaveLength(0);
  });

  it('low-priority events are still filtered out on priority alone', () => {
    const h = harness(A);
    const bus = new EventBus({ tenantId: () => A.tenantId });
    const got: PlatformEvent[] = [];
    registerSubscribers(bus, {
      persist: () => undefined,
      audit: () => undefined,
      notify: (e) => got.push(e),
      broadcast: () => undefined,
      viewerScope: () => A,
    });
    bus.publish({ type: 'download.progress', category: 'download', source: 'x', priority: 'low' });
    expect(got).toHaveLength(0);
    void h;
  });
});
