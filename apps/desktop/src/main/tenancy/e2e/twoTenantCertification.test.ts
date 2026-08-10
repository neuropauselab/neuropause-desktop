/**
 * PROGRAM 13C CERTIFICATION — the two-tenant end-to-end.
 *
 * Phases 3-19 of the certification gate, driven from ONE shared world so every
 * domain is asked the same question under the same conditions: two tenants,
 * one install, one file per store, a mutable scope that IS the tenant switch.
 *
 * WHAT MAKES THESE TESTS WORTH ANYTHING
 *
 * Each tenant's every record carries that tenant's MARKER. So the strongest
 * assertion in this file is not any individual `toBeNull()` — it is the
 * whole-payload marker sweep, which catches a leak through a field nobody
 * thought to check. Individually-named assertions prove the paths somebody
 * imagined; the marker sweep is what catches the one they did not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTwoTenantWorld,
  DOMAINS,
  MARKER_A,
  MARKER_B,
  TENANT_A,
  TENANT_B,
  type TwoTenantWorld,
} from './twoTenantFixture';

let w: TwoTenantWorld;

beforeEach(async () => {
  w = await buildTwoTenantWorld();
});
afterEach(async () => {
  await w.dispose();
});

/** Everything tenant `as` can currently see, as one JSON blob. */
function visibleSurface(world: TwoTenantWorld): string {
  return JSON.stringify({
    crm: world.records.crm.list({ limit: 100 }),
    erp: world.records.erp.list({ limit: 100 }),
    hr: world.records.hr.list({ limit: 100 }),
    finance: world.records.finance.list({ limit: 100 }),
    documents: world.documents.all(),
    search: world.unified.query({ limit: 1000, includeDeleted: false }).items,
    graph: world.graph.listNodes({ limit: 500 }),
    notifications: world.inbox.page(200).items,
    conversations: world.conversations.list(),
    sandbox: world.sandboxWorkspaces.list(),
    scenarios: world.scenarios.list(),
    executions: world.executions.all(),
    artifacts: world.artifacts.all(),
    datasets: world.datasets.list(),
    validation: world.validationRuns.all(),
  });
}

/* ── Phases 3 & 4: the complete journeys ────────────────────────────────── */

describe('Phase 3/4 — a complete tenant journey shows only that tenant', () => {
  it('TENANT A: every domain returns A, and NOTHING contains B’s marker', () => {
    w.setScope(TENANT_A);
    const surface = visibleSurface(w);

    expect(surface).toContain(MARKER_A);
    // The assertion that covers the fields nobody enumerated.
    expect(surface).not.toContain(MARKER_B);
  });

  it('TENANT B: every domain returns B, and NOTHING contains A’s marker', () => {
    w.setScope(TENANT_B);
    const surface = visibleSurface(w);

    expect(surface).toContain(MARKER_B);
    expect(surface).not.toContain(MARKER_A);
  });

  it('each domain returns exactly ONE record per tenant, not two', () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      w.setScope(tenant);
      for (const d of DOMAINS) {
        expect(w.records[d].list({ limit: 100 })).toHaveLength(1);
      }
      expect(w.documents.all()).toHaveLength(1);
      expect(w.sandboxWorkspaces.list()).toHaveLength(1);
      expect(w.conversations.list()).toHaveLength(1);
      expect(w.validationRuns.all()).toHaveLength(1);
    }
  });

  /**
   * A signed-out or unresolved caller is a real state — a revoked membership, a
   * suspended tenant, a cold start. It must see nothing, not "whatever was
   * loaded".
   */
  it('an unresolved caller sees NOTHING from either tenant', () => {
    w.setScope(null);
    const surface = visibleSurface(w);
    expect(surface).not.toContain(MARKER_A);
    expect(surface).not.toContain(MARKER_B);
  });
});

/* ── Phase 5: the cross-tenant IDOR matrix ──────────────────────────────── */

/**
 * Every resource type, both directions, driven from the fixture's own id lists
 * rather than hand-written — so adding a resource to the fixture automatically
 * adds it to the matrix instead of being silently uncovered.
 */
function readAttempts(world: TwoTenantWorld, victim: TwoTenantWorld['a']) {
  return [
    ['crm record', () => world.records.crm.get(victim.records.crm)],
    ['erp record', () => world.records.erp.get(victim.records.erp)],
    ['hr record', () => world.records.hr.get(victim.records.hr)],
    ['finance record', () => world.records.finance.get(victim.records.finance)],
    ['document', () => world.documents.get(victim.documentId)],
    ['unified entity', () => world.unified.get(victim.entityIds[0]!)],
    ['graph node', () => world.graph.getNode(victim.graphNodeId)],
    ['memory', () => world.memory.get(victim.memoryId)],
    ['conversation', () => world.conversations.get(victim.conversationId)],
    ['sandbox workspace', () => world.sandboxWorkspaces.get(victim.sandboxWorkspaceId)],
    ['scenario', () => world.scenarios.get(victim.scenarioId)],
    ['execution', () => world.executions.get(victim.executionId)],
    ['artifact', () => world.artifacts.get(victim.artifactId)],
    ['dataset', () => world.datasets.get(victim.datasetId)],
    ['validation run', () => world.validationRuns.get(victim.validationRunId)],
  ] as const;
}

