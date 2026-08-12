/**
 * THE TEST THIS PROGRAM DID NOT HAVE, AND THE REASON IT NEEDED ONE.
 * P13C ROUND 17.
 *
 * WHAT HAPPENED
 *
 * Round 2 (`8e9bb90`) added `assertAllTenantStoresBound()` to the composition
 * root with the comment *"Placed AFTER every `bindScope` above and BEFORE any
 * handler is registered."* Round 3 (`943dad8`) added
 * `new TenantOwnership('ecosystem-billing' | 'ecosystem-developer' |
 * 'ecosystem-gateway-audit' | 'user-feedback')` — four stores that construct
 * (and therefore REGISTER) at import time but call `bindScope()` inside
 * `initEcosystem` / `initFeedback`, several hundred lines BELOW the gate.
 *
 * From that commit onward the gate threw on every launch, naming thirteen
 * stores that were about to be bound perfectly well. The throw landed in the
 * `try/catch` around `initRuntimeCore` in `index.ts`; composition died at the
 * gate; `registerSecureHandlers` — 2,800 lines further down — never ran. The
 * application started, painted a full UI, and answered
 * `No handler registered for '<channel>'` for essentially every channel.
 *
 * It stayed that way for FOURTEEN ROUNDS of security certification, because
 * every round verified the code and no round launched the binary.
 *
 * WHY A SOURCE SCAN, AND WHAT IT HONESTLY CANNOT DO
 *
 * The obvious test — "call `initRuntimeCore` and assert it resolves" — needs a
 * live Electron main process, which is exactly the thing vitest cannot give.
 * Every existing fixture wires stores ITS way, which is why 7,011 passing tests
 * never reproduced a composition-order bug: they never used the composition.
 *
 * So this checks the one property that is decidable from source and that would
 * have caught it: **the startup gates must come after every `init*()` in
 * `initRuntimeCore`, and before `registerSecureHandlers`.**
 *
 * This test does NOT prove the application starts. Nothing in this repository
 * does. Round 17's real conclusion is that a launch belongs in the release
 * procedure, not in a test file — and this test exists to stop the specific
 * regression, not to stand in for the launch.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, attachLogFileSink, serializableMeta } from '../logger';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCE = readFileSync(join(MAIN, 'runtimeCore.ts'), 'utf8').split('\n');

/** Statement lines only — a mention inside a comment is not a call. */
function statementLines(pattern: RegExp): number[] {
  const out: number[] = [];
  SOURCE.forEach((line, i) => {
    const t = line.trimStart();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    if (pattern.test(line)) out.push(i + 1);
  });
  return out;
}

const only = (pattern: RegExp, what: string): number => {
  const hits = statementLines(pattern);
  expect(hits, `expected exactly one call site for ${what}`).toHaveLength(1);
  return hits[0] as number;
};

