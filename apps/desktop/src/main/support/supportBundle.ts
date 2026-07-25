/**
 * Support bundle generator. Assembles a shareable diagnostics package from
 * logs, diagnostics, versions, installed modules, connectors, plugins, and
 * crash reports — with secrets, credentials, and personal content redacted by
 * default. The redaction pass is exported and unit-tested independently; the
 * electron wiring (real paths + data providers) lives in ../diagnostics.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BuildIdentity, InstalledModule, SupportBundleInfo } from '@neuropause/shared';

/** Patterns that must never appear in a support bundle. */
const REDACTIONS: { pattern: RegExp; replacement: string }[] = [
  // Home-directory paths — strip the username component (personal identifier).
  { pattern: /\/Users\/[^/\s]+/g, replacement: '/Users/<user>' },
  { pattern: /\/home\/[^/\s]+/g, replacement: '/home/<user>' },
  { pattern: /[A-Za-z]:\\Users\\[^\\/\s]+/g, replacement: 'C:\\Users\\<user>' },
  // JWTs (header.payload.signature).
  { pattern: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, replacement: '[REDACTED_JWT]' },
  // Authorization: Bearer <token>.
  { pattern: /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, replacement: 'Bearer [REDACTED]' },
  // key/value secrets in JSON or env form.
  {
    pattern:
      /(["']?(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|client[_-]?id|password|passwd|authorization|secret|token|private[_-]?key)["']?\s*[:=]\s*)["']?[^"'\s,}{]+["']?/gi,
    replacement: '$1"[REDACTED]"',
  },
  // Email addresses (personal content).
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
];

/** Scrub secrets and personal content from arbitrary text. */
export function redactText(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Categories that are excluded or scrubbed from every bundle. */
export const REDACTED_CATEGORIES = [
  'Keychain / safeStorage secrets',
  'OAuth access & refresh tokens',
  'API keys & client secrets',
  'Email addresses & personal identifiers',
  'Home-directory paths & usernames',
];

/** Files under the data dir that are NEVER copied into a bundle. */
const NEVER_INCLUDE = new Set(['connectors.json', 'telemetry.log']);

export interface SupportBundlePayload {
  build: BuildIdentity;
  diagnostics: unknown;
  modules: InstalledModule[];
  connectors: { id: string; name: string; status: string }[];
  plugins: unknown[];
  crashes: unknown[];
}

export interface SupportBundleDeps {
  /** userData — source of logs + crash archive. */
  dataDir: string;
  /** Where bundles are written (e.g. userData/support). */
  outDir: string;
  collect: () => Promise<SupportBundlePayload>;
  now?: () => number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  if (!(await exists(dir))) return 0;
  for (const name of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) total += await dirSize(path);
    else total += (await fs.stat(path)).size;
  }
  return total;
}

export class SupportBundleGenerator {
  private readonly now: () => number;

  constructor(private readonly deps: SupportBundleDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async generate(): Promise<SupportBundleInfo> {
    const ts = new Date(this.now());
    const id = `support-${ts.toISOString().replace(/[:.]/g, '-')}`;
    const dest = join(this.deps.outDir, id);
    await fs.mkdir(dest, { recursive: true });

    const payload = await this.deps.collect();
    const contents: string[] = [];

    const writeJson = async (name: string, value: unknown): Promise<void> => {
      await fs.writeFile(join(dest, name), redactText(JSON.stringify(value, null, 2)), { mode: 0o600 });
      contents.push(name);
    };

    await writeJson('versions.json', payload.build);
    await writeJson('diagnostics.json', payload.diagnostics);
    await writeJson('modules.json', payload.modules);
    // Connectors: names + status only, never tokens.
    await writeJson(
      'connectors.json',
      payload.connectors.map((c) => ({ id: c.id, name: c.name, status: c.status })),
    );
    await writeJson('plugins.json', payload.plugins);
    await writeJson('crashes.json', payload.crashes);

    // Copy redacted log files.
    const logsSrc = join(this.deps.dataDir, 'logs');
    if (await exists(logsSrc)) {
      const logsDest = join(dest, 'logs');
      await fs.mkdir(logsDest, { recursive: true });
      for (const name of await fs.readdir(logsSrc)) {
        if (NEVER_INCLUDE.has(name)) continue;
        try {
          const raw = await fs.readFile(join(logsSrc, name), 'utf8');
          await fs.writeFile(join(logsDest, name), redactText(raw), { mode: 0o600 });
          contents.push(join('logs', name));
        } catch {
          /* skip unreadable log */
        }
      }
    }

    const manifest = {
      id,
      createdAt: ts.toISOString(),
      generator: 'neuropause-support-bundle',
      contents,
      redacted: REDACTED_CATEGORIES,
    };
    await fs.writeFile(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    contents.push('manifest.json');

    return {
      path: dest,
      createdAt: ts.toISOString(),
      sizeBytes: await dirSize(dest),
      contents,
      redacted: REDACTED_CATEGORIES,
    };
  }
}
