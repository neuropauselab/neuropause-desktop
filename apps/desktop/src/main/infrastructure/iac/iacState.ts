/**
 * The IaC STATE parser (P6.10 — Infrastructure as Code Platform). PURE + deterministic + IO-free — it takes an
 * already-fetched, already-parsed JSON object (a Terraform/OpenTofu v4 state, or a Pulumi stack `export`
 * deployment) and normalizes it into ONE provider-agnostic `IacStateModel`: a bounded, secret-redacted resource
 * inventory + dependency edges + outputs + the flavor/version keys. It runs the same for every flavor so the
 * collectors + drift engine stay provider-neutral.
 *
 * Terraform/OpenTofu share the identical on-disk v4 format (same `version:4`, `resources[].instances[]`,
 * `dependencies[]`), so ONE parser handles both — the flavor is only a TAG (from the source, with a
 * provider-registry-host fallback). Pulumi's `UntypedDeployment.deployment.resources[]` is parsed by a sibling
 * function into the SAME normalized shape (URN → address, `dependencies[]`/`parent` → edges).
 *
 * SECURITY: attributes are reduced to a bounded set of SCALAR values only, and any attribute named as sensitive
 * (Terraform `sensitive_attributes`, Pulumi `additionalSecretOutputs`) or carrying the Pulumi secret signature is
 * dropped — a secret VALUE never enters the normalized model, an attribute bag, a DTO, or a log.
 *
 * PERFORMANCE: bounded for huge state (thousands of resources / multi-MB JSON). The RESOURCE count is capped at
 * `MAX_RESOURCES` (deterministic, address-sorted keep) and surfaced via `truncated`/`droppedCount` so the collector
 * under-reports rather than issuing a false-complete inventory; per-resource dependency lists (`MAX_DEPENDS_ON`) and
 * scalar attribute keys (`MAX_ATTR_KEYS`) are additionally bounded as fixed degree caps.
 */
import type { ResourceAttributes } from '@neuropause/shared';

export type IacFlavor = 'terraform' | 'opentofu' | 'pulumi';
/** The normalized resource kind (across flavors). */
export type IacResourceMode = 'managed' | 'data' | 'component' | 'provider' | 'stack';

/** Cap resources parsed from one state object (huge-state guard). */
export const MAX_RESOURCES = 10_000;
/** Cap dependency edges tracked per resource. */
export const MAX_DEPENDS_ON = 256;
/** Cap scalar attribute keys carried per resource. */
export const MAX_ATTR_KEYS = 48;
/** The Pulumi secret-value signature key — any object carrying it is a ciphertext, never surfaced. */
const PULUMI_SECRET_SIG = '4dabf18193072939515e22adb298388d';

type Json = unknown;
type Rec = Record<string, unknown>;

export interface IacParsedResource {
  /** The stable IaC address (Terraform resource address / Pulumi URN) — the join key + `nativeId`. */
  address: string;
  mode: IacResourceMode;
  /** Provider type token: `aws_instance` (TF) / `aws:s3/bucket:Bucket` (Pulumi) / `pulumi:providers:aws`. */
  type: string;
  name: string;
  /** Provider FQN: `registry.terraform.io/hashicorp/aws` (TF) or the Pulumi provider package. */
  providerFqn: string | null;
  /** Short provider name: `aws`, `azurerm`, `google`. */
  providerName: string | null;
  /** The owning module (`module.network`) for TF, or null. */
  moduleAddress: string | null;
  /** The Pulumi containment parent URN, or null. */
  parentAddress: string | null;
  /** Resolved data-dependency addresses/URNs (bounded, deduped, sorted). */
  dependencies: string[];
  status: string | null;
  attributes: ResourceAttributes;
}

export interface IacOutput {
  name: string;
  sensitive: boolean;
  type: string | null;
}

