/**
 * What is actually tenant-enforced, measured rather than asserted.
 *
 * WHY THIS IS CODE AND NOT A DOCUMENT
 *
 * A markdown table claiming "CRM: isolated" is a claim that rots the moment
 * someone adds a store. This reads the live registry, counts real records, and
 * reports per store — so the answer is produced by the same objects that enforce
 * the boundary, and a store that loses its binding shows up here rather than in
 * an incident.
 *
 * The statuses are deliberately unflattering. Most of this system is `PARTIAL`
 * or `REQUIRES_MIGRATION` today, and a vocabulary without those words would
 * force every entry into either a lie or a failure. `COMPLETE` means scope is
 * enforced AND no unowned records remain — a store with one unresolved row is
 * `PARTIAL`, not "done with a caveat".
 *
 * THE UNENFORCED STORES ARE LISTED TOO, BY NAME. That is the point of the file:
 * a report that only listed successes would be a worse artefact than no report,
 * because it would read as completeness.
 */
import type {
  TenantMigrationEntry,
  TenantMigrationInventory,
  TenantMigrationStatus,
} from '@neuropause/shared';
import type { EnterpriseModuleRegistry } from '../enterprise/framework/moduleRegistry';

/**
 * Stores that are NOT tenant-enforced, named individually.
 *
 * Hand-maintained, which is a real weakness — a new store will not appear here
 * until someone adds it. It is still worth having, because the alternative is an
 * inventory that silently reports only the stores that were migrated and
 * therefore looks complete. Every entry says what would be exposed.
 */
