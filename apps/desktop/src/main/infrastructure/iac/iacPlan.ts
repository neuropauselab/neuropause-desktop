/**
 * The IaC PLAN analyzer (P6.10). PURE + deterministic — it normalizes a Terraform/OpenTofu plan JSON
 * (`terraform show -json`: `resource_changes[]` + out-of-band `resource_drift[]`) OR a Pulumi preview digest
 * (`pulumi preview --json`: `steps[]`) into ONE flavor-neutral `ChangeSet`: a normalized action per resource
 * (create/update/delete/replace/drift/no-op/read), aggregate counts, and a dependency-aware apply/destroy order.
 * READ-ONLY analysis — it never applies or mutates anything; the collector attaches the result to plan/run
 * resources and feeds it to the drift engine.
 *
 * The taxonomy collapses provider specifics onto one vocabulary: Terraform's `["delete","create"]` /
 * `["create","delete"]` action pair AND Pulumi's `replace`/`create-replacement`/`delete-replaced` step family both
 * become a single `replace`; Terraform's top-level `resource_drift[]` and Pulumi's `refresh` deltas both become
 * `drift`. Bounded at `MAX_CHANGES` for a huge plan (deterministic, address-sorted keep + `droppedCount`).
 */
import type { IacFlavor } from './iacState';

/** The one normalized action taxonomy across all flavors. */
export type ChangeAction = 'create' | 'update' | 'delete' | 'replace' | 'drift' | 'no-op' | 'read';
export const CHANGE_ACTIONS: readonly ChangeAction[] = ['create', 'update', 'delete', 'replace', 'drift', 'no-op', 'read'] as const;

/** Cap change entries parsed from one plan/preview (huge-plan guard). */
export const MAX_CHANGES = 10_000;
/** Cap dependency edges tracked per change. */
export const MAX_CHANGE_DEPS = 256;

export interface ResourceChange {
  address: string;
  type: string;
  provider: string;
  action: ChangeAction;
  /** Attribute paths that forced a replacement (sorted). */
  replacePaths: string[];
  /** Top-level attributes where before ≠ after (sorted). */
  changedKeys: string[];
  /** Originated as out-of-band drift (TF `resource_drift` / Pulumi refresh). */
  fromDrift: boolean;
  /** Resolved dependency addresses (sorted, bounded). */
  dependsOn: string[];
}

export interface ChangeCounts {
  create: number;
  update: number;
  delete: number;
  replace: number;
  drift: number;
  'no-op': number;
  read: number;
  total: number;
}

export interface ChangeSet {
  flavor: IacFlavor;
  changes: ResourceChange[];
  counts: ChangeCounts;
  /** Kahn topo over `dependsOn` (deps before dependents; ties by address; cycle-safe). */
  applyOrder: string[];
  /** Reverse of `applyOrder` — the safe teardown / impact order. */
  destroyOrder: string[];
  truncated: boolean;
  droppedCount: number;
}

type Json = unknown;
type Rec = Record<string, unknown>;
const isRec = (v: Json): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const asArr = (v: Json): Json[] => (Array.isArray(v) ? v : []);
const asStr = (v: Json): string | null => (typeof v === 'string' && v ? v : null);

function emptyCounts(): ChangeCounts {
  return { create: 0, update: 0, delete: 0, replace: 0, drift: 0, 'no-op': 0, read: 0, total: 0 };
}

/* ── Terraform / OpenTofu plan JSON ────────────────────────────────────────────── */

/** Classify a Terraform `change.actions` array onto the normalized taxonomy. */
export function classifyTerraformActions(actions: string[]): ChangeAction {
  if (actions.length === 1) {
    switch (actions[0]) {
      case 'no-op': return 'no-op';
      case 'create': return 'create';
      case 'update': return 'update';
      case 'delete': return 'delete';
      case 'forget': return 'delete'; // removed from state (TF 1.7+ `removed`) — a removal for our purposes
      case 'read': return 'read';
      default: return 'no-op';
    }
  }
  const set = new Set(actions);
  if (set.has('create') && set.has('delete')) return 'replace';
  return 'no-op';
}

function diffKeys(before: Json, after: Json): string[] {
  const b = isRec(before) ? before : {};
  const a = isRec(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
  }
  return changed.sort();
}

function replacePathsOf(change: Rec): string[] {
  const paths = asArr(change.replace_paths).map((p) => (Array.isArray(p) ? p.map((s) => String(s)).join('.') : String(p)));
  return [...new Set(paths)].sort();
}