export interface IacStateModel {
  flavor: IacFlavor;
  writerVersion: string | null;
  /** Terraform state serial (monotonic) — the cache/version key with `lineage`; null for Pulumi. */
  serial: number | null;
  /** Terraform lineage (stable state-line UUID) / Pulumi stack ref; the other half of the cache key. */
  lineage: string | null;
  resources: IacParsedResource[];
  outputs: IacOutput[];
  /** Distinct provider FQNs seen (for the providers domain). */
  providers: string[];
  truncated: boolean;
  droppedCount: number;
}

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const isRec = (v: Json): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const asArr = (v: Json): Json[] => (Array.isArray(v) ? v : []);
const asStr = (v: Json): string | null => (typeof v === 'string' && v.trim() ? v.trim() : v == null ? null : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
const asNum = (v: Json): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reduce an arbitrary attribute map to a bounded set of NON-sensitive SCALAR entries (objects/arrays dropped). */
function scalarAttributes(src: Json, sensitiveKeys: Set<string>): ResourceAttributes {
  const out: ResourceAttributes = {};
  if (!isRec(src)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(src)) {
    if (n >= MAX_ATTR_KEYS) break;
    if (sensitiveKeys.has(k)) continue; // declared sensitive → never surfaced
    if (isRec(v) && PULUMI_SECRET_SIG in v) continue; // Pulumi ciphertext object → never surfaced
    if (typeof v === 'string') { out[k] = v.length > 512 ? `${v.slice(0, 512)}…` : v; n++; }
    else if (typeof v === 'number' && Number.isFinite(v)) { out[k] = v; n++; }
    else if (typeof v === 'boolean') { out[k] = v; n++; }
    else if (v === null) { out[k] = null; n++; }
    // objects / arrays are intentionally skipped (bounded, scalar-only bag)
  }
  return out;
}

/** Extract the leading attribute key from a Terraform `sensitive_attributes` entry (string / {value} / path array). */
function sensitiveKey(entry: Json): string | null {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry) && entry.length) {
    const first = entry[0];
    return isRec(first) ? asStr(first.value) : asStr(first);
  }
  if (isRec(entry)) return asStr(entry.value);
  return null;
}

function boundedDeps(deps: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const d of deps) {
    const s = d.trim();
    if (s) set.add(s);
    if (set.size >= MAX_DEPENDS_ON) break;
  }
  return [...set].sort();
}

/** Apply the MAX_RESOURCES cap deterministically (address-sorted keep), reporting what was dropped. */
function capResources(all: IacParsedResource[]): { kept: IacParsedResource[]; truncated: boolean; dropped: number } {
  if (all.length <= MAX_RESOURCES) return { kept: all, truncated: false, dropped: 0 };
  const sorted = [...all].sort((a, b) => a.address.localeCompare(b.address));
  return { kept: sorted.slice(0, MAX_RESOURCES), truncated: true, dropped: all.length - MAX_RESOURCES };
}

/* ── Terraform / OpenTofu v4 state ─────────────────────────────────────────────── */

/** Parse a `provider["registry.terraform.io/hashicorp/aws"].alias` reference into its FQN + short name. */
export function parseTerraformProvider(ref: string | null): { fqn: string | null; name: string | null } {
  if (!ref) return { fqn: null, name: null };
  const m = /^provider\["([^"]+)"\]/.exec(ref);
  const fqn = m ? m[1] : ref;
  const name = fqn.split('/').pop() ?? null;
  return { fqn, name };
}

/** Derive a Terraform resource address from its resource block + one instance. */
function terraformAddress(res: Rec, instance: Rec): string {
  const parts: string[] = [];
  const mod = asStr(res.module);
  if (mod) parts.push(mod);
  if (asStr(res.mode) === 'data') parts.push('data');
  parts.push(`${asStr(res.type) ?? 'resource'}.${asStr(res.name) ?? 'unnamed'}`);
  let addr = parts.join('.');
  const key = instance.index_key;
  if (typeof key === 'number') addr += `[${key}]`;
  else if (typeof key === 'string') addr += `["${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`; // match Terraform's escaped for_each key
  return addr;
}

