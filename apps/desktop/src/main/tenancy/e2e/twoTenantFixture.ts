/**
 * TWO REAL TENANTS, ONE INSTALL — the certification fixture.
 *
 * WHY THIS IS A SHIPPED MODULE AND NOT A TEST HELPER
 *
 * Program 13C's certification asks the same question of fourteen subsystems:
 * given two tenants with data in every domain, can either reach the other's?
 * Fourteen suites each building their own two tenants would be fourteen chances
 * to build them slightly differently — and the one that accidentally gives both
 * tenants the same id would pass every assertion for the wrong reason.
 *
 * So the world is built ONCE, here, and every certification suite imports it.
 *
 * THE SETUP IS THE POINT, and it is deliberately hostile:
 *
 *   · ONE store instance per domain, ONE file on disk, TWO tenants inside it.
 *     That is exactly what the product does — 106 module stores, one JSON file
 *     each, one install. If isolation only held when the tenants had separate
 *     files it would not be isolation, it would be separate installs.
 *
 *   · `scope` is a MUTABLE variable every store reads through its binding.
 *     Switching tenants in these tests is the same operation the application
 *     performs, not a reconstruction — a reconstruction would quietly discard
 *     the other tenant's rows and make every assertion vacuous.
 *
 *   · Every value carries its tenant's MARKER. A leak through any domain
 *     therefore fails one string assertion, rather than requiring somebody to
 *     have remembered to check that particular field.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EnterpriseModuleDescriptor,
  MemoryViewer,
  TenantScope,
  UnifiedEntity,
  UnifiedEntityKind,
} from '@neuropause/shared';
import { EnterpriseRecordStore } from '../../enterprise/framework/enterpriseRecordStore';
import { DocumentStore } from '../../documents/documentStore';
import { GovernanceStore } from '../../enterprise/governance/governanceStore';
import { InboxStore } from '../../notifications/inboxStore';
import { UnifiedStore } from '../../unified/unifiedStore';
import { GraphStore } from '../../graph/graphStore';
import { MemoryStore } from '../../memory/memoryStore';
import { makeUnifiedId } from '../../unified/ids';
import { ConversationStore } from '../../assistant/conversationStore';
import { SandboxWorkspaceStore } from '../../sandbox/workspaceStore';
import { SandboxScenarioStore } from '../../sandbox/scenarioStore';
import { SandboxExecutionStore } from '../../sandbox/executionStore';
import { SandboxArtifactStore } from '../../sandbox/artifactStore';
import { SandboxDatasetStore } from '../../sandbox/datasetStore';
import { ValidationRunStore } from '../../sandbox/validation/runStore';
import { BenchmarkStore } from '../../sandbox/lab/benchmarkStore';

export const NOW = '2026-08-11T12:00:00.000Z';

/** The two tenants. Distinct in BOTH fields, so a half-correct filter fails. */
export const TENANT_A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
export const TENANT_B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };
/** A second workspace inside tenant A, for the workspace-switch phases. */
export const TENANT_A2: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a2' };

/**
 * The canaries. One string per tenant, embedded in EVERY record that tenant
 * owns, across every domain.
 *
 * A single `expect(blob).not.toContain(MARKER_A)` therefore covers CRM, ERP, HR,
 * finance, documents, search, graph, memory, notifications, audit, sandbox,
 * validation and conversations at once — and covers the fields nobody thought
 * to assert on individually, which is where a leak actually hides.
 */
export const MARKER_A = 'NP-TENANT-A-984731';
export const MARKER_B = 'NP-TENANT-B-472186';

export const USER_A = 'alice@a.example';
export const USER_B = 'bob@b.example';

function moduleDescriptor(id: string, title: string): EnterpriseModuleDescriptor {
  return {
    id,
    title,
    singular: title,
    plural: title,
    icon: 'box',
    description: `${title} for certification`,
    titleField: 'name',
    permissions: { read: 'crm:read', write: 'crm:manage' },
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'marker', label: 'Marker', type: 'text' },
    ],
  };
}

/** The four business domains the program names, as real record stores. */
export const DOMAINS = ['crm', 'erp', 'hr', 'finance'] as const;
export type DomainId = (typeof DOMAINS)[number];

/** Every id a tenant owns, so the IDOR matrix can be driven from data. */
export interface TenantIds {
  scope: TenantScope;
  marker: string;
  user: string;
  records: Record<DomainId, string>;
  documentId: string;
  entityIds: string[];
  graphNodeId: string;
  memoryId: string;
  notificationId: string;
  conversationId: string;
  sandboxWorkspaceId: string;
  scenarioId: string;
  executionId: string;
  artifactId: string;
  datasetId: string;
  validationRunId: string;
}

export interface TwoTenantWorld {
  dir: string;
  /** THE tenant switch. Assign to this and every store re-resolves. */
  setScope: (s: TenantScope | null) => void;
  getScope: () => TenantScope | null;

