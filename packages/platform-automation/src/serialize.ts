/**
 * Minimal, dependency-free serializers used by the generators. `toYaml` emits deterministic, valid YAML
 * for Kubernetes manifests, monitoring descriptors, and GitHub Actions workflows; `hclBlock` emits a
 * Terraform HCL block. These render the automation ARTIFACTS the generators produce — they never execute
 * anything. Keeping them in-package avoids adding a runtime dependency.
 */
export type Yamlish = string | number | boolean | null | Yamlish[] | { [k: string]: Yamlish };

function scalar(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = v;
  const risky = s === '' || /^\s|\s$/.test(s) || /[:#[\]{}&*!|>'"%@`,]/.test(s) || /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
  return risky ? JSON.stringify(s) : s;
}

/** Serialize a JSON-like value to valid YAML. */
export function toYaml(value: Yamlish, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || typeof value !== 'object') return scalar(value as string | number | boolean | null);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => (item !== null && typeof item === 'object' ? `${pad}-\n${toYaml(item, indent + 1)}` : `${pad}- ${scalar(item as string | number | boolean | null)}`))
      .join('\n');
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return entries
    .map(([k, v]) => {
      const nested = v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
      return nested ? `${pad}${k}:\n${toYaml(v, indent + 1)}` : `${pad}${k}: ${toYaml(v as Yamlish, 0)}`;
    })
    .join('\n');
}

/** Render a single Kubernetes-style document (adds the `---` separator convention when joined). */
export function toManifest(doc: Record<string, Yamlish>): string {
  return toYaml(doc);
}

/** Render several documents as a multi-document YAML file. */
export function toManifestFile(docs: Array<Record<string, Yamlish>>): string {
  return docs.map((d) => toYaml(d)).join('\n---\n');
}

/** Escape + quote an HCL string literal. */
export function hcl(v: string): string {
  return JSON.stringify(v);
}

/** Emit a Terraform HCL block: `type "l1" "l2" { key = value ... }` with simple scalar assignments. */
export function hclBlock(type: string, labels: string[], body: Record<string, string | number | boolean>): string {
  const head = [type, ...labels.map((l) => hcl(l))].join(' ');
  const lines = Object.entries(body).map(([k, v]) => `  ${k} = ${typeof v === 'string' ? hcl(v) : String(v)}`);
  return `${head} {\n${lines.join('\n')}\n}`;
}
