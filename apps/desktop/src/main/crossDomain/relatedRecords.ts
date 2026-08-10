/**
 * Cross-domain related records — bounded, permission-filtered, explainable.
 *
 * There is no new graph here, and that is the point. Four relationship systems
 * already exist in this repo; the one keyed on real `EnterpriseEntity` ids is
 * the Data Plane relationship store, and it already resolves 28 declared links
 * deterministically, parks what it cannot resolve, and refuses to guess on
 * anything financial. What was missing was not a graph — it was a way to walk
 * that graph safely from one record, and a surface to show it on.
 *
 * Three properties this file exists to guarantee:
 *
 *  1. **The graph is not an authorization bypass.** This is the whole security
 *     story. A customer's related records span CRM, Sales, Finance, Procurement
 *     and Helpdesk, and those sit behind four different read scopes. Traversal
 *     therefore checks the READ SCOPE OF EVERY MODULE IT TOUCHES, and stops at
 *     records the actor may not read — it does not step through them either, so
 *     a forbidden invoice cannot be used as a bridge to the payment behind it.
 *     The existing cross-domain reads do none of this.
 *
 *  2. **Filtering is declared, never silent.** Hiding records to respect a
 *     permission is correct; letting the result look complete afterwards is
 *     not. `hiddenByPermission` says the view is partial. It deliberately
 *     carries NO module names and NO counts, because "3 records hidden in
 *     Finance" tells you this customer has finance records — which is the fact
 *     the permission was protecting.
 *
 *  3. **Every hop explains itself structurally.** Not "AI thinks these are
 *     related": the literal source value, the field it came from, and the
 *     method that matched it. A relationship a person cannot check is a
 *     relationship they have to take on faith, and this product does not ask
 *     for faith.
 *
 * Bounded by construction: depth cap, node cap, and a visited set — so a
 * cycle (order → invoice → customer → order) terminates instead of spinning.
 */
import type {
  EnterprisePermission,
  RelatedGroup,
  RelatedHop,
  RelatedRecord,
  RelatedRecordsView,
} from '@neuropause/shared';
import { DEFAULT_RELATED_DEPTH, MAX_RELATED_DEPTH, MAX_RELATED_RECORDS } from '@neuropause/shared';
import type { RelationshipLink, RelationshipStore } from '../dataPlane/relationshipStore';
import { relationshipByKey } from '../dataPlane/relationshipModel';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';

export interface RelatedRecordsDeps {
  relationships: RelationshipStore;
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
  /** Module descriptor lookup — title and the scope needed to read it. */
  describe: (moduleId: string) => { plural: string; read: EnterprisePermission } | null;
  /** Non-throwing permission probe. Throwing here would spam the hold queue. */
  allows: (permission: EnterprisePermission) => boolean;
}

export interface RelatedRecordsRequest {
  recordId: string;
  /** The record's own module — known by the caller, never guessed from links. */
  moduleId: string;
  depth?: number;
}

/** The far end of a link, whichever direction it points. */
function farEnd(link: RelationshipLink, from: string): { moduleId: string; recordId: string; direction: 'out' | 'in' } | null {
  if (link.sourceRecordId === from) {
    return { moduleId: link.targetModuleId, recordId: link.targetRecordId, direction: 'out' };
  }
  if (link.targetRecordId === from) {
    return { moduleId: link.sourceModuleId, recordId: link.sourceRecordId, direction: 'in' };
  }
  return null;
}

/**
 * Why these two records are connected, in structural terms.
 *
 * Reads off the declaration and the resolved link, so it states the field, the
 * literal value the record carried, and how that value was matched. The four
 * methods mean genuinely different things — an internal id is certainty, a
 * canonical name is a proposal a human accepted — and collapsing them into
 * "related" would throw away the only part that tells you how much to trust it.
 */