describe('Phase 5 — cross-tenant IDOR matrix (read)', () => {
  it('A → B: every direct id is DENIED', () => {
    w.setScope(TENANT_A);
    const denied: string[] = [];
    for (const [name, attempt] of readAttempts(w, w.b)) {
      if (attempt() === null || attempt() === undefined) denied.push(name);
    }
    expect(denied).toHaveLength(readAttempts(w, w.b).length);
  });

  it('B → A: every direct id is DENIED — symmetric', () => {
    w.setScope(TENANT_B);
    for (const [name, attempt] of readAttempts(w, w.a)) {
      expect(attempt(), `${name} leaked A→B`).toBeFalsy();
    }
  });

  /** The gate is not "always no" — each tenant reaches its own by the same ids. */
  it('each tenant CAN reach its own by the same accessors', () => {
    w.setScope(TENANT_A);
    for (const [name, attempt] of readAttempts(w, w.a)) {
      expect(attempt(), `${name} unreachable for its OWNER`).toBeTruthy();
    }
    w.setScope(TENANT_B);
    for (const [name, attempt] of readAttempts(w, w.b)) {
      expect(attempt(), `${name} unreachable for its OWNER`).toBeTruthy();
    }
  });

  /**
   * A foreign id and a nonexistent id must be INDISTINGUISHABLE, or the refusal
   * itself becomes an existence oracle over another tenant's id space.
   */
  it('a foreign id and an invented id are indistinguishable', () => {
    w.setScope(TENANT_A);
    expect(w.records.crm.get(w.b.records.crm)).toEqual(w.records.crm.get('rec_invented'));
    expect(w.documents.get(w.b.documentId)).toEqual(w.documents.get('doc_invented'));
    expect(w.scenarios.get(w.b.scenarioId)).toEqual(w.scenarios.get('sbs_invented'));
    expect(w.conversations.get(w.b.conversationId)).toEqual(w.conversations.get('conv_invented'));
  });
});

/* ── Phase 6: the cross-tenant WRITE matrix ─────────────────────────────── */

describe('Phase 6 — cross-tenant write matrix', () => {
  it('A cannot UPDATE any of B’s records', () => {
    w.setScope(TENANT_A);
    for (const d of DOMAINS) {
      expect(
        w.records[d].update(w.b.records[d], {
          fields: { name: 'HIJACKED' },
          actor: 'a',
        } as never),
      ).toBeNull();
    }
    w.setScope(TENANT_B);
    for (const d of DOMAINS) {
      expect(w.records[d].get(w.b.records[d])?.title).toContain(MARKER_B);
    }
  });

  it('A cannot DELETE B’s records, documents, datasets or sandbox workspace', () => {
    w.setScope(TENANT_A);
    for (const d of DOMAINS) {
      // `softDelete` is the delete path — it resolves through the scoped
      // `setStatus`, so a foreign id is "not found" rather than deleted.
      expect(w.records[d].softDelete(w.b.records[d], { actor: 'a' })).toBeNull();
    }
    expect(w.datasets.delete(w.b.datasetId)).toBe(false);
    expect(w.sandboxWorkspaces.delete(w.b.sandboxWorkspaceId)).toBe(false);

    w.setScope(TENANT_B);
    for (const d of DOMAINS) {
      const row = w.records[d].get(w.b.records[d]);
      expect(row).not.toBeNull();
      expect(row?.status).not.toBe('deleted');
    }
    expect(w.datasets.get(w.b.datasetId)).not.toBeNull();
    expect(w.sandboxWorkspaces.get(w.b.sandboxWorkspaceId)).not.toBeNull();
  });

  it('A cannot ARCHIVE or re-version B’s scenario', () => {
    w.setScope(TENANT_A);
    expect(w.scenarios.archive(w.b.scenarioId, true)).toBeNull();
    expect(w.scenarios.createVersion(w.b.scenarioId, { evil: true }, 'x')).toBeNull();
    w.setScope(TENANT_B);
    expect(w.scenarios.get(w.b.scenarioId)?.archived).toBe(false);
    expect(w.scenarios.versions(w.b.scenarioId)).toHaveLength(1);
  });

  it('A cannot OVERWRITE B’s conversation or validation run by re-using the id', async () => {
    w.setScope(TENANT_A);
    await w.conversations.upsert({
      id: w.b.conversationId,
      workspaceId: null,
      title: 'HIJACKED',
      pinned: false,
      createdAt: '',
      updatedAt: '',
      parent: null,
      messages: [],
    } as never);
    w.validationRuns.update({
      id: w.b.validationRunId,
      pipeline: 'release-candidate',
      trigger: 'manual',
      status: 'failed',
      startedAt: '',
      finishedAt: null,
      durationMs: 0,
      stages: [],
      metrics: {},
      certificationLevel: null,
      regressionCount: 99,
    } as never);

    w.setScope(TENANT_B);
    expect(w.conversations.get(w.b.conversationId)?.title).toContain(MARKER_B);
    expect(w.validationRuns.get(w.b.validationRunId)?.status).toBe('passed');
  });

  it('A’s own writes still succeed — the boundary denies, it does not freeze', () => {
    w.setScope(TENANT_A);
    const created = w.records.crm.create({
      title: `New ${MARKER_A}`,
      fields: { name: `New ${MARKER_A}`, marker: MARKER_A },
      actor: 'a',
      now: '2026-08-11T13:00:00.000Z',
    });
    expect(w.records.crm.get(created.id)).not.toBeNull();
    w.setScope(TENANT_B);
    expect(w.records.crm.get(created.id)).toBeNull();
  });
});