  records: Record<DomainId, EnterpriseRecordStore>;
  documents: DocumentStore;
  governance: GovernanceStore;
  inbox: InboxStore;
  unified: UnifiedStore;
  graph: GraphStore;
  memory: MemoryStore;
  conversations: ConversationStore;
  sandboxWorkspaces: SandboxWorkspaceStore;
  scenarios: SandboxScenarioStore;
  executions: SandboxExecutionStore;
  artifacts: SandboxArtifactStore;
  datasets: SandboxDatasetStore;
  validationRuns: ValidationRunStore;
  benchmarks: BenchmarkStore;

  a: TenantIds;
  b: TenantIds;
  dispose: () => Promise<void>;
}

function entity(
  tenant: TenantScope,
  kind: UnifiedEntityKind,
  sourceId: string,
  title: string,
  body: string,
): UnifiedEntity {
  return {
    id: makeUnifiedId(tenant.tenantId, 'hubspot', 'acct-shared', kind, sourceId),
    kind,
    connectorId: 'hubspot',
    accountId: 'acct-shared',
    sourceId,
    createdAt: NOW,
    updatedAt: NOW,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title,
    url: null,
    parentId: null,
    containerId: null,
    body,
    status: null,
    author: null,
    timestamp: NOW,
    endTimestamp: null,
    labels: [],
  } as UnifiedEntity;
}

/**
 * Build the whole world. One call, both tenants, every domain populated.
 *
 * NOTE the deliberate ordering: tenant A is written FIRST in every store. If
 * any store retained a "first writer wins" habit — the `organizations[0]` shape
 * this program spent three sessions removing — B's assertions are the ones that
 * fail, and they fail loudly.
 */