const UNENFORCED: readonly { store: string; status: TenantMigrationStatus; note: string }[] = [
  {
    store: 'documents (documentStore)',
    status: 'PARTIAL',
    note: 'P12 — DocumentRecord carries a scope; `get`, `all`, `count` and `existingByHash` are all scoped, so the content-hash oracle is closed and an identical upload by a second tenant produces its own record. The BLOB POOL remains shared and content-addressed by design, so the reference count spans tenants (deleting one tenant\u2019s record must not delete bytes another still names). Pre-P12 documents are unresolved and visible to nobody.',
  },
  {
    store: 'relationships (relationshipStore)',
    status: 'PARTIAL',
    note: 'Link CREATION is now scoped, because the resolver builds its candidate index from a scoped `store.list()`. Existing links written before P11 are not scoped, and `outgoing`/`incoming` still scan every link, so a pre-existing cross-tenant edge would still traverse.',
  },
  {
    store: 'provenance (ProvenanceStore)',
    status: 'PARTIAL',
    note: 'P13A — ProvenanceRecord and ImportResult carry a scope, stamped from the active scope on write and never from the payload. Both indexes are keyed (tenant, key), so the `byExternal` collision is closed: two tenants syncing the same provider account now get one row each, and the second no longer adopts and overwrites the first’s. `forRecord`, `forPlan`, `forConnection`, `forExternalKey`, `history`, `run`, `counts` and `countForModule` are all scoped, and eviction is confined to the writing tenant. Rows written before P13A are unresolved and visible to nobody.',
  },
  {
    store: 'decisions / holds',
    status: 'PARTIAL',
    note: 'P12 — HoldRecord and DecisionRecord carry a scope, and every read goes through the base class\u2019s `visible()`. The subject de-dupe is now (scope, subject), so two tenants holding `record:X` get two holds. `resolveSubject` cannot reach across. Pre-P12 rows are unresolved. APPROVALS (erp/approvalStore) are still unscoped \u2014 listed separately.',
  },
  {
    store: 'erp document lines (DocumentLineStore)',
    status: 'REQUIRES_MIGRATION',
    note: 'No scope field; `forDocument` filters on documentType + documentId over one global array. The `enterprise:module.lines` channel now refuses an out-of-scope record id, which closes the reachable read — but the store itself is unscoped, so any future reader of it is a new exposure.',
  },
  {
    store: 'erp approvals (approvalStore)',
    status: 'REQUIRES_MIGRATION',
    note: 'Keyed `moduleId/documentId` with no scope. The approval and approve channels gate on a scoped `store.get` first, so the reachable paths are covered; the store is not.',
  },
  {
    store: 'memory (memoryStore + vectorStore + liveSync bridge)',
    status: 'PARTIAL',
    note: 'P13A \u2014 MemoryItem carries an owner (SYSTEM / TENANT / WORKSPACE / PERSONAL) stamped by `remember` from the resolved viewer; `remember` throws rather than create an unowned memory. `filterFor` enforces it and every retrieval leg resolves through it \u2014 lexical, semantic, the hybrid union and the degraded fallback \u2014 so the isolated vector half is no longer defeated by the union. `get`, `update`, `forget`, `counts`, `allItems` (backfill egress) and `syncedItems` (sync egress) are scoped; the outbound bridge enqueues under each memory\u2019s OWN org rather than the active one, and an inbound apply is refused unless the payload carries an owner the viewer may read. PROJECTED memories inherit the projecting viewer\u2019s tenant; as of P13B their source (the unified store) IS scoped, so that stamp is derived rather than assumed \u2014 a projection can only have read the tenant\u2019s own entities. Memories written before P13A are unresolved and visible to nobody.',
  },
  {
    store: 'AI context (contextBuilder, enterpriseSearch)',
    status: 'PARTIAL',
    note: 'P13B \u2014 every leg of `runEnterpriseSearch` is now bounded by its own store\u2019s binding: entity (partitioned index), graph (scoped reads), memory (P13A + required `memoryScope`) and timeline (scoped event log). The context builder therefore reaches the model with one tenant\u2019s data. `RetrievalPorts.governanceFilter` is still wired nowhere \u2014 it is now a defence in depth rather than the only seam, because the boundary sits in the stores. Briefings read the same scoped sources.',
  },
  {
    store: 'unified store + local search index',
    status: 'PARTIAL',
    note: 'P13B \u2014 UnifiedEntity carries a scope, stamped on write from the active scope and never from the payload; the TENANT is now part of the Unified Identifier, so two tenants syncing the same provider account no longer collide on one row. `get`, `query`, `counts`, `countForConnector`, `markDeleted` and `removeConnector` are scoped, and a disconnect purges only the disconnecting tenant. The SEARCH INDEX is PARTITIONED per tenant rather than filtered, which removes the TF-IDF oracle: idf was computed from global document counts and returned inside the relevance score. `upsertMany` takes the writer\u2019s expected tenant and refuses if the active organization changed mid-run. Records synced before P13B are unresolved and visible to nobody.',
  },
  {
    store: 'graph (graphStore)',
    status: 'PARTIAL',
    note: 'P13B \u2014 nodes AND edges carry a scope. `getNode`, `listNodes`, `neighbors`, `subgraph`, `path`, `historyFor` and `counts` are scoped, and traversal re-checks the EDGE and the FAR NODE at every hop \u2014 so a corrupt or planted cross-tenant edge is a dead end rather than a bridge, without relying on the data being clean. `apply` replaces only the rebuilding tenant\u2019s slice (it previously deleted every other tenant\u2019s nodes) and refuses to take a node id already owned elsewhere. Synthesised node ids (`person:`, `connector:`, `app:`) are tenant-qualified. The relationship HISTORY log remains a single unstamped array with a shared cap, so a churny tenant can still evict another\u2019s history \u2014 events are filtered on read but the retention is shared.',
  },
  {
    store: 'notifications (inboxStore)',
    status: 'PARTIAL',
    note: 'P12 — items carry a scope; the de-dupe key is (scope, id) so the stable-per-subject ids no longer collide across tenants; `page`, `unreadCount` and `markRead("all")` are scoped. A delivery with no tenant is refused rather than stored unowned. P13C \u2014 THE PATH INTO THE STORE IS NOW SCOPED TOO, which is what P12 could not claim. Scheduled items are produced once per tenant under that tenant\u2019s principal; a BUS-DRIVEN item is delivered under a principal built from the EVENT\u2019s own tenant (P13B stamped it), so a connector failure raised by tenant A no longer lands in whichever inbox happens to be open, and an UNOWNED event is dropped rather than given to somebody. The re-delivery cooldown is keyed by (tenant, item): unkeyed, one tenant\u2019s alert silenced another\u2019s for thirty minutes. The unread count broadcast to the renderer is computed OUTSIDE the running principal, so a background pass for A cannot push A\u2019s badge into a window showing B. A SYSTEM-scoped event (runtime supervisor) is deliberately fanned to every tenant \u2014 it carries no customer data by construction. Pre-P12 items remain unresolved.',
  },
  {
    store: 'audit reads (governanceStore)',
    status: 'PARTIAL',
    note: 'P12 — `auditEntries` and `auditCount` take a scope and filter the OUTPUT (never the array: the tamper-evident chain is order-sensitive). The renderer channel, the trust model and the medical-device reader all pass the active scope. Entries written before P11 have no workspaceId and are visible to nobody. Approval chains and compliance rules remain global.',
  },
  {
    store: 'platform event log + Enterprise Timeline',
    status: 'PARTIAL',
    note: 'P13B \u2014 ADDED TO THIS INVENTORY, having been absent from it. `PlatformEvent` had no scope at all, and the Enterprise Timeline fuses it with (scoped) entities, so every briefing and the timeline leg of Enterprise Search were unscoped no matter how well the entities were guarded \u2014 and `timeline:export` returned the whole durable log over an ungated channel. Events are now stamped at the single materialization point in the bus from the resolved tenant (producers cannot supply one), and `query`, `stats` and `export` all filter. Events written before P13B, and those published with no active tenant (boot, background timers), are unowned and shown to nobody \u2014 which means some legitimate system activity is now invisible in the timeline until its producers carry a tenant. That is the background-jobs entry below.',
  },
  {
    store: 'import plan cache (dataPlane)',
    status: 'REQUIRES_MIGRATION',
    note: 'Plans are held in a Map keyed by planId with no owner, so any caller holding a planId can preview or execute it. The ids are uuids, so this is a capability with no holder rather than a guessable one.',
  },
  {
    store: 'TTL model caches (relationship / trust / process-mining providers)',
    status: 'BLOCKED',
    note: 'Each is a single keyless `let cache` with a ~2.5s TTL, built by fanning out reads across dozens of stores. Their INPUTS are now scoped, so a cache built by tenant A holds A’s data — but it is then served to whoever asks within the TTL. Blocked rather than partial: keying them requires a scope-aware invalidation design, not a filter.',
  },
  {
    store: 'background jobs (every timer)',
    status: 'PARTIAL',
    note: 'P13C — every recurring timer is now classified and carries a principal. TENANT/WORKSPACE-SCOPED: the delivery engine (per tenant), connector sync (per WORKSPACE, because a connection is a workspace object), the workforce queue (principal captured at ENQUEUE, so a job queued in A still runs as A after the user switches to B), the webhook dispatcher (P13C 2a), and the graph and memory reprojections. SYSTEM_GLOBAL, under an explicit system principal so they cannot inherit the open organization: runtime supervisor, health monitor, update checker, scheduled backup. The fan-out itself replaces the deeper defect — there was ONE timer per install resolving the signed-in user’s workspace, so the wrong tenant ran AND every other tenant never ran at all. PARTIAL rather than COMPLETE because the fan-out reads the live organization roster: a job’s correctness now depends on that roster being right, and a tenant created while a tick is in flight is picked up on the NEXT tick, not this one.',
  },
  {
    store: 'scheduled backup (backupManager)',
    status: 'BLOCKED',
    note: 'P13C — classified SYSTEM_GLOBAL after inspection, not by default. `create` is `fs.copyFile` over DOMAIN_FILES: it never opens a scoped store and never reads a record, so it operates below the application authorization layer entirely. A per-tenant backup is not expressible because every tenant’s records share one JSON file per module — the same reason “the filesystem itself” is BLOCKED below. What the classification obliges is done: it runs under a SYSTEM principal so its events are not stamped into whichever organization is open, and its destination stays inside userData, so it is not an egress. A privileged local user reads a backup exactly as they read the live files.',
  },
  {
    store: 'medical device pack (LotService / TraceService / TraceEdgeStore)',
    status: 'PARTIAL',
    note: 'P12 — `deviceTenantId()` returned the literal string \u2018default\u2019, so the pack\u2019s real and tested isolation machinery filtered every read on a value that never changed. It now reads the live resolver, falling back to \u2018default\u2019 only when no tenant resolves so existing lots stay readable during cold start. `TraceEdgeStore` itself is still unscoped. This surface was absent from the Program 11 inventory.',
  },
  {
    store: 'organization roster + platform read models',
    status: 'PARTIAL',
    note: 'P13C REMEDIATION — the first organization is no longer an authorization fallback. `activeOrg()` ended in `?? defaultOrg()` and reached WRITES (it was stamped as orgId on unit/user/role creates) and the read model that returns the member list; it now resolves through `activeTenantScope()` and returns null. Seven platform read models (Insight, Knowledge Assets, Automation, Operations, Strategy) built from `defaultOrg()` now resolve per call and degrade to empty. `syncWorkers` took no tenant at all: it wrote every tenant’s AI workers into the first organization, UPDATED rows across organizations, and — unreported until this pass — its prune loop DELETED other tenants’ AI members whose ids were absent from the list it was given; it now takes an explicit orgId, scopes its index and prune, and is fanned out per tenant. Org intelligence, a scheduled DELIVERED source, reported the first tenant’s licence and headcount plus an install-wide workspace count, and is now scope-bound. PARTIAL, not COMPLETE: see the sandbox and assistant entries below.',
  },
  {
    store: 'caller-supplied tenant identifiers (IPC)',
    status: 'PARTIAL',
    note: 'P13C REMEDIATION — `requireAuth` proves someone is signed in and nothing about WHICH tenant they may act in. Fourteen cloud org/device/billing channels forwarded a renderer-supplied `orgId` on that basis alone; they now validate it against the caller’s own membership list (fail-closed if the backend is unreachable, and one refusal message so existence cannot be probed). The ecosystem/marketplace surface was keyed on the seeded ORG_ID and additionally let `uninstall`/`setDisabled` act on any installation id — both now resolve the id inside the caller’s partition first. Cloud tenancy list channels treated an ABSENT tenantId as "every tenant", which made omitting the field the bypass; the tenant is now server-resolved and never read from a payload. The two license channels are public (no auth, no permission) and took orgId from the request — they now ignore it. STILL OPEN: the Sandbox subsystem and the assistant conversation store, below.',
  },
  {
    store: 'sandbox (workspaces / scenarios / executions / datasets)',
    status: 'REQUIRES_MIGRATION',
    note: 'HIGH, OPEN. `SandboxWorkspace` has no orgId or tenantId field at all, so nothing downstream can be scoped: scenarios, executions, artifacts and datasets hang off a workspace id alone. `SandboxWorkspaceList` returns every sandbox workspace on the install; scenario/execution/dataset/dashboard reads take a payload workspaceId that is never checked against the caller, and two of them make it OPTIONAL so omitting it is the bypass; creates write into a caller-named workspace. `sandbox:read`/`sandbox:manage` gate the capability, never the tenant. Requires a schema change plus a scoped store, which is why it is not closed in this pass — it is stated here rather than carried silently.',
  },
  {
    store: 'assistant conversations (conversationStore)',
    status: 'REQUIRES_MIGRATION',
    note: 'MEDIUM, OPEN. `list(workspaceId, limit)` treats null/undefined as "no filter", returning every conversation on the install, and the request schema makes the field nullable AND optional — so `{}` is a valid payload that returns everything. `get(conversationId)` selects by bare id with no scope check. These channels are on the PUBLIC allowlist: no requireAuth, no permission. Conversation bodies carry assistant answers synthesised from tenant data.',
  },
  {
    store: 'the filesystem itself',
    status: 'BLOCKED',
    note: 'Every tenant\u2019s records live in one mode-0600 JSON file per module under userData. The boundary is a same-process, same-OS-user filter: anyone who can read those files reads every tenant directly and bypasses all of the above. Inherent to a desktop app, and it caps what this program can honestly claim.',
  },
];

