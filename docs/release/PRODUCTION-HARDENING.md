# Production Hardening — Release 1.0, Stage 1, Increment 1

> Platform hardening (code hygiene + quality gate). Every claim below was
> verified in this increment, not asserted. This is the code-side slice of
> Stage 1; distribution (signing/notarization), penetration testing, and the
> pilot program are tracked separately and require your machine, your Apple
> Developer account, and third parties respectively.

## Quality gate — all green

| Gate | Result |
|---|---|
| `tsc` (Node project) | **0 errors** |
| `tsc` (web project) | **0 errors** |
| `eslint . --max-warnings 0` | **0 problems** (was 4 errors + 4 warnings) |
| `vitest run` | **38 files · 242 tests passing** |
| `npm audit --omit=dev` | **0 vulnerabilities** |

## What changed in this increment

### 1. Worker health rollup fix
The Observability subsystem counted any worker not in the `healthy` state as
"degraded." Freshly registered workers default to `unknown` (untested:
`successRate` 1, `jobsRun` 0) and only move to `degraded`/`unhealthy` after
actually failing jobs. The rollup now counts **only** genuinely `degraded` or
`unhealthy` workers. On a clean boot the AI Workers subsystem reads **Healthy**
and the header reads **7/7** instead of "4/7 · 8 degraded." The seeded
degraded-path test is unaffected (it passes the count explicitly).

### 2. Lint to zero (8 → 0)
- `platform/benchmark.mts` — the 1-subscriber block now reports its delivery
  count, matching the 10-subscriber block (removes an unused counter).
- `registry/registry.ts` — `let f` → `const f` (never reassigned).
- `search/enterpriseSearch.test.ts` — dropped an unused `GraphEdge` import.
- `operations/PluginsPanel.tsx` — escaped an apostrophe in JSX.
- `auth/loopbackServer.ts` — `import` → `import type` for a type-only import.
- `developer/`, `ecosystem/`, `enterprise/` views — reference `navVersion`
  inside the nav `useMemo`, matching the Cloud and Federation views (clears the
  exhaustive-deps warning).

### 3. Dev-only code — verified clean
A scan of `apps/desktop/src` and `packages/` (excluding tests and the logger)
found **zero** `console.*`, `debugger`, `@ts-ignore`/`@ts-nocheck`, or
`TODO`/`FIXME`/`HACK` markers. The standalone `benchmark.mts` uses `console.log`
by design (a CLI bench tool, not bundled into the app).

## Security posture — reviewed and verified

This is the real, current posture (file references in parentheses):

- **Renderer isolation** — `contextIsolation: true`, `nodeIntegration: false`,
  sandboxed renderer, and navigation locked to the app's own origin
  (`main/window.ts`). The renderer talks to the main process **only** through
  the secure IPC bridge, where every one of the 270 channels validates its
  payload against a Zod schema.
- **Content-Security-Policy** — `default-src 'self'` enforced on the renderer
  (`main/security/csp.ts`).
- **Secret storage** — auth refresh tokens (`security/secureStore.ts`) and
  connector OAuth tokens (`connectors/connectorVault.ts`) are encrypted with
  Electron `safeStorage`, which on macOS is backed by the **Keychain**. The
  on-disk files hold ciphertext only; plaintext secrets are never written.
- **Telemetry** — **off by default** (opt-in). Confirmed at boot:
  `Telemetry initialized { enabled: false }`.
- **Logging** — the production log threshold is `info` (debug suppressed) and is
  gated on `NODE_ENV === 'production'` (`main/logger.ts`).
- **Configuration** — `isDev` is derived from `app.isPackaged`; the backend URL
  is read from `NEUROPAUSE_BACKEND_URL` (`main/config.ts`).

### Production-config note (for you to set before release)
`NEUROPAUSE_BACKEND_URL` defaults to `http://127.0.0.1:4000` (local). For a
distributed release, set it to your production backend at build/run time, or
document that the backend is co-located with the desktop app. No code change is
needed — it is an environment value.

## Known tooling deprecation (not a NeuroPause warning)
`electron-vite`/`vitest` emit "The CJS build of Vite's Node API is deprecated"
during dev and test. This originates in the build tooling's use of Vite's CJS
Node API and is resolved upstream when those tools migrate to Vite's ESM API.
It does **not** appear in the packaged app's runtime and does not affect output.
Tracked as an upstream dependency item; suppressing it by force is not worth the
risk to the build.

## Remaining Stage 1 work (and where it runs)

- **In-container (I can build + verify):** auto-updater wiring, electron-builder
  config refinement, diagnostics (opt-in) code, the eight documentation guides,
  a load/stress harness for the IPC + intelligence engines.
- **Your machine + Apple Developer account (I scaffold, you execute):** macOS
  code signing, Apple notarization (`notarytool`), DMG production, publishing
  auto-updates to a release server.
- **You / third parties (I prepare checklists, can't perform):** penetration
  testing, the pilot program with real organizations, and billing execution via
  a real payment processor.