function explain(link: RelationshipLink, direction: 'out' | 'in'): string {
  // The LINK's own source module and field, not the current declaration's.
  // Reading them off `relationshipByKey` describes what the rule says today,
  // which is not necessarily what produced this link.
  const field = `${link.sourceModuleId}.${link.sourceField}`;
  const basis =
    link.method === 'internal_id'
      ? 'which is that record’s id'
      : link.method === 'business_key'
        ? 'which matches that record’s key exactly'
        : link.method === 'normalized_key'
          ? 'which matches that record’s key ignoring case, spacing and punctuation'
          : link.method === 'canonical_name'
            ? 'which a person accepted as the same name'
            : 'which a person matched by hand';
  const who = link.decidedBy ? ` Chosen by ${link.decidedBy}.` : ' Matched automatically — nobody chose it.';
  // The resolver's own sentence names the field it actually matched on — a
  // customer's display NAME reads very differently from a customer code, and
  // this is the only place that distinction survives.
  const matched = link.reason ? ` ${link.reason}` : '';
  return direction === 'out'
    ? `${field} holds "${link.sourceValue}", ${basis}.${matched}${who}`
    : `That record’s ${field} holds "${link.sourceValue}", ${basis}, which is this record.${matched}${who}`;
}

/**
 * Walk outward from one record, stopping at every boundary that matters.
 *
 * Breadth-first so the nearest records arrive first and the cap, when it bites,
 * removes the most distant rather than an arbitrary slice.
 */
