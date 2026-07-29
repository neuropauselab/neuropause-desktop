/**
 * Asset Catalog. Enumerates the REAL deployment assets under packages/deploy/assets and classifies
 * each by kind, epic, and file format. It reflects what is actually on disk — there is no static
 * list to drift out of sync — so the catalog cannot claim an asset that does not exist. Every
 * asset is a real, LIVE-VERIFIED file; the infrastructure the assets describe is represented, not
 * created.
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import type { AssetKind } from './constants';

export type AssetFormat = 'yaml' | 'yaml-multi' | 'json' | 'dockerfile' | 'hcl' | 'markdown' | 'helm-template' | 'env' | 'text';

export interface AssetDescriptor {
  path: string; // relative to the assets/ directory
  kind: AssetKind;
  epic: string;
  format: AssetFormat;
}

/** The assets directory, resolved from the workspace root (where the test runner and CI run). */
export function assetsDir(): string {
  return resolve(process.cwd(), 'packages', 'deploy', 'assets');
}

function classify(rel: string): { kind: AssetKind; epic: string; format: AssetFormat } {
  const parts = rel.split(sep);
  const top = parts[0]!;
  const base = parts[parts.length - 1]!;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  if (top === 'docker') {
    if (base === 'Dockerfile') return { kind: 'dockerfile', epic: 'E2', format: 'dockerfile' };
    if (ext === '.yml' || ext === '.yaml') return { kind: 'compose', epic: 'E2', format: 'yaml' };
    return { kind: 'dockerfile', epic: 'E2', format: 'text' };
  }
  if (top === 'k8s') return { kind: 'k8s-manifest', epic: 'E3', format: 'yaml-multi' };
  if (top === 'helm') {
    if (base === 'Chart.yaml') return { kind: 'helm-chart', epic: 'E4', format: 'yaml' };
    if (base.startsWith('values')) return { kind: 'helm-values', epic: 'E4', format: 'yaml' };
    return { kind: 'helm-template', epic: 'E4', format: 'helm-template' }; // Go-templated / text
  }
  if (top === 'iac') return { kind: 'iac-template', epic: 'E5', format: ext === '.tf' ? 'hcl' : 'markdown' };
  if (top === 'github-workflows') return { kind: 'github-workflow', epic: 'E6', format: 'yaml' };
  if (top === 'config') return { kind: 'config', epic: 'E8', format: 'json' };
  if (top === 'monitoring') return { kind: 'monitoring', epic: 'E10', format: ext === '.json' ? 'json' : 'yaml' };
  if (top === 'secrets') return { kind: 'secrets-policy', epic: 'E7', format: ext === '.json' ? 'json' : 'env' };
  if (top === 'storage') return { kind: 'storage', epic: 'E12', format: 'json' };
  if (top === 'network') return { kind: 'network', epic: 'E13', format: 'text' };
  if (top === 'docs') return { kind: 'documentation', epic: 'E16', format: 'markdown' };
  return { kind: 'documentation', epic: 'E16', format: 'text' };
}

export class AssetCatalog {
  private cache: AssetDescriptor[] | null = null;

  private walk(dir: string, acc: string[]): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) this.walk(full, acc);
      else acc.push(full);
    }
  }

  /** Scan the real assets directory and classify every file. */
  scan(): AssetDescriptor[] {
    if (this.cache) return this.cache;
    const root = assetsDir();
    if (!existsSync(root)) throw new Error(`assets directory not found at ${root} (run from the workspace root)`);
    const files: string[] = [];
    this.walk(root, files);
    this.cache = files.map((f) => {
      const rel = relative(root, f);
      return { path: rel, ...classify(rel) };
    }).sort((a, b) => a.path.localeCompare(b.path));
    return this.cache;
  }

  list(kind?: AssetKind): AssetDescriptor[] {
    const all = this.scan();
    return kind ? all.filter((a) => a.kind === kind) : all;
  }
  byEpic(epic: string): AssetDescriptor[] {
    return this.scan().filter((a) => a.epic === epic);
  }
  /** Read an asset's raw content (used by validators and by callers that render/emit assets). */
  read(relPath: string): string {
    return readFileSync(join(assetsDir(), relPath), 'utf8');
  }
  exists(relPath: string): boolean {
    return existsSync(join(assetsDir(), relPath));
  }
  count(): number { return this.scan().length; }
}