export async function buildTwoTenantWorld(): Promise<TwoTenantWorld> {
  const dir = join(tmpdir(), `np-cert-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });

  let scope: TenantScope | null = TENANT_A;
  const src = (): TenantScope | null => scope;
  const viewer = (): MemoryViewer | null =>
    scope === null
      ? null
      : { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: 'cert@example' };

  const records = {} as Record<DomainId, EnterpriseRecordStore>;
  for (const d of DOMAINS) {
    const desc = moduleDescriptor(d, d.toUpperCase());
    const store = new EnterpriseRecordStore(join(dir, `${d}.json`), desc.id, desc.id);
    store.bindScope(src);
    await store.load();
    records[d] = store;
  }

  const documents = new DocumentStore(join(dir, 'documents.json'), join(dir, 'blobs'), () => NOW)
    .bindScope(src);
  /**
   * P13C Round 6 — bound like every other store here. `record()` now resolves the
   * owner instead of trusting the caller's `workspaceId`, and the seeding loop
   * below already sets `scope = tenant` before it writes, so each row is stamped
   * with the tenant that actually wrote it. Two organizations exist in this
   * world, which is what `bindOrganizationCount` reports.
   */
  const governance = new GovernanceStore(join(dir, 'governance.json'))
    .bindScope(src)
    .bindOrganizationCount(() => 2);
  const inbox = new InboxStore(join(dir, 'inbox.json')).bindScope(src);
  const unified = new UnifiedStore(join(dir, 'unified.json')).bindScope(src);
  const graph = new GraphStore(join(dir, 'graph.json')).bindScope(src);
  const memory = new MemoryStore(join(dir, 'memory.json'));
  memory.bindViewer(viewer);
  const conversations = new ConversationStore(join(dir, 'conversations.json')).bindScope(src);
  const sandboxWorkspaces = new SandboxWorkspaceStore(join(dir, 'sbw.json')).bindScope(src);
  const scenarios = new SandboxScenarioStore(join(dir, 'sbs.json')).bindScope(src);
  const executions = new SandboxExecutionStore(join(dir, 'sbe.json')).bindScope(src);
  const artifacts = new SandboxArtifactStore(join(dir, 'sba.json')).bindScope(src);
  const datasets = new SandboxDatasetStore(join(dir, 'sbd.json')).bindScope(src);
  const validationRuns = new ValidationRunStore(join(dir, 'vruns.json')).bindScope(src);
  const benchmarks = new BenchmarkStore(join(dir, 'bench.json')).bindScope(src);

  await Promise.all([
    documents.ensureDir().then(() => documents.load()),
    governance.load(),
    unified.load(),
    graph.load(),
    memory.load(),
    sandboxWorkspaces.load(),
    scenarios.load(),
    executions.load(),
    artifacts.load(),
    datasets.load(),
    validationRuns.load(),
    benchmarks.load(),
  ]);
  inbox.loadAllSync();

  async function populate(tenant: TenantScope, marker: string, user: string): Promise<TenantIds> {
    scope = tenant;

    const recordIds = {} as Record<DomainId, string>;
    for (const d of DOMAINS) {
      recordIds[d] = records[d]!.create({
        title: `${d.toUpperCase()} ${marker}`,
        fields: { name: `${d.toUpperCase()} ${marker}`, marker },
        actor: user,
        now: NOW,
      }).id;
    }

    const doc = await documents.put(
      Buffer.from(`Confidential contract body. ${marker}`, 'utf8'),
      {
        filename: `Contract ${marker}.txt`,
        uploadedAt: NOW,
        uploadedBy: user,
        kind: 'unknown',
        readable: true,
        unreadableReason: null,
        fields: [],
        issues: [],
        links: [],
        corrections: [],
      } as never,
    );

    const entities = [
      entity(tenant, 'contact', `${marker}-crm`, `CRM Customer ${marker}`, `CRM. ${marker}`),
      entity(tenant, 'task', `${marker}-erp`, `ERP Order ${marker}`, `ERP. ${marker}`),
      entity(tenant, 'contact', `${marker}-hr`, `HR Employee ${marker}`, `HR. ${marker}`),
      entity(tenant, 'organization', `${marker}-fin`, `Finance Account ${marker}`, `Finance. ${marker}`),
      entity(tenant, 'document', `${marker}-doc`, `Document ${marker}`, `Doc. ${marker}`),
    ];
    await unified.upsertMany(entities, tenant.tenantId);

    const nodeId = `person:${marker}`;
    const gnode = (id: string, label: string) => ({
      id,
      type: 'person' as const,
      label,
      sourceKind: 'task' as const,
      sourceId: id,
      connectorId: 'hubspot',
      createdAt: NOW,
      updatedAt: NOW,
      metadata: {},
    });
    graph.apply(
      [
        gnode(nodeId, `Person ${marker}`),
        { ...gnode(`org:${marker}`, `Org ${marker}`), type: 'organization' as const },
      ],
      [
        {
          id: `${nodeId}|rel|org:${marker}`,
          type: 'rel',
          from: nodeId,
          to: `org:${marker}`,
          label: 'member_of',
          createdAt: NOW,
          updatedAt: NOW,
          evidence: null,
          metadata: {},
        } as never,
      ],
      NOW,
    );

    const mem = memory.remember(
      {
        kind: 'note',
        title: `Memory ${marker}`,
        content: `Confidential memory content. ${marker}`,
      },
      NOW,
    );

    const notificationId = `notify-${marker}`;
    await inbox.add({
      id: notificationId,
      title: `Alert ${marker}`,
      body: `Something happened. ${marker}`,
      priority: 'high',
      sourceKey: 'work-failed',
      deepLink: null,
      at: NOW,
      read: false,
    } as never);

    governance.record({
      actor: user,
      action: 'record.create',
      target: recordIds.crm,
      summary: `Created CRM record ${marker}`,
      workspaceId: tenant.workspaceId,
    });

    const conversationId = `conv-${marker}`;
    await conversations.upsert({
      id: conversationId,
      workspaceId: tenant.workspaceId,
      title: `Conversation ${marker}`,
      pinned: false,
      createdAt: NOW,
      updatedAt: NOW,
      parent: null,
      messages: [],
    } as never);

    const sbw = sandboxWorkspaces.create({ name: `Sandbox ${marker}` });
    const scenario = scenarios.create({
      workspaceId: sbw.id,
      key: `key-${marker}`,
      name: `Scenario ${marker}`,
    });
    const version = scenarios.createVersion(scenario.id, { secret: marker }, 'v1');
    const execution = executions.create({
      workspaceId: sbw.id,
      scenarioId: scenario.id,
      scenarioVersion: version!.version,
      trigger: 'manual',
      priority: 'normal',
    });
    const artifact = artifacts.add({
      executionId: execution.id,
      workspaceId: sbw.id,
      kind: 'log',
      name: `${marker}.log`,
      inline: `Run output. ${marker}`,
    });
    const dataset = datasets.create({ workspaceId: sbw.id, name: `Dataset ${marker}` });

    const validationRunId = `vrun-${marker}`;
    validationRuns.add({
      id: validationRunId,
      pipeline: 'release-candidate',
      trigger: 'manual',
      status: 'passed',
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 1000,
      stages: [{ id: 's1', name: `Stage ${marker}`, status: 'pass' }],
      metrics: { kpi: 1 },
      certificationLevel: 'certified',
      regressionCount: 0,
    } as never);
    benchmarks.record({
      target: 'graph',
      metric: 'latencyMs',
      version: '1.0.0',
      value: marker.length,
    });

    return {
      scope: tenant,
      marker,
      user,
      records: recordIds,
      documentId: doc.id,
      entityIds: entities.map((e) => e.id),
      graphNodeId: nodeId,
      memoryId: (mem as { id: string }).id,
      notificationId,
      conversationId,
      sandboxWorkspaceId: sbw.id,
      scenarioId: scenario.id,
      executionId: execution.id,
      artifactId: artifact.id,
      datasetId: dataset.id,
      validationRunId,
    };
  }

  const a = await populate(TENANT_A, MARKER_A, USER_A);
  const b = await populate(TENANT_B, MARKER_B, USER_B);
  scope = TENANT_A;

  return {
    dir,
    setScope: (s) => {
      scope = s;
    },
    getScope: () => scope,
    records,
    documents,
    governance,
    inbox,
    unified,
    graph,
    memory,
    conversations,
    sandboxWorkspaces,
    scenarios,
    executions,
    artifacts,
    datasets,
    validationRuns,
    benchmarks,
    a,
    b,
    dispose: async () => {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}
