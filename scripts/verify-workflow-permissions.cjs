/**
 * S132 — GitHub Actions least-privilege assertion.
 *
 * Enforces, deterministically, that every workflow declares an explicit top-level `permissions:` block and
 * grants NO write scope beyond a small, justified allowlist (the release workflows legitimately need
 * `contents: write` to create a GitHub Release). A missing block (broad inherited default), a `write-all`,
 * or any stray `*: write` outside the allowlist fails closed.
 *
 * Pure `classifyWorkflowPermissions(name, doc, allowlist)` is exported for unit testing; the CLI parses
 * every `.github/workflows/*.yml` and runs only when executed directly.
 *
 * CLI: node scripts/verify-workflow-permissions.cjs [--dir .github/workflows]
 */
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

/**
 * The ONLY workflows permitted to hold a write scope, and exactly which. Release workflows create a GitHub
 * Release (upload assets) → `contents: write`. Everything else must be read-only. This allowlist IS the
 * policy surface: adding a write scope anywhere else requires editing this list (a visible, reviewable act).
 */
const DEFAULT_WRITE_ALLOWLIST = {
  // Governed release (neuropause-release.yml) publishes to R2 / the container registry / the cluster with
  // environment-scoped credentials, never with GITHUB_TOKEN: its top-level block is `contents: read` and the
  // only job-level widening (id-token + attestations on the credential-free provenance job) is policed by
  // tools/release-verify/gate-consumption-ast.cjs v6.4. Nothing in this repository needs contents:write.
};

/**
 * Classify a parsed workflow's top-level permissions. Pure. Returns { ok, errors:[] }.
 * Rules: block MUST exist · `write-all` is never allowed · `read-all` is fine · an object may hold `read`
 * / `none` freely, but any `write` scope must be listed for THIS workflow in the allowlist.
 */
function classifyWorkflowPermissions(name, doc, allowlist = DEFAULT_WRITE_ALLOWLIST) {
  const errors = [];
  const allowed = new Set(allowlist[name] || []);
  const perms = doc ? doc.permissions : undefined;

  if (perms === undefined || perms === null) {
    return { ok: false, errors: [`${name}: no top-level permissions block (inherits broad default GITHUB_TOKEN scopes)`] };
  }
  if (typeof perms === 'string') {
    if (perms === 'read-all') return { ok: true, errors: [] };
    if (perms === 'write-all') return { ok: false, errors: [`${name}: permissions: write-all is never allowed`] };
    return { ok: false, errors: [`${name}: unrecognized permissions string ${JSON.stringify(perms)}`] };
  }
  if (typeof perms !== 'object') {
    return { ok: false, errors: [`${name}: permissions must be a scope map or read-all`] };
  }
  let sawScope = false;
  for (const [scope, level] of Object.entries(perms)) {
    sawScope = true;
    if (level === 'write') {
      if (!allowed.has(`${scope}:write`)) errors.push(`${name}: unexpected write scope '${scope}:write' (not in allowlist)`);
    } else if (level !== 'read' && level !== 'none') {
      errors.push(`${name}: scope '${scope}' has unexpected level ${JSON.stringify(level)}`);
    }
  }
  if (!sawScope) errors.push(`${name}: empty permissions map`);
  return { ok: errors.length === 0, errors };
}

function main() {
  const args = process.argv.slice(2);
  const dirArg = args.indexOf('--dir');
  const dir = dirArg >= 0 ? args[dirArg + 1] : join(__dirname, '..', '.github', 'workflows');
  if (!existsSync(dir)) { console.error(`[workflow-perms] dir not found: ${dir}`); process.exit(1); }
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  const errors = [];
  for (const f of files) {
    let doc;
    try { doc = yaml.load(readFileSync(join(dir, f), 'utf8')); } catch (e) { errors.push(`${f}: YAML parse failed — ${e.message}`); continue; }
    const r = classifyWorkflowPermissions(f, doc);
    if (!r.ok) errors.push(...r.errors);
  }
  if (errors.length > 0) {
    console.error(`[workflow-perms] FAILED (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[workflow-perms] OK — ${files.length} workflows, all least-privilege`);
}

module.exports = { classifyWorkflowPermissions, DEFAULT_WRITE_ALLOWLIST };

if (require.main === module) main();