export async function buildRelatedRecords(
  deps: RelatedRecordsDeps,
  request: RelatedRecordsRequest,
): Promise<RelatedRecordsView> {
  const depth = Math.max(1, Math.min(request.depth ?? DEFAULT_RELATED_DEPTH, MAX_RELATED_DEPTH));
  await deps.relationships.load();

  let hiddenByPermission = false;
  let brokenLinks = 0;
  let truncated = false;

  /** Resolve a record and say whether the actor may see it at all. */
  const readRecord = async (
    moduleId: string,
    recordId: string,
  ): Promise<{ title: string; deleted: boolean; moduleTitle: string } | null> => {
    const described = deps.describe(moduleId);
    if (!described) return null;
    // THE authorization gate. Checked per module, on every hop, before the
    // record is read — not after, and not once at the entry point.
    if (!deps.allows(described.read)) {
      hiddenByPermission = true;
      return null;
    }
    const store = deps.storeFor(moduleId);
    if (!store) return null;
    await store.load();
    const record = store.get(recordId);
    /**
     * P11 — OUT OF SCOPE IS NOT "DELETED".
     *
     * `store.get` now returns null for three different reasons: the record does
     * not exist, it belongs to another tenant, or no scope resolved. Returning a
     * non-null "no longer exists" object for all three meant the caller's
     * `if (!resolved) continue` never fired, and the hop was emitted carrying
     * `sourceValue` — the far record's literal field value — and `decidedBy`, the
     * email of whoever matched it.
     *
     * The file's own header calls the forbidden-root early return "load-bearing"
     * for exactly this reason, and that protection covered only the PERMISSION
     * branch. The tenant branch took this path instead. Reachable on any upgraded
     * install: every pre-P11 record is out of scope everywhere, so every link
     * pointing at one rendered its field value.
     *
     * Returning null costs the `brokenLinks` counter its precision for
     * out-of-scope targets, which is the right trade: a count is cosmetic, a
     * quoted field value is a disclosure.
     */
    if (!record) return null;
    if (record.status === 'deleted') {
      brokenLinks += 1;
      return { title: `${record.title} (deleted)`, deleted: true, moduleTitle: described.plural };
    }
    return { title: record.title, deleted: false, moduleTitle: described.plural };
  };

  /* ── The root. No readable root, no traversal. ──────────────────────
   *
   * The early return is the load-bearing line in this file. Without it the BFS
   * seeds from the record anyway and walks its whole neighbourhood — returning
   * every permitted neighbour, and worse, `hop.sourceValue` and `hop.why`,
   * which quote the FORBIDDEN root's own field values ("finance.customer holds
   * \"Acme Ltd\""). A traversal that starts inside a record you may not read is
   * a read of that record, however careful the rest of the walk is.
   */
  const resolvedRoot = await readRecord(request.moduleId, request.recordId);
  const root: RelatedRecordsView['root'] =
    resolvedRoot && !resolvedRoot.deleted
      ? {
          recordId: request.recordId,
          title: resolvedRoot.title,
          moduleId: request.moduleId,
          moduleTitle: resolvedRoot.moduleTitle,
        }
      : null;
  if (!root) {
    return {
      root: null,
      groups: [],
      total: 0,
      depth,
      hiddenByPermission,
      // The root's own absence is not a broken LINK — there is no link. The
      // counter is reset so the UI cannot say "1 link points at a record that
      // no longer exists" when nothing pointed anywhere.
      brokenLinks: 0,
      truncated: false,
    };
  }

  /* ── Breadth-first, bounded on every axis. ─────────────────────────── */
  const found = new Map<string, RelatedRecord>();
  // Seeded with the root so a cycle back to it terminates rather than listing
  // the record as its own relation.
  const visited = new Set<string>([request.recordId]);
  let frontier: { recordId: string; title: string; path: readonly RelatedHop[] }[] = [
    { recordId: request.recordId, title: root.title, path: [] },
  ];

  outer: for (let hop = 1; hop <= depth; hop += 1) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      const links = [
        ...deps.relationships.outgoing(node.recordId),
        ...deps.relationships.incoming(node.recordId),
      ];
      for (const link of links) {
        const far = farEnd(link, node.recordId);
        if (!far || visited.has(far.recordId)) continue;

        // The cap is checked BEFORE the record is marked visited. Marking a
        // record we then refuse to keep would make it permanently unreachable
        // for the rest of this traversal, including by a shorter path — and
        // would go on ticking `brokenLinks` and `hiddenByPermission` for
        // records the caller never sees. Breaking out entirely is the honest
        // stop: the result is short, and `truncated` says so.
        if (found.size >= MAX_RELATED_RECORDS) {
          truncated = true;
          break outer;
        }

        const resolved = await readRecord(far.moduleId, far.recordId);
        // Null means either an unknown module or — the case that matters — a
        // module this actor may not read. Not stepping through it is
        // deliberate: an unreadable invoice must not become a bridge to the
        // payment behind it.
        if (!resolved) continue;

        visited.add(far.recordId);

        const step: RelatedHop = {
          fromRecordId: node.recordId,
          fromTitle: node.title,
          toRecordId: far.recordId,
          toTitle: resolved.title,
          relationshipKey: link.relationshipKey,
          label: relationshipByKey(link.relationshipKey)?.label ?? link.relationshipKey,
          direction: far.direction,
          why: explain(link, far.direction),
          method: link.method,
          confidence: link.confidence,
          decidedBy: link.decidedBy,
          sourceValue: link.sourceValue,
          at: link.at,
        };
        const path = [...node.path, step];
        found.set(far.recordId, {
          recordId: far.recordId,
          title: resolved.title,
          moduleId: far.moduleId,
          moduleTitle: resolved.moduleTitle,
          hops: hop,
          path,
          deleted: resolved.deleted,
        });
        // A deleted record is reported but not walked through — its own links
        // are not this record's neighbourhood.
        if (!resolved.deleted) next.push({ recordId: far.recordId, title: resolved.title, path });
      }
    }
    if (next.length === 0) break;
    // The depth cap bit while there was still frontier left. Without this the
    // view reports `truncated: false` — "this is everything" — for a record
    // whose neighbourhood simply extends past the limit the user chose.
    if (hop === depth) truncated = true;
    frontier = next;
  }

  /* ── Group by module, nearest first inside each group. ─────────────── */
  const byModule = new Map<string, RelatedRecord[]>();
  for (const record of found.values()) {
    const bucket = byModule.get(record.moduleId);
    if (bucket) bucket.push(record);
    else byModule.set(record.moduleId, [record]);
  }
  const groups: RelatedGroup[] = [...byModule.entries()]
    .map(([moduleId, records]) => ({
      moduleId,
      moduleTitle: records[0]?.moduleTitle ?? moduleId,
      records: [...records].sort((a, b) => a.hops - b.hops || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.moduleTitle.localeCompare(b.moduleTitle));

  return {
    root,
    groups,
    total: found.size,
    depth,
    hiddenByPermission,
    brokenLinks,
    truncated,
  };
}