describe('P13C Round 17 — composition order of the startup gates', () => {
  const tenantGate = only(/\bassertAllTenantStoresBound\(\)\s*;/, 'assertAllTenantStoresBound');
  const scopeGate = only(/\bassertAllStoreScopesBound\(\)\s*;/, 'assertAllStoreScopesBound');
  const register = only(/\bregisterSecureHandlers\(defs\b/, 'registerSecureHandlers');

  /**
   * Every subsystem constructor in the composition root. Deliberately broad:
   * the four that broke it were `initEcosystem`, `initMarketplace`,
   * `initWebhooks`, `initCloud`, `initFeedback` and `initFederation`, but
   * naming them would only protect against the six we already know about. Any
   * `init*()` may bind a store tomorrow.
   */
  const initCalls = statementLines(/=\s*(await\s+)?init[A-Z]\w*\(/);

  it('finds the composition root it is asserting about', () => {
    expect(initCalls.length).toBeGreaterThan(10);
    expect(register).toBeGreaterThan(1000);
  });

  it('runs both gates AFTER every init*() — the Round 3 regression', () => {
    const latestInit = Math.max(...initCalls);
    const offenders = initCalls.filter((l) => l > tenantGate || l > scopeGate);
    expect(
      offenders,
      `Startup gates at lines ${tenantGate}/${scopeGate} run BEFORE ${offenders.length} ` +
        `init*() call(s) (latest at line ${latestInit}). A store that binds inside one of ` +
        `those will be reported unbound, the gate will throw on a transient state, and ` +
        `composition will abort before registerSecureHandlers — which is exactly the ` +
        `fourteen-round outage this test exists to prevent.`,
    ).toEqual([]);
  });

  it('runs both gates BEFORE registerSecureHandlers', () => {
    expect(tenantGate).toBeLessThan(register);
    expect(scopeGate).toBeLessThan(register);
  });

  it('keeps the gates adjacent to the channel-classification gate', () => {
    const channelGate = only(/\bassertAllChannelsClassified\(/, 'assertAllChannelsClassified');
    // All three are composition-time invariants and must share one position, so
    // that moving one for a good reason forces a decision about the others.
    expect(Math.abs(channelGate - tenantGate)).toBeLessThan(120);
    expect(Math.abs(channelGate - scopeGate)).toBeLessThan(120);
  });
});

/**
 * THE SECOND HALF OF THE FINDING.
 *
 * The outage was survivable. What made it invisible for fourteen rounds is that
 * the only surviving diagnostic in a packaged app recorded it as `{}`.
 */
describe('P13C Round 17 — an Error must survive the log file sink', () => {
  it('serializes name, message and stack instead of {}', () => {
    expect(JSON.stringify(new Error('boom'))).toBe('{}'); // the trap, stated
    const out = serializableMeta(new Error('boom')) as Record<string, unknown>;
    expect(out['name']).toBe('Error');
    expect(out['message']).toBe('boom');
    expect(String(out['stack'])).toContain('boom');
  });

  it('reaches the file sink with the message intact', () => {
    const lines: string[] = [];
    attachLogFileSink((line) => lines.push(line));
    const log = createLogger('round17');
    log.error(
      'Runtime core failed to initialize',
      new Error('Tenant-scoped stores have no tenant boundary: ecosystem-billing'),
    );
    attachLogFileSink(() => {});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Tenant-scoped stores have no tenant boundary');
    expect(lines[0]).not.toMatch(/Runtime core failed to initialize \{\}/);
  });

  it('unwraps an Error nested inside a meta object, and a cause chain', () => {
    const nested = serializableMeta({
      phase: 'composition',
      err: new Error('outer', { cause: new Error('inner') }),
    }) as { err: { message: string; cause?: { message: string } } };
    expect(nested.err.message).toBe('outer');
    expect(nested.err.cause?.message).toBe('inner');
  });
});

/**
 * THE STORE THE GATE FOUND ON ITS FIRST HONEST RUN.
 *
 * With the gates moved below every `init*()`, the thirteen ordering false
 * positives vanished and exactly ONE name remained:
 *
 *     Tenant-scoped stores have no tenant boundary: infrastructure-resource-graph
 *
 * `ResourceStore` holds two registered boundaries — `tenancy` on the rows and a
 * private `TenantMemo` on the composed graph — and `bindScope()` forwarded to
 * only the first. `initInfrastructure` calls `.bindScope(deps.scope)` once, so
 * no second call site existed to catch it. It was the only unbound memo of 27.
 *
 * It fails CLOSED (an unbound memo composes fresh and caches nothing, and the
 * row filter beneath it was bound), so this is not a disclosure. It is a
 * projection that never cached and a keying protection never exercised — found
 * only because the gate was finally allowed to ask the question.
 */
describe('P13C Round 17 — ResourceStore binds BOTH of its boundaries', () => {
  it('memoises per tenant once bound — same object within the TTL', async () => {
    const { ResourceStore } = await import('../infrastructure/resourceStore');
    const store = new ResourceStore(null).bindScope(() => ({
      tenantId: 'org-a',
      workspaceId: 'ws-a',
    }));
    await store.load();
    expect(store.graph(1)).toBe(store.graph(1));
  });

  it('an UNBOUND store cannot memoise — the defect, reproduced', async () => {
    const { ResourceStore } = await import('../infrastructure/resourceStore');
    const store = new ResourceStore(null); // no bindScope
    await store.load();
    // No tenant resolves, so `TenantMemo.state` composes fresh and stores
    // nothing. Distinct objects prove the cache is inert, which is exactly what
    // shipped for fourteen rounds.
    expect(store.graph(1)).not.toBe(store.graph(1));
  });

  it('reports the row boundary and the memo boundary independently', async () => {
    const { ResourceStore } = await import('../infrastructure/resourceStore');
    const unbound = new ResourceStore(null);
    expect(unbound.hasScope()).toBe(false);
    const bound = new ResourceStore(null).bindScope(() => ({
      tenantId: 'org-b',
      workspaceId: 'ws-b',
    }));
    expect(bound.hasScope()).toBe(true);
  });
});