/** Build, per resource address, the resource addresses it references — a bounded walk of `configuration`. */
function terraformConfigDeps(configuration: Json): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  if (!isRec(configuration)) return new Map();
  const allAddresses = new Set<string>();
  const raw: Array<{ address: string; refs: string[] }> = [];

  const collectRefs = (node: Json, acc: string[]): void => {
    if (Array.isArray(node)) { for (const n of node) collectRefs(n, acc); return; }
    if (!isRec(node)) return;
    if (Array.isArray(node.references)) for (const r of node.references) { const s = asStr(r); if (s) acc.push(s); }
    for (const [k, v] of Object.entries(node)) { if (k !== 'references') collectRefs(v, acc); }
  };

  const walkModule = (mod: Json, prefix: string, depth: number): void => {
    if (!isRec(mod) || depth > 24) return;
    for (const rawRes of asArr(mod.resources)) {
      if (!isRec(rawRes)) continue;
      const rel = asStr(rawRes.address);
      if (!rel) continue;
      const address = prefix ? `${prefix}.${rel}` : rel;
      allAddresses.add(address);
      const refs: string[] = [];
      collectRefs(rawRes.expressions, refs);
      for (const d of asArr(rawRes.depends_on)) { const s = asStr(d); if (s) refs.push(s); }
      raw.push({ address, refs: refs.map((r) => (prefix ? `${prefix}.${r}` : r)) });
    }
    const calls = isRec(mod.module_calls) ? mod.module_calls : {};
    for (const [callName, call] of Object.entries(calls)) {
      if (!isRec(call)) continue;
      walkModule(call.module, prefix ? `${prefix}.module.${callName}` : `module.${callName}`, depth + 1);
    }
  };
  walkModule((configuration as Rec).root_module, '', 0);

  // Reduce each reference to a known resource address (strip trailing attribute segments; longest match wins).
  const reduce = (ref: string): string | null => {
    let cur = ref;
    for (let i = 0; i < 8 && cur.includes('.'); i++) {
      if (allAddresses.has(cur)) return cur;
      cur = cur.slice(0, cur.lastIndexOf('.'));
    }
    return allAddresses.has(cur) ? cur : null;
  };
  for (const { address, refs } of raw) {
    const set = out.get(address) ?? new Set<string>();
    for (const ref of refs) {
      const target = reduce(ref);
      if (target && target !== address) set.add(target);
      if (set.size >= MAX_CHANGE_DEPS) break;
    }
    out.set(address, set);
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

/** Strip a trailing `[0]` / `["key"]` instance index → the block address `configuration` keys dependencies by. */
function baseAddress(addr: string): string {
  return addr.replace(/\[[^\]]*\]$/, '');
}

function analyzeTerraformPlan(plan: Rec): ResourceChange[] {
  // `configuration` addresses (and thus the extracted deps) are BLOCK-level (`aws_instance.web`), while
  // `resource_changes[].address` are INSTANCE-level (`aws_instance.web[0]`). Resolve deps by block address and
  // expand each block target to its present instance addresses, so count/for_each resources keep their edges.
  const configDeps = terraformConfigDeps(plan.configuration);
  const changes: ResourceChange[] = [];
  const emit = (rc: Json, fromDrift: boolean): void => {
    if (!isRec(rc)) return;
    const address = asStr(rc.address);
    if (!address) return;
    const change = isRec(rc.change) ? rc.change : {};
    const actions = asArr(change.actions).map((a) => String(a));
    const action = fromDrift ? 'drift' : classifyTerraformActions(actions);
    changes.push({
      address,
      type: asStr(rc.type) ?? 'resource',
      provider: asStr(rc.provider_name) ?? 'unknown',
      action,
      replacePaths: replacePathsOf(change),
      changedKeys: diffKeys(change.before, change.after),
      fromDrift,
      dependsOn: [],
    });
  };
  for (const rc of asArr(plan.resource_changes)) emit(rc, false);
  for (const rd of asArr(plan.resource_drift)) emit(rd, true);

  const baseToInstances = new Map<string, string[]>();
  for (const c of changes) (baseToInstances.get(baseAddress(c.address)) ?? baseToInstances.set(baseAddress(c.address), []).get(baseAddress(c.address))!).push(c.address);
  for (const c of changes) {
    const set = new Set<string>();
    for (const dep of configDeps.get(baseAddress(c.address)) ?? []) {
      for (const inst of baseToInstances.get(dep) ?? []) if (inst !== c.address) set.add(inst);
      if (set.size >= MAX_CHANGE_DEPS) break;
    }
    c.dependsOn = [...set].sort();
  }
  return changes;
}

/* ── Pulumi preview digest ─────────────────────────────────────────────────────── */

/** Classify a Pulumi step `op` onto the normalized taxonomy (replacement family → `replace`). */
export function classifyPulumiOp(op: string): ChangeAction | 'ignore' {
  switch (op) {
    case 'same': return 'no-op';
    case 'create': return 'create';
    case 'update': return 'update';
    case 'delete': return 'delete';
    case 'read': return 'read';
    case 'import': return 'create';
    case 'refresh': return 'drift';
    case 'replace':
    case 'create-replacement':
    case 'delete-replaced':
    case 'read-replacement':
    case 'import-replacement':
      return 'replace';
    default:
      return 'ignore'; // discard/diff/parameterize/internal — not a user-facing change
  }
}

