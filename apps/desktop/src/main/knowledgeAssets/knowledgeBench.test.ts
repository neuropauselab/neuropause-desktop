/**
 * Phase 6 Stage 7 — performance evidence (7.12). Real timings over
 * synthetic-but-shaped volume: 5 000 entities (1 000 of them governed-doc
 * classified), 1 000 explicit memories, 500 decisions, 200 jobs. Budgets:
 * knowledge compose ≤ 100 ms · matrix (graph-fed) ≤ 100 ms · decision lineage
 * ≤ 100 ms · dashboard ≤ 500 ms. One full warmup pass runs first and is
 * DISCARDED: the production path recomputes on every 3 s TTL expiry, so
 * steady-state is the budgeted behavior — first-call JIT in a cold vitest
 * worker is not the service's runtime profile. The measured numbers print so
 * the suite run IS the benchmark record — nothing is asserted that was not
 * measured.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutiveDecision, MemoryItem, UnifiedEntity } from '@neuropause/shared';
import { buildInventory, buildReferenceIndex, type InventoryInput } from './assetInventory';
import { buildMatrix, type GraphEdgeFeed } from './relationshipMatrix';
import { composeStandards } from './standards';
import { buildQualityReport } from './quality';
import { buildCoverageMap } from './coverageMap';
import { composeDecisionLineage } from './decisionLineage';
import { composeKnowledgeDashboard, composeKnowledgeRecommendations } from './knowledgeModel';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const NOW_ISO = '2026-07-31T12:00:00.000Z';
const iso = (i: number): string => new Date(NOW - (i % 400) * 86_400_000).toISOString();

const SUBJECTS = ['deployment', 'security', 'backup', 'incident', 'release', 'access', 'data retention', 'escalation'];
const KINDS = ['Policy', 'SOP', 'ADR', 'Playbook', 'Spec'];

function entities(n: number): UnifiedEntity[] {
  const out: UnifiedEntity[] = [];
  for (let i = 0; i < n; i += 1) {
    const governed = i % 5 === 0; // 1 000 classified of 5 000
    out.push({
      id: `ent-${i}`,
      kind: governed ? 'document' : 'task',
      connectorId: i % 2 === 0 ? 'notion' : 'm365',
      accountId: 'a1',
      sourceId: `s-${i}`,
      createdAt: iso(i + 30),
      updatedAt: iso(i),
      syncState: 'active',
      syncedAt: iso(i),
      metadata: {},
      title: governed
        ? `${SUBJECTS[i % SUBJECTS.length]} ${KINDS[i % KINDS.length]} ${i}`
        : `Task ${i}`,
      url: null,
      parentId: null,
      containerId: null,
      body: governed ? `${SUBJECTS[(i + 1) % SUBJECTS.length]} details` : null,
      status: null,
      author: `Owner ${i % 40}`,
      timestamp: null,
      endTimestamp: null,
      labels: i % 10 === 0 ? ['approved'] : [],
    });
  }
  return out;
}

function memories(n: number): MemoryItem[] {
  const out: MemoryItem[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: `mem-${i}`,
      kind: i % 3 === 0 ? 'decision' : 'note',
      origin: 'explicit',
      title: `${SUBJECTS[i % SUBJECTS.length]} memory ${i}`,
      content: `Recorded knowledge about ${SUBJECTS[i % SUBJECTS.length]}.`,
      connectorId: null,
      source: 'manual',
      entityRefs: [`ent-${(i * 5) % 5000}`, `dec:${i % 500}`],
      tags: i % 7 === 0 ? ['architecture'] : [],
      occurredAt: null,
      createdAt: iso(i + 5),
      updatedAt: iso(i),
      evidence: { kind: 'document', id: `ent-${(i * 5) % 5000}` },
      metadata: i % 2 === 0 ? { owner: `Owner ${i % 40}` } : {},
    });
  }
  return out;
}

function decisions(n: number): ExecutiveDecision[] {
  const statuses: ExecutiveDecision['status'][] = ['suggested', 'accepted', 'in_progress', 'completed', 'archived'];
  const out: ExecutiveDecision[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: `dec:${i}`,
      title: `Decision ${i}: ${SUBJECTS[i % SUBJECTS.length]} direction`,
      category: 'engineering',
      description: 'd',
      reasoning: 'r',
      evidence: [`ent-${(i * 10) % 5000}`, `mem-${i % 1000}`],
      sourceSystems: ['github'],
      confidence: 0.8,
      businessImpact: 'High',
      expectedOutcome: 'x',
      owner: `Owner ${i % 40}`,
      priority: 'high',
      status: statuses[i % statuses.length],
      createdAt: iso(i + 20),
      updatedAt: iso(i),
      fromRecommendationId: i % 4 === 0 ? `reco:${i}` : undefined,
      history: [
        { at: iso(i + 20), actor: 'system', kind: 'created', newState: 'suggested' },
        { at: iso(i + 10), actor: 'ceo', kind: 'status_changed', previousState: 'suggested', newState: 'accepted' },
      ],
    });
  }
  return out;
}

function graphEdges(n: number): GraphEdgeFeed[] {
  const out: GraphEdgeFeed[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      type: i % 3 === 0 ? 'references' : 'discussed_in',
      fromSourceId: `ent-${(i * 5) % 5000}`,
      toSourceId: `dec:${i % 500}`,
      fromLabel: 'a',
      toLabel: 'b',
      at: iso(i),
      evidenceId: `ent-${(i * 5) % 5000}`,
    });
  }
  return out;
}

describe('Stage 7 bench (7.12) — measured budgets', () => {
  it('compose ≤100ms · matrix ≤100ms · lineage ≤100ms · dashboard ≤500ms at 5k/1k/500', () => {
    const ENT = entities(5000);
    const MEM = memories(1000);
    const DEC = decisions(500);
    const JOBS = Array.from({ length: 200 }, (_, i) => ({
      id: `job-${i}`,
      skillId: `skill-${i % 12}`,
      status: 'completed',
      requestedBy: `Owner ${i % 40}`,
      createdAt: iso(i),
      finishedAt: iso(i),
      correlationId: `corr-${i}`,
    }));

    const input: InventoryInput = {
      nowMs: NOW,
      decisions: DEC,
      chains: [
        {
          id: 'chain-1',
          orgId: 'o',
          name: 'Approvals',
          description: '',
          appliesTo: 'workforce_side_effect',
          steps: [{ id: 's', name: 'M', roleId: 'r', order: 1 }],
          enabled: true,
          createdAt: iso(300),
          updatedAt: iso(10),
        },
      ],
      rules: [],
      prompts: Array.from({ length: 32 }, (_, i) => ({ id: `prompt.${i}`, version: 1 + (i % 3), label: `Prompt ${i}` })),
      documents: ENT.filter((e) => e.kind === 'document'),
      memories: MEM,
      connectors: [
        { id: 'notion', name: 'Notion', provider: 'Notion', description: 'Docs', docsUrl: '', version: '1', configured: true, accounts: [{ id: 'a1' }], lastSyncAt: iso(1) },
        { id: 'm365', name: 'Microsoft 365', provider: 'Microsoft', description: 'Suite', docsUrl: '', version: '1', configured: true, accounts: [{ id: 'a2' }], lastSyncAt: iso(1) },
      ],
      org: {
        org: { id: 'org-1', name: 'Bench Org' },
        units: Array.from({ length: 13 }, (_, i) => ({ id: `u-${i}`, name: `Unit ${i}`, leadUserId: i % 2 === 0 ? `user-${i}` : null })),
        users: Array.from({ length: 40 }, (_, i) => ({ id: `user-${i}`, name: `Owner ${i}`, unitId: `u-${i % 13}` })),
      },
      jobs: JOBS,
      derived: [{ id: 'insight-report', title: 'Insight report (computed)', generatedAt: NOW_ISO, note: '' }],
      references: buildReferenceIndex({
        decisions: DEC,
        memories: MEM,
        referenceEdges: null,
      }),
      failures: {},
    };

    const knownIds = new Set<string>([...ENT.map((e) => e.id), ...MEM.map((m) => m.id), ...DEC.map((d) => d.id)]);

    /* warmup pass (discarded): steady-state is the budgeted path — the service
       recomputes on every 3 s TTL expiry, not from a cold JIT. */
    {
      const warmInv = buildInventory(input);
      const warmStd = composeStandards(warmInv.assets, NOW_ISO);
      buildQualityReport({ assets: warmInv.assets, standards: warmStd, knownIds, nowIso: NOW_ISO, unavailable: [] });
      buildCoverageMap(warmInv.assets, warmStd, input.org, NOW_ISO);
    }

    /* compose: inventory + standards + quality + coverage (the knowledge build) */
    const t0 = performance.now();
    const inventory = buildInventory(input);
    const standards = composeStandards(inventory.assets, NOW_ISO);
    const quality = buildQualityReport({ assets: inventory.assets, standards, knownIds, nowIso: NOW_ISO, unavailable: [] });
    const coverage = buildCoverageMap(inventory.assets, standards, input.org, NOW_ISO);
    const composeMs = performance.now() - t0;

    /* matrix over 3 000 graph edges + all evidence joins */
    const t1 = performance.now();
    const build = buildMatrix(
      {
        assets: inventory.assets,
        graphEdges: graphEdges(3000),
        approvalEvents: Array.from({ length: 200 }, (_, i) => ({ id: `ap-${i}`, correlationId: `corr-${i}`, at: iso(i) })),
        jobs: JOBS.map((j) => ({ id: j.id, skillId: j.skillId, correlationId: j.correlationId })),
        insightRecommendations: Array.from({ length: 12 }, (_, i) => ({ id: `reco:${i}`, title: `Reco ${i}`, evidence: [`ent-${i * 5}`] })),
        orgUserNames: Array.from({ length: 40 }, (_, i) => `Owner ${i}`),
        failures: {},
      },
      NOW_ISO,
    );
    const matrixMs = performance.now() - t1;

    /* lineage for one decision over full discussion/execution feeds */
    const t2 = performance.now();
    const lineage = composeDecisionLineage('dec:7', {
      decision: DEC[7],
      conversations: Array.from({ length: 300 }, (_, i) => ({ id: `conv-${i}`, title: `Conversation ${i} ${SUBJECTS[i % SUBJECTS.length]}`, updatedAt: iso(i) })),
      discussedIn: [{ id: 'n1', label: 'Thread', at: iso(3) }],
      citingMemories: MEM.filter((m) => m.entityRefs.includes('dec:7')).map((m) => ({ id: m.id, title: m.title, updatedAt: m.updatedAt })),
      approvalEvents: [],
      executions: Array.from({ length: 200 }, (_, i) => ({ label: `Execution ${i}`, state: 'completed', startedAt: iso(i) })),
      verifiedEvents: [],
    });
    const lineageMs = performance.now() - t2;

    /* dashboard composition over the computed parts */
    const t3 = performance.now();
    const recommendations = composeKnowledgeRecommendations(quality);
    const dashboard = composeKnowledgeDashboard({
      inventory,
      quality,
      standards,
      coverage,
      matrixCells: build.matrix.cells.length,
      matrixRelations: build.matrix.totalRelations,
      lineageReady: 42,
      recommendations,
      nowIso: NOW_ISO,
    });
    const dashboardMs = performance.now() - t3;

    // eslint-disable-next-line no-console
    console.log(
      `[stage7-bench] compose=${composeMs.toFixed(1)}ms (${inventory.totals.assets} assets) matrix=${matrixMs.toFixed(1)}ms (${build.matrix.totalRelations} relations) lineage=${lineageMs.toFixed(1)}ms dashboard=${dashboardMs.toFixed(1)}ms (${recommendations.length} recos)`,
    );

    /* CORRECTNESS — asserted on EVERY run. The workload above is not a
     * decoration: it exercises compose, matrix, lineage and dashboard over 5 000
     * entities, and a regression that empties the inventory or loses a domain
     * fails here regardless of how fast it did so. */
    expect(inventory.totals.assets).toBeGreaterThan(1000);
    expect(build.matrix.totalRelations).toBeGreaterThan(500);
    expect(lineage.found).toBe(true);
    expect(dashboard.coverage.domains).toHaveLength(8);

    /**
     * TIMING — asserted ONLY under `npm run bench`. P13C ROUND 17.
     *
     * These four budgets failed intermittently in the full suite and passed
     * 3/3 in isolation. The module did not change between those runs; the
     * machine did. `vitest run` collects 764 files across parallel workers, so
     * a `performance.now()` delta measured inside one of them is a function of
     * how many siblings happened to be resident — it is a measurement of CPU
     * contention, not of this code. Measured alone: compose 17.8ms. Measured
     * in the full suite: 117.1ms. Contention did not perturb the number, it
     * dominated it.
     *
     * (764, not the 677 an earlier draft of this comment claimed. 677 is
     * `src/main` alone; the config also collects 87 renderer view-model files.
     * A subset reported as a total — the error this program exists to catch,
     * committed inside the fix for a different one.)
     *
     * THE HEADER OF THIS FILE ALREADY ARGUES THIS, one step short. It discards
     * the warmup pass because "first-call JIT in a cold vitest worker is not
     * the service's runtime profile." Contention is the same objection.
     *
     * The two ways to make a contended budget stop failing are to raise it
     * until it never fires — evidence of nothing — or to measure it where the
     * number means something. Skipping was rejected: the workload and its
     * correctness assertions still run everywhere, and only the stopwatch moves.
     *
     * COMPOSE RETURNS TO 100 — WHERE THIS TEST'S NAME ALWAYS SAID IT WAS.
     * `f48059b1` ("test(ci): relax Stage 7 benchmark threshold", 5 Aug) moved
     * the assertion 100 → 120 and left the title reading `compose ≤100ms`. For
     * a week the file advertised one budget and enforced another: the first of
     * the two options above, taken silently, in the very test whose comment now
     * argues against it. The relaxation existed to survive shared workers. The
     * bench no longer runs in them, so its reason is gone, and 17.8ms observed
     * leaves the restored budget 5.6x of headroom.
     *
     * `npm run bench` runs this file alone with NP_BENCH=1. It belongs in the
     * release procedure, not in the inner loop. A budget that has never failed
     * is not proof of speed; a budget nobody runs is not proof of anything, so
     * a run without it says so out loud below.
     */
    if (process.env['NP_BENCH'] === '1') {
      expect(composeMs).toBeLessThanOrEqual(100);
      expect(matrixMs).toBeLessThanOrEqual(100);
      expect(lineageMs).toBeLessThanOrEqual(100);
      expect(dashboardMs).toBeLessThanOrEqual(500);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        '[stage7-bench] budgets MEASURED BUT NOT ASSERTED (shared workers). ' +
          'Run `npm run bench` for the enforced numbers.',
      );
    }
  });
});