/** Vote a flavor from provider registry hosts (fallback when the source gives no hint). */
function voteFlavor(providerFqns: string[]): IacFlavor {
  let tofu = 0;
  let tf = 0;
  for (const f of providerFqns) {
    const host = f.split('/')[0];
    if (host === 'registry.opentofu.org') tofu++;
    else if (host === 'registry.terraform.io') tf++;
  }
  return tofu > tf ? 'opentofu' : 'terraform';
}

/**
 * Parse a Terraform/OpenTofu v4 state JSON into the normalized model. `flavorHint` (from the configured source)
 * is authoritative; when omitted the flavor is voted from the provider registry hosts.
 */
export function parseTerraformState(json: Json, flavorHint?: IacFlavor): IacStateModel {
  const root = isRec(json) ? json : {};
  const parsed: IacParsedResource[] = [];
  const providerSet = new Set<string>();

  for (const rawRes of asArr(root.resources)) {
    if (!isRec(rawRes)) continue;
    const mode: IacResourceMode = asStr(rawRes.mode) === 'data' ? 'data' : 'managed';
    const { fqn, name: provName } = parseTerraformProvider(asStr(rawRes.provider));
    if (fqn) providerSet.add(fqn);
    const module = asStr(rawRes.module);
    for (const rawInst of asArr(rawRes.instances)) {
      if (!isRec(rawInst)) continue;
      const address = terraformAddress(rawRes, rawInst);
      const sensitive = new Set<string>();
      for (const s of asArr(rawInst.sensitive_attributes)) {
        const key = sensitiveKey(s);
        if (key) sensitive.add(key.split('.')[0].replace(/\[.*$/, ''));
      }
      const deps = boundedDeps(asArr(rawInst.dependencies).map((d) => asStr(d) ?? '').filter(Boolean));
      parsed.push({
        address,
        mode,
        type: asStr(rawRes.type) ?? 'resource',
        name: asStr(rawRes.name) ?? 'unnamed',
        providerFqn: fqn,
        providerName: provName,
        moduleAddress: module,
        parentAddress: null,
        dependencies: deps,
        status: asStr(rawInst.status),
        attributes: scalarAttributes(rawInst.attributes, sensitive),
      });
    }
  }

  const outputs = parseTerraformOutputs(root.outputs);
  const { kept, truncated, dropped } = capResources(parsed);
  const flavor = flavorHint ?? voteFlavor([...providerSet]);
  return {
    flavor,
    writerVersion: asStr(root.terraform_version),
    serial: asNum(root.serial),
    lineage: asStr(root.lineage),
    resources: kept,
    outputs,
    providers: [...providerSet].sort(),
    truncated,
    droppedCount: dropped,
  };
}

function parseTerraformOutputs(raw: Json): IacOutput[] {
  if (!isRec(raw)) return [];
  const out: IacOutput[] = [];
  for (const [name, v] of Object.entries(raw)) {
    const o = isRec(v) ? v : {};
    const t = o.type;
    out.push({ name, sensitive: o.sensitive === true, type: Array.isArray(t) ? (asStr(t[0]) ?? 'complex') : asStr(t) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── Pulumi stack export (UntypedDeployment → DeploymentV3) ─────────────────────── */

/** Parse a Pulumi URN `urn:pulumi:<stack>::<project>::<...$type>::<name>` into its parts. */
export function parsePulumiUrn(urn: string): { stack: string | null; project: string | null; type: string | null; name: string | null } {
  if (!urn.startsWith('urn:pulumi:')) return { stack: null, project: null, type: null, name: null };
  const segs = urn.split('::');
  if (segs.length < 4) return { stack: null, project: null, type: null, name: null };
  const stack = segs[0].slice('urn:pulumi:'.length) || null;
  const project = segs[1] || null;
  const typeChain = segs[2] || '';
  const ownType = typeChain.split('$').pop() ?? typeChain; // the resource's own type is the last $-segment
  const name = segs.slice(3).join('::') || null; // names don't contain '::'
  return { stack, project, type: ownType || null, name };
}

/** Resolve a Pulumi provider reference `<providerURN>::<uuid>` → the provider URN (drop the id half). */
function pulumiProviderUrn(ref: string | null): string | null {
  if (!ref) return null;
  const idx = ref.lastIndexOf('::');
  return idx > 0 ? ref.slice(0, idx) : ref;
}

/** Parse a Pulumi stack `export` (UntypedDeployment) into the normalized model. */
export function parsePulumiState(json: Json): IacStateModel {
  const root = isRec(json) ? json : {};
  const deployment = isRec(root.deployment) ? root.deployment : root; // tolerate a bare DeploymentV3
  const manifest = isRec(deployment.manifest) ? deployment.manifest : {};
  const parsed: IacParsedResource[] = [];
  const providerSet = new Set<string>();
  const outputs: IacOutput[] = [];
  let stackRef: string | null = null;

  for (const rawRes of asArr(deployment.resources)) {
    if (!isRec(rawRes)) continue;
    const urn = asStr(rawRes.urn);
    if (!urn) continue;
    const { stack, project, type, name } = parsePulumiUrn(urn);
    if (stack && !stackRef) stackRef = `${project ?? ''}/${stack}`;
    const custom = rawRes.custom === true;
    const isStack = type === 'pulumi:pulumi:Stack';
    const isProvider = typeof type === 'string' && type.startsWith('pulumi:providers:');
    const mode: IacResourceMode = isStack ? 'stack' : isProvider ? 'provider' : custom ? 'managed' : 'component';

    if (isStack) {
      // the root Stack resource's outputs ARE the stack outputs
      const secretKeys = new Set(asArr(rawRes.additionalSecretOutputs).map((k) => asStr(k) ?? '').filter(Boolean));
      for (const [k, v] of Object.entries(isRec(rawRes.outputs) ? rawRes.outputs : {})) {
        const secret = secretKeys.has(k) || (isRec(v) && PULUMI_SECRET_SIG in v);
        outputs.push({ name: k, sensitive: secret, type: null });
      }
    }

    const providerRef = pulumiProviderUrn(asStr(rawRes.provider));
    const provPkg = isProvider ? type.slice('pulumi:providers:'.length) : (type ? type.split(':')[0] : null);
    if (provPkg) providerSet.add(provPkg);

    const secretKeys = new Set(asArr(rawRes.additionalSecretOutputs).map((k) => asStr(k) ?? '').filter(Boolean));
    const deps = boundedDeps(asArr(rawRes.dependencies).map((d) => asStr(d) ?? '').filter(Boolean));
    parsed.push({
      address: urn,
      mode,
      type: type ?? 'resource',
      name: name ?? 'unnamed',
      providerFqn: providerRef,
      providerName: provPkg,
      moduleAddress: null,
      parentAddress: asStr(rawRes.parent),
      dependencies: deps,
      status: rawRes.delete === true ? 'pending_delete' : rawRes.pendingReplacement === true ? 'pending_replacement' : null,
      attributes: scalarAttributes(rawRes.outputs ?? rawRes.inputs, secretKeys),
    });
  }

  const { kept, truncated, dropped } = capResources(parsed);
  return {
    flavor: 'pulumi',
    writerVersion: asStr(manifest.version),
    serial: null, // Pulumi has no monotonic state serial (the export envelope `version` is a schema version, not a counter)
    lineage: stackRef,
    resources: kept,
    outputs: outputs.sort((a, b) => a.name.localeCompare(b.name)),
    providers: [...providerSet].sort(),
    truncated,
    droppedCount: dropped,
  };
}
