/**
 * P13C ROUND 24 — GATE G12. BACKGROUND-JOB OWNERSHIP ACROSS A RESTART.
 *
 * Round 10 proved a scheduled job carries its own tenant WITHIN one process:
 * the tick fans out per tenant and each due rule fires under the principal
 * derived from `rule.tenantId` rather than from whoever is signed in.
 *
 * That proof has a hole a process boundary walks straight through. Every
 * assertion in `round10PrincipalsChannels.test.ts` is made against objects that
 * were created in the same process that read them, so it cannot distinguish
 * "the owner is on the record" from "the owner is in memory". A restart keeps
 * the first and destroys the second, and the application restarts constantly —
 * every update, every crash, every laptop lid.
 *
 * G12 therefore asks a narrower question than Round 10 did: which of the
 * scheduler's decisions SURVIVE the process that made them?
 *
 * A restart is modelled here as a NEW INSTANCE OVER THE SAME BYTES — a fresh
 * `AutomationStore` on the same file, a fresh `initAutomationPlatform` over the
 * same deps. That is what a restart is; nothing is simulated.
 *
 * WHAT THIS FILE FOUND (O-8, fixed in this round)
 *
 * Ownership survives — it is on the persisted row. Occurrence suppression did
 * NOT, because it lived only in the subsystem's `firedOccurrences` map, and an
 * `interval` schedule reports `due: true` on every tick. So a restart re-fired
 * every interval rule for an occurrence that had ALREADY fired, immediately,
 * once per restart — and a crash loop is a restart loop. The actions those
 * rules execute are webhooks, notifications and record writes.
 */
import { promises as fs } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AutomationRule, TenantScope } from '@neuropause/shared';
import { AutomationStore } from '../enterprise/automationStore';
import { initAutomationPlatform, type AutomationPlatformDeps } from '../automationPlatform/index';
import { principalForOwnedWork } from './backgroundFanOut';