/* ── Phases 7-12: search, AI context, memory, graph, cross-domain, docs ─── */

describe('Phase 7 — search isolation', () => {
  it('a marker search from A returns A only; from B, B only', () => {
    w.setScope(TENANT_A);
    const aHits = w.unified.query({ limit: 1000, includeDeleted: false }).items;
    expect(aHits.length).toBeGreaterThan(0);
    expect(JSON.stringify(aHits)).not.toContain(MARKER_B);

    w.setScope(TENANT_B);
    const bHits = w.unified.query({ limit: 1000, includeDeleted: false }).items;
    expect(JSON.stringify(bHits)).not.toContain(MARKER_A);
  });

  /**
   * COUNTS are a leak too. An install-wide total tells one tenant how much data
   * another holds, without returning a single row of it.
   */
  it('counts never span tenants', () => {
    w.setScope(TENANT_A);
    const aCount = w.unified.query({ limit: 1000, includeDeleted: false }).items.length;
    w.setScope(TENANT_B);
    const bCount = w.unified.query({ limit: 1000, includeDeleted: false }).items.length;
    w.setScope(null);
    expect(w.unified.query({ limit: 1000, includeDeleted: false }).items).toHaveLength(0);
    expect(aCount).toBe(bCount); // symmetric fixtures
  });

  it('the search index does not admit a foreign entity by direct id', () => {
    w.setScope(TENANT_A);
    for (const id of w.b.entityIds) expect(w.unified.get(id)).toBeNull();
  });
});

describe('Phase 9 — memory isolation', () => {
  it('B cannot retrieve A’s memory by id or by content', () => {
    w.setScope(TENANT_B);
    expect(w.memory.get(w.a.memoryId)).toBeNull();
    const hits = w.memory.recall({ text: MARKER_A, limit: 50 });
    expect(JSON.stringify(hits)).not.toContain(MARKER_A);
  });

  it('A retrieves its OWN memory by the same accessors', () => {
    w.setScope(TENANT_A);
    expect(w.memory.get(w.a.memoryId)).not.toBeNull();
  });
});

describe('Phase 10 — graph isolation', () => {
  it('a foreign node is invisible by direct id and absent from traversal', () => {
    w.setScope(TENANT_A);
    expect(w.graph.getNode(w.b.graphNodeId)).toBeNull();
    expect(JSON.stringify(w.graph.listNodes({ limit: 500 }))).not.toContain(MARKER_B);
  });

  it('neighbors from a tenant’s own node never cross into the other tenant', () => {
    w.setScope(TENANT_A);
    const n = w.graph.neighbors(w.a.graphNodeId, { limit: 50 } as never);
    expect(JSON.stringify(n)).not.toContain(MARKER_B);
  });
});