interface PulumiAgg {
  ops: Set<ChangeAction>;
  state: Rec;
  replaceReasons: Set<string>;
  changedKeys: Set<string>;
}
function analyzePulumiPreview(digest: Rec): ResourceChange[] {
  // Group steps by urn so a decomposed replacement (create-replacement→replace→delete-replaced) collapses to one,
  // accumulating reasons/diffs across ALL of a urn's steps (replaceReasons live on the `replace` sub-step).
  const byUrn = new Map<string, PulumiAgg>();
  for (const rawStep of asArr(digest.steps)) {
    if (!isRec(rawStep)) continue;
    const urn = asStr(rawStep.urn);
    const opStr = asStr(rawStep.op);
    if (!urn || !opStr) continue;
    const cls = classifyPulumiOp(opStr);
    if (cls === 'ignore') continue;
    const agg = byUrn.get(urn) ?? { ops: new Set<ChangeAction>(), state: {}, replaceReasons: new Set<string>(), changedKeys: new Set<string>() };
    agg.ops.add(cls);
    if (isRec(rawStep.newState)) agg.state = rawStep.newState;
    else if (isRec(rawStep.oldState) && Object.keys(agg.state).length === 0) agg.state = rawStep.oldState;
    for (const r of asArr(rawStep.replaceReasons)) { const s = asStr(r); if (s) agg.replaceReasons.add(s); }
    for (const r of asArr(rawStep.diffReasons)) { const s = asStr(r); if (s) agg.changedKeys.add(s); }
    if (isRec(rawStep.detailedDiff)) for (const k of Object.keys(rawStep.detailedDiff)) agg.changedKeys.add(k);
    byUrn.set(urn, agg);
  }

  const pickAction = (ops: Set<ChangeAction>): ChangeAction => {
    if (ops.has('replace')) return 'replace';
    if (ops.has('drift')) return 'drift';
    if (ops.has('delete')) return 'delete';
    if (ops.has('create')) return 'create';
    if (ops.has('update')) return 'update';
    if (ops.has('read')) return 'read';
    return 'no-op';
  };

  const changes: ResourceChange[] = [];
  for (const [urn, agg] of byUrn) {
    const typeToken = asStr(agg.state.type) ?? urnType(urn);
    const deps = new Set<string>();
    for (const d of asArr(agg.state.dependencies).map((x) => asStr(x)).filter(Boolean) as string[]) { deps.add(d); if (deps.size >= MAX_CHANGE_DEPS) break; }
    changes.push({
      address: urn,
      type: typeToken,
      provider: typeToken.split(':')[0] || 'pulumi',
      action: pickAction(agg.ops),
      replacePaths: [...agg.replaceReasons].sort(),
      changedKeys: [...agg.changedKeys].sort(),
      fromDrift: agg.ops.has('drift'),
      dependsOn: [...deps].sort(),
    });
  }
  return changes;
}

function urnType(urn: string): string {
  const segs = urn.split('::');
  if (segs.length < 3) return 'resource';
  return (segs[2].split('$').pop() ?? segs[2]) || 'resource';
}

/* ── entry point ───────────────────────────────────────────────────────────────── */

/** Deterministic Kahn topological order over `dependsOn` (deps first); leftover cycle members appended sorted. */
function topoOrder(changes: ResourceChange[]): string[] {
  const present = new Set(changes.map((c) => c.address));
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → [nodes that depend on it]
  for (const c of changes) indeg.set(c.address, 0);
  for (const c of changes) {
    for (const dep of c.dependsOn) {
      if (!present.has(dep)) continue;
      indeg.set(c.address, (indeg.get(c.address) ?? 0) + 1);
      (dependents.get(dep) ?? dependents.set(dep, []).get(dep)!).push(c.address);
    }
  }
  const ready = [...indeg.entries()].filter(([, d]) => d === 0).map(([a]) => a).sort();
  const order: string[] = [];
  const queue = [...ready];
  while (queue.length) {
    queue.sort(); // deterministic tie-break
    const node = queue.shift()!;
    order.push(node);
    for (const dependent of (dependents.get(node) ?? []).sort()) {
      indeg.set(dependent, (indeg.get(dependent) ?? 1) - 1);
      if (indeg.get(dependent) === 0) queue.push(dependent);
    }
  }
  if (order.length < changes.length) {
    for (const c of changes) if (!order.includes(c.address)) order.push(c.address); // cycle leftovers, sorted-stable
  }
  return order;
}

/** Normalize a Terraform/OpenTofu plan JSON or a Pulumi preview digest into a `ChangeSet`. */
export function analyzePlan(planJson: Json, flavor: IacFlavor): ChangeSet {
  const plan = isRec(planJson) ? planJson : {};
  const all = flavor === 'pulumi' ? analyzePulumiPreview(plan) : analyzeTerraformPlan(plan);

  let changes = all;
  let truncated = false;
  let droppedCount = 0;
  if (all.length > MAX_CHANGES) {
    changes = [...all].sort((a, b) => a.address.localeCompare(b.address)).slice(0, MAX_CHANGES);
    truncated = true;
    droppedCount = all.length - MAX_CHANGES;
  }
  changes.sort((a, b) => a.address.localeCompare(b.address));

  const counts = emptyCounts();
  for (const c of changes) {
    counts[c.action] += 1;
    counts.total += 1;
  }
  const applyOrder = topoOrder(changes);
  return { flavor, changes, counts, applyOrder, destroyOrder: [...applyOrder].reverse(), truncated, droppedCount };
}