const TENANT_A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-a' };
const TENANT_B: TenantScope = { tenantId: 'org-beta', workspaceId: 'ws-b' };

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-g12-'));
  file = join(dir, 'automations.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    name: 'Nightly export',
    trigger: { type: 'schedule', schedule: 'daily 9am' },
    conditions: [],
    conditionLogic: 'all',
    // `notify` is a connector action, so the shared validator requires a
    // target — `save()` refuses the rule without one and the restart assertions
    // below would then be testing an empty file.
    actions: [{ id: 'a1', type: 'notify', label: 'Notify', connectorId: 'crm-primary', config: {} }],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** A restart: a new store object reading the same bytes off disk. */
function restart(scope: () => TenantScope | null): AutomationStore {
  return new AutomationStore(file).bindScope(scope);
}

describe('G12 — a persisted job keeps its owner across a restart', () => {
  it('the owner is on the record, not in the process that wrote it', async () => {
    const before = restart(() => TENANT_A);
    const saved = await before.save(rule({ id: 'rule-a' }));
    expect(saved.ok).toBe(true);

    // The process that wrote it is gone. Everything below is a different object
    // reading the same file.
    const asA = restart(() => TENANT_A);
    expect(asA.all().map((r) => r.id)).toEqual(['rule-a']);

    const asB = restart(() => TENANT_B);
    expect(asB.all()).toEqual([]);
    expect(asB.get('rule-a')).toBeNull();
  });

  it('a foreign id is still "not found" after a restart, on read AND on write', async () => {
    await restart(() => TENANT_A).save(rule({ id: 'rule-a', name: 'A original' }));

    const asB = restart(() => TENANT_B);
    // Write-side IDOR: knowing the id must not be enough to replace the rule.
    const overwrite = await asB.save(rule({ id: 'rule-a', name: 'B replacement' }));
    expect(overwrite.ok).toBe(false);
    expect(await asB.setStatus('rule-a', 'paused', '2026-02-01T00:00:00.000Z')).toBeNull();

    // And the owner's copy is byte-for-byte what the owner wrote, after a
    // second restart — so the refusal was not merely a filtered read.
    const asA = restart(() => TENANT_A);
    const mine = asA.all();
    expect(mine).toHaveLength(1);
    expect(mine[0]!.name).toBe('A original');
    expect(mine[0]!.status).toBe('active');
  });

  it('an unowned row on disk belongs to nobody and runs for nobody', () => {
    // A file written before ownership existed. Not synthetic: this is exactly
    // what `automations.json` looked like before P13C Round 2.
    writeFileSync(file, JSON.stringify({ rules: [rule({ id: 'legacy-1', tenantId: undefined })] }), {
      mode: 0o600,
    });

    expect(restart(() => TENANT_A).all()).toEqual([]);
    expect(restart(() => TENANT_B).all()).toEqual([]);
    expect(restart(() => TENANT_A).activeRulesForTenant(TENANT_A.tenantId)).toEqual([]);
    expect(restart(() => TENANT_A).activeRulesForTenant('')).toEqual([]);

    // And the scheduler cannot mint a principal for it, so there is no second
    // path by which it could execute.
    expect(
      principalForOwnedWork({ jobId: 'automation-platform:schedule-tick', tenantId: undefined, workspaceId: null }),
    ).toBeNull();
  });

  it('a restart never back-fills an unowned row to the signed-in tenant', async () => {
    writeFileSync(file, JSON.stringify({ rules: [rule({ id: 'legacy-1', tenantId: undefined })] }), {
      mode: 0o600,
    });

    // Tenant A signs in and saves a rule of its own — a write that rewrites the
    // whole file. The legacy row must come back out unowned, not adopted.
    const asA = restart(() => TENANT_A);
    await asA.save(rule({ id: 'rule-a' }));

    const after = restart(() => TENANT_A);
    expect(after.all().map((r) => r.id)).toEqual(['rule-a']);
    const counts = restart(() => TENANT_A).ownershipCounts();
    expect(counts.unresolved).toBe(1);
    expect(counts.assigned).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * O-8 — occurrence suppression across a restart.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The tick, wired to the REAL store on the REAL file.
 *
 * Deliberately not a fake. The property under test is that a claim made by one
 * process is visible to the next one, and every seam between the tick and the
 * bytes on disk — the store's scoping, its serialization, the reload — is part
 * of that claim. A stub recorder would prove the tick calls a function.
 */
function mkTickDeps(store: AutomationStore, scope: TenantScope, fired: string[]): AutomationPlatformDeps {
  return {
    scope: () => scope,
    rules: () => store.all(),
    runRecords: () => [],
    workflowRuns: () => [],
    sessions: () => [],
    jobsAwaiting: () => [],
    chains: () => [],
    orgRoles: () => [],
    globalPolicies: () => [],
    knownWorkers: () => [],
    installedWorkers: () => [],
    deliverySources: () => [],
    scheduledValidations: () => null,
    autoOpsPlans: () => null,
    sandboxHistory: () => null,
    knowledgeMatch: null,
    fireScheduledRule: (ruleId) => {
      fired.push(ruleId);
      return Promise.resolve({ ok: true });
    },
    recordScheduledOccurrence: (ruleId, occurrenceKey) =>
      store.recordScheduledOccurrence(ruleId, occurrenceKey),
    schedule: { every: () => undefined, cancel: () => undefined },
    forEachTenant: async (_jobId, fn) => {
      await fn({ scope });
      return [];
    },
    registerSource: () => undefined,
    now: () => 0,
  };
}

/** An interval rule: the kind whose `due` is unconditionally true, so
 *  suppression is the ONLY thing standing between it and a re-fire. */
function intervalRule(id: string): AutomationRule {
  return rule({ id, name: `Interval ${id}`, trigger: { type: 'schedule', schedule: 'every 15 minutes' } });
}

/** One launch: a store re-read from disk and a subsystem with an empty guard. */
async function launch(
  scope: TenantScope,
  fired: string[],
  fn: (tick: (ms: number) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const store = restart(() => scope);
  const platform = initAutomationPlatform(mkTickDeps(store, scope, fired));
  try {
    await fn((ms) => platform.tick(ms));
  } finally {
    platform.dispose();
  }
}

describe('G12/O-8 — occurrence suppression must survive the process', () => {
  const NOW = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();

  it('an interval rule that already fired does not fire again after a restart', async () => {
    const fired: string[] = [];
    await restart(() => TENANT_A).save(intervalRule('rule-a'));

    await launch(TENANT_A, fired, async (tick) => {
      await tick(NOW);
      await tick(NOW + 1_000); // same occurrence, same process → the map catches it
      expect(fired).toEqual(['rule-a']);
    });

    // The process ends there. The next line is the next launch, still inside the
    // same fifteen-minute bucket, with an empty in-memory guard.
    await launch(TENANT_A, fired, (tick) => tick(NOW + 2_000).then(() => undefined));

    expect(fired).toEqual(['rule-a']);
  });

  it('a restart in a LATER occurrence still fires — this is not a mute button', async () => {
    const fired: string[] = [];
    await restart(() => TENANT_A).save(intervalRule('rule-a'));

    await launch(TENANT_A, fired, (tick) => tick(NOW).then(() => undefined));
    await launch(TENANT_A, fired, (tick) => tick(NOW + 16 * 60_000).then(() => undefined));

    expect(fired).toEqual(['rule-a', 'rule-a']);
  });

  it('the claim is written BEFORE the fire, so a crash mid-fire does not repeat it', async () => {
    const fired: string[] = [];
    await restart(() => TENANT_A).save(intervalRule('rule-a'));

    // The fire itself dies — the process went down inside the action. The claim
    // must already be on disk, or the relaunch runs the action a second time.
    const store = restart(() => TENANT_A);
    const deps = mkTickDeps(store, TENANT_A, fired);
    const crashing = initAutomationPlatform({
      ...deps,
      fireScheduledRule: () => Promise.reject(new Error('process died mid-action')),
    });
    await crashing.tick(NOW);
    crashing.dispose();
    expect(fired).toEqual([]);

    await launch(TENANT_A, fired, (tick) => tick(NOW + 2_000).then(() => undefined));
    expect(fired).toEqual([]);
  });

  it("one tenant's claim does not suppress another tenant's rule across a restart", async () => {
    const firedA: string[] = [];
    const firedB: string[] = [];
    await restart(() => TENANT_A).save(intervalRule('rule-a'));
    await restart(() => TENANT_B).save(intervalRule('rule-b'));

    await launch(TENANT_A, firedA, (tick) => tick(NOW).then(() => undefined));
    await launch(TENANT_B, firedB, (tick) => tick(NOW + 1_000).then(() => undefined));

    expect(firedA).toEqual(['rule-a']);
    expect(firedB).toEqual(['rule-b']);

    // Both claims are on disk, on their own owners' rows, and neither tenant can
    // see the other's — the claim inherits the row's ownership rather than
    // needing a boundary of its own.
    expect(restart(() => TENANT_A).all().map((r) => [r.id, r.lastScheduledOccurrence])).toEqual([
      ['rule-a', restart(() => TENANT_B).all()[0]!.lastScheduledOccurrence],
    ]);
    expect(restart(() => TENANT_A).all()).toHaveLength(1);
    expect(restart(() => TENANT_B).all()).toHaveLength(1);
  });

  it('an unowned rule is never claimed, because it is never fired', async () => {
    const fired: string[] = [];
    writeFileSync(
      file,
      JSON.stringify({ rules: [{ ...intervalRule('legacy-1'), tenantId: undefined }] }),
      { mode: 0o600 },
    );

    await launch(TENANT_A, fired, (tick) => tick(NOW).then(() => undefined));

    expect(fired).toEqual([]);
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { rules: AutomationRule[] };
    expect(raw.rules[0]!.lastScheduledOccurrence).toBeUndefined();
  });
});