describe('Phase 11 — ERP / CRM / HR / Finance cross-domain', () => {
  /**
   * The cross-domain chain the program names: a query that joins four domains
   * must resolve every leg inside one tenant. Mixing A's supplier with B's
   * finance is the composite attack, and it fails because each leg is scoped
   * independently — there is no join that can widen it.
   */
  it('a four-domain chain resolves entirely within one tenant', () => {
    w.setScope(TENANT_A);
    const chain = DOMAINS.map((d) => w.records[d].get(w.a.records[d]));
    expect(chain.every((r) => r !== null)).toBe(true);
    expect(JSON.stringify(chain)).not.toContain(MARKER_B);
  });

  it('A supplier + B finance is DENIED — the composite cannot be assembled', () => {
    w.setScope(TENANT_A);
    const aErp = w.records.erp.get(w.a.records.erp);
    const bFinance = w.records.finance.get(w.b.records.finance);
    expect(aErp).not.toBeNull();
    expect(bFinance).toBeNull(); // the second leg simply does not resolve
  });

  it('A employee + B finance is DENIED', () => {
    w.setScope(TENANT_A);
    expect(w.records.hr.get(w.a.records.hr)).not.toBeNull();
    expect(w.records.finance.get(w.b.records.finance)).toBeNull();
  });

  it('A customer + B order is DENIED', () => {
    w.setScope(TENANT_A);
    expect(w.records.crm.get(w.a.records.crm)).not.toBeNull();
    expect(w.records.erp.get(w.b.records.erp)).toBeNull();
  });
});

describe('Phase 12 — document isolation', () => {
  it('B cannot open A’s document, and A’s content never appears in B’s list', () => {
    w.setScope(TENANT_B);
    expect(w.documents.get(w.a.documentId)).toBeNull();
    expect(JSON.stringify(w.documents.all())).not.toContain(MARKER_A);
  });

  /**
   * The content-hash oracle: an identical upload by the other tenant must
   * produce its OWN record, not adopt the first tenant's.
   */
  it('an identical upload by the other tenant produces its own record', async () => {
    const body = Buffer.from('IDENTICAL BYTES', 'utf8');
    const meta = {
      uploadedAt: '2026-08-11T14:00:00.000Z',
      uploadedBy: 'x',
      kind: 'unknown',
      readable: true,
      unreadableReason: null,
      fields: [],
      issues: [],
      links: [],
      corrections: [],
    };
    w.setScope(TENANT_A);
    const ra = await w.documents.put(body, { ...meta, filename: 'same.txt' } as never);
    w.setScope(TENANT_B);
    const rb = await w.documents.put(body, { ...meta, filename: 'same.txt' } as never);

    expect(ra.id).not.toBe(rb.id);
    w.setScope(TENANT_A);
    expect(w.documents.get(rb.id)).toBeNull();
  });
});

describe('Phase 13 — notification isolation', () => {
  it('A’s alert never reaches B’s inbox, badge or total', () => {
    w.setScope(TENANT_B);
    const page = w.inbox.page(200);
    expect(JSON.stringify(page.items)).not.toContain(MARKER_A);
    expect(page.total).toBe(1);
    expect(w.inbox.unreadCount()).toBe(1);
  });

  it('marking ALL read clears only the caller’s tenant', async () => {
    w.setScope(TENANT_A);
    expect(await w.inbox.markRead('all')).toBe(1);
    expect(w.inbox.unreadCount()).toBe(0);
    w.setScope(TENANT_B);
    expect(w.inbox.unreadCount()).toBe(1);
  });
});

describe('Phase 17/18/19 — sandbox, validation and conversations', () => {
  it('sandbox artifact CONTENT never crosses', () => {
    w.setScope(TENANT_B);
    expect(w.artifacts.get(w.a.artifactId)).toBeNull();
    expect(JSON.stringify(w.artifacts.all())).not.toContain(MARKER_A);
  });

  it('validation history and benchmark baselines never cross', () => {
    w.setScope(TENANT_B);
    expect(w.validationRuns.get(w.a.validationRunId)).toBeNull();
    expect(JSON.stringify(w.validationRuns.history())).not.toContain(MARKER_A);
    // A's benchmark value is MARKER_A.length; B's own is MARKER_B.length.
    expect(w.benchmarks.baseline('graph', 'latencyMs', '2.0.0')).toBe(MARKER_B.length);
  });

  it('conversation list() and list(null) both mean MINE', () => {
    w.setScope(TENANT_B);
    expect(JSON.stringify(w.conversations.list())).not.toContain(MARKER_A);
    expect(JSON.stringify(w.conversations.list(null))).not.toContain(MARKER_A);
  });
});

/* ── Phase 13 (audit) ───────────────────────────────────────────────────── */

describe('Phase 13 — audit isolation', () => {
  it('an audit trail is readable only by the workspace that wrote it', () => {
    const aEntries = w.governance.auditEntries(100, TENANT_A);
    const bEntries = w.governance.auditEntries(100, TENANT_B);

    expect(JSON.stringify(aEntries)).toContain(MARKER_A);
    expect(JSON.stringify(aEntries)).not.toContain(MARKER_B);
    expect(JSON.stringify(bEntries)).toContain(MARKER_B);
    expect(JSON.stringify(bEntries)).not.toContain(MARKER_A);
  });

  it('an unresolved scope reads no audit at all', () => {
    expect(w.governance.auditEntries(100, null as never)).toEqual([]);
  });
});
