# NeuroPause Runtime — Stage 2 · Part A (Runtime Core)

The trusted execution layer beneath every app installed through NeuroPause. Part A
delivers the four interdependent foundations: **Secure Catalog IPC**, the **Local
Application Registry**, the **NeuroPause Package Service (NPS)**, and the
**NeuroPause Runtime + Permission System** (with the Health Monitor, Update
Checker, and Download Manager the runtime depends on).

Everything runs in the **main process**. The renderer never talks to the backend
or the filesystem directly — it speaks only typed, validated IPC channels.

---

## 1. Secure Catalog IPC

```
renderer  ──invoke(channel,payload)──►  preload allowlist  ──►  secure bridge  ──►  handler
   ▲                                                                │  1 sender trust
   └────────────── typed result / clean error ◄────────────────────┤  2 auth gate
                                                                    │  3 Zod validation
                                                                    │  4 timeout
                                                                    │  5 audit log
                                                                    └  6 error shaping
```

- **Typed contracts + Zod** — every channel is bound to a schema in
  `packages/shared/src/ipc/contracts.ts`; payloads are parsed before any work runs.
- **Middleware** — `main/ipc/secureBridge.ts` enforces the six-step pipeline above
  for all runtime-core channels.
- **Timeout** — handlers are bounded (30s default; 120s for installs) so a hung
  backend can't wedge IPC.
- **Audit logging** — mutating calls append a structured JSON line to
  `userData/logs/audit.log`.
- **Isolation** — the only network caller is `main/catalog/catalogClient.ts`,
  which attaches the access token from the auth service.

Channel families: `catalog:*` (proxy to the Store API), `registry:*`, `nps:*`,
`runtime:*`, `perms:*`, plus broadcasts `runtime:event`, `runtime:openApp`,
`nps:progress`.

## 2. Local Application Registry  (`main/registry/registry.ts`)

The on-disk source of truth for installed apps. Atomic writes (temp + rename,
mode 0600), a SHA-256 integrity checksum verified on load, and a versioned schema
with a forward `migrate()` hook.

Per app it records: version, install location, package hash, signature key id,
granted permissions (+ per-permission state), launch count, last launch, last
update, runtime status, health status, disk usage, configuration, pinned,
favorite, and usage analytics (launches, active time, last session). Supports
**export / import / backup / restore / migration / integrity verification**.

## 3. NeuroPause Package Service — NPS  (`main/nps/`)

The lifecycle engine. Each request becomes a tracked operation with a state
machine and progress events.

```
NPS operation lifecycle
  queued ─► resolving ─► downloading ─► verifying ─► installing ─► completed
                            │  ▲            │             │
                          paused┘           └─ failed ◄───┴──► failed
                            │
                          cancelled
  (web apps skip downloading + verifying — there is no artifact to fetch)
```

- **Operations**: install, uninstall, update, rollback, repair, verify.
- **Integrity** (`integrity.ts`): streamed SHA-256 + length-safe comparison.
- **Signatures** (`signature.ts`): real Ed25519 verify via `node:crypto` against
  a trusted-key store (+ keygen/sign helpers for the Part B signing tool).
- **Downloads** (`downloadManager.ts`): streamed HTTP(S), disk cache, byte
  progress, **pause/resume via HTTP Range**, cancel via AbortController.
- **Permissions**: required-but-ungranted permissions block an install and are
  returned to the caller.
- **Rollback**: the previous version + hash are retained on every update.

**Honesty boundary.** Web apps install + launch fully (no artifact). Packaged app
types use the full download → integrity → signature pipeline, which is real and
activates the moment a package registry serves signed artifacts; until then the
seeded artifact URLs do not resolve and surface as a clear network error.

## 4. NeuroPause Runtime + Permissions  (`main/runtime/`, `main/permissions/`)

The supervisor owns every live instance and drives the lifecycle; adapters
implement how each app *kind* actually runs. Built for many simultaneous
instances across many kinds.

```
Runtime instance lifecycle
            launch
   stopped ───────► starting ───► running ──► suspended
      ▲                │            │  ▲          │ resume
      │ stop           │ fail       │  └──────────┘
      └───── stopping ◄┘            │ crash
                                    ▼
                                 crashed ──► (restart ≤3, backoff) ──► starting
                                    │ limit
                                    ▼
                                  failed
```

- **Web adapter** (`adapters/webAdapter.ts`) — opens the app as a Workspace tab;
  fully functional. Live CPU/memory via Electron `app.getAppMetrics()`.
- **Process adapter** (`adapters/processAdapter.ts`) — real `child_process`
  lifecycle for Electron/native/AI-agent/MCP-server/automation kinds: spawn,
  stdout/stderr → logs, exit → crash detection, stop = SIGTERM, suspend = SIGSTOP,
  resume = SIGCONT. Needs a runnable entry (packaged artifact or dev command);
  without one it returns a clear "no executable entry point" result.
- **Supervisor** (`supervisor.ts`) — launch/stop/suspend/resume/restart, health
  checks, resource sampling, crash detection, restart policy, and a centralized
  event sink that mirrors status into the registry and broadcasts to the renderer.

**Permission system** (`permissionManager.ts`) — 11 capabilities (the catalog's
10 + `shell_execution`), each in a state of requested / granted / denied /
revoked, persisted per app in the registry, decided at install time and editable
later, enforced before a capability is used.

## Background services  (`main/services/serviceManager.ts`)

Part A ships the **Health Monitor** (5s liveness + resource pass) and **Update
Checker** (polls the Store for updates to installed apps). The Download Manager
and Supervisor are event-driven singletons. The remaining services (telemetry,
crash reporter, task + notification schedulers, plugin loader) arrive in Part B.

---

## Verifying Part A

The runtime core is the layer *under* the UI, so confirm it from the main-process
logs (the terminal running the desktop app):

```
[runtime-core] Runtime core ready: catalog reachable (20 apps), registry loaded (0 installs)
[services] Background services started { count: 2 }
[secure-ipc] Secure IPC handlers registered { count: 40 }
```

The visible proof of the IPC bridge is the **Store and launcher now showing the
real 20 apps from PostgreSQL** — the catalog is served over `catalog:*` through
the secure bridge, not from the local sample file.

## What's next — Part B

Plugin Runtime SDK (manifest, loader, lifecycle, sandbox, surfaces), the
remaining background services, and the Developer SDK (CLI, packaging, signing,
hot reload, examples). Then Stage 3: the premium marketplace UI on these APIs.