export interface MigrationInventoryDeps {
  registry: EnterpriseModuleRegistry;
  now: () => string;
}

export async function buildMigrationInventory(
  deps: MigrationInventoryDeps,
): Promise<TenantMigrationInventory> {
  const entries: TenantMigrationEntry[] = [];

  /**
   * The 106 module stores, counted individually.
   *
   * Rolled up per store rather than as one "ERP" line, because "ERP is
   * migrated" is exactly the kind of summary that hides the one module that
   * is not.
   */
  for (const module of deps.registry.list()) {
    await module.store.load();
    const counts = module.store.ownershipCounts();
    const scoped = module.store.hasScope();
    const status: TenantMigrationStatus = !scoped
      ? 'REQUIRES_MIGRATION'
      : counts.unresolved > 0
        ? 'PARTIAL'
        : 'COMPLETE';
    entries.push({
      store: `enterprise module: ${module.descriptor.id}`,
      status,
      total: counts.total,
      assigned: counts.assigned,
      unresolved: counts.unresolved,
      note: !scoped
        ? 'No tenant boundary is bound to this store. It denies every read until one is.'
        : counts.unresolved > 0
          ? `${counts.unresolved} record(s) predate tenant ownership. They are visible to no tenant until claimed explicitly.`
          : /**
             * `COMPLETE` is scoped to THIS STORE and says so.
             *
             * It would otherwise read as "this module is isolated", which is
             * false: the same records are projected into the unified store, the
             * graph, memory and the search index, and all four are
             * REQUIRES_MIGRATION on this same page. `hasScope()` is also only
             * evidence that `bindScope` was CALLED — it cannot prove the source
             * ever returns a scope.
             */
            'Every read of this store is scoped and every record has a known owner. Projections of these records into search, the graph and AI context are listed separately and are NOT scoped.',
    });
  }

  for (const u of UNENFORCED) {
    entries.push({ store: u.store, status: u.status, total: 0, assigned: 0, unresolved: 0, note: u.note });
  }

  /**
   * Totals summed from the rows, never counted separately.
   *
   * A headline computed independently from the detail is a headline that can
   * disagree with it, and when they disagree the headline is the one people
   * quote.
   */
  /**
   * Totals cover the ROWS THAT CAN BE COUNTED, and the name says which.
   *
   * The unenforced entries carry zeros because their stores expose no ownership
   * count, so a plain "records" total would silently exclude documents,
   * provenance, the graph, the unified store and notifications — and read as a
   * whole-system figure.
   */
  const totals = entries.reduce(
    (acc, e) => ({
      stores: acc.stores + 1,
      records: acc.records + e.total,
      assigned: acc.assigned + e.assigned,
      unresolved: acc.unresolved + e.unresolved,
    }),
    { stores: 0, records: 0, assigned: 0, unresolved: 0 },
  );

  return { generatedAt: deps.now(), entries, totals };
}

/** Counts by status, for a one-line summary that agrees with the rows. */
export function summarizeInventory(
  inventory: TenantMigrationInventory,
): Record<TenantMigrationStatus, number> {
  const out: Record<TenantMigrationStatus, number> = {
    COMPLETE: 0,
    PARTIAL: 0,
    REQUIRES_MIGRATION: 0,
    BLOCKED: 0,
  };
  for (const e of inventory.entries) out[e.status] += 1;
  return out;
}
