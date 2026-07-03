# NeuroPause Plugin SDK

Build plugins that extend NeuroPause itself. A plugin is a versioned, optionally
signed bundle with a manifest and (for code plugins) an entry module. Code
plugins run **isolated in their own process** behind a **permission-gated host
API**; UI plugins contribute surfaces to the workspace.

---

## 1. Manifest — `neuropause.plugin.json`

```json
{
  "id": "hello-automation",
  "name": "Hello Automation",
  "version": "0.1.0",
  "description": "A minimal background plugin.",
  "author": "You",
  "engine": { "neuropause": ">=0.1.0 <1.0.0" },
  "kind": "automation",
  "main": "index.cjs",
  "contributions": [],
  "permissions": ["notifications", "background"]
}
```

| Field | Notes |
|-------|-------|
| `id` | lowercase, `>=3` chars, `[a-z0-9._-]`; unique |
| `version` | semver `x.y.z` |
| `engine.neuropause` | host range: exact, `^`, `~`, `*`, or `">=0.1.0 <1.0.0"` |
| `kind` | `background` · `automation` · `ai_agent` · `mcp_server` · `ui` |
| `main` | entry module (required for all kinds except `ui`) |
| `contributions` | UI surfaces: `sidebar` · `toolbar` · `panel` · `widget` |
| `permissions` | subset of the 11 runtime capabilities |

A plugin enables only if its `engine` range is satisfied by the running host.

## 2. Plugin module contract (code plugins)

CommonJS, with optional `activate` / `deactivate`:

```js
module.exports = {
  async activate(host) { /* called once on enable */ },
  async deactivate()  { /* called on disable/shutdown */ },
};
```

### The host API

| Call | Permission | Behavior |
|------|------------|----------|
| `host.log(...args)` | — | Append to the plugin log stream |
| `host.emit(event, data)` | — | Emit a host event |
| `host.storage.get(key)` / `set(key, value)` | — | Plugin-private key/value store |
| `host.notify(title, body)` | `notifications` | Native desktop notification |
| `host.runModel(prompt)` | `local_models` | Local model call — **declared seam** today |
| `host.permissions` | — | The granted permission list |

Privileged calls are enforced in the main process against the plugin's granted
permissions; a revoked permission makes the call reject cleanly.

## 3. Lifecycle

```
install ─► (disabled) ─► enable ─► (enabled / running)
   ▲                         │            │
   │ update                  │ disable    │ reload (hot)
   │                         ▼            ▼
   └───────────────────── remove      re-read manifest + restart
```

- **install** — validates the manifest, copies the bundle into the managed
  plugins dir, grants the requested permissions (the install-time prompt UI lands
  in Stage 3), but leaves the plugin disabled.
- **enable** — checks compatibility, then for code plugins forks the isolated
  host process and calls `activate(host)`.
- **disable** — stops the process (`deactivate()` then terminate).
- **reload** — re-reads the manifest from disk and restarts (hot reload in dev).
- **update** — re-installs from the bundle and reloads if it was enabled.
- **remove** — stops and deletes the bundle.

Crashes are detected by the host's process supervision; a crashed plugin is
marked unhealthy and can be reloaded.

## 4. The `nps` CLI

Run via `npm run nps -- <command>` (or `node tools/nps/cli.mjs <command>`).

```
nps init <dir>                    scaffold a new plugin
nps validate <dir>                validate a plugin manifest
nps pack <dir> [-o file.npkg]     package a plugin (tar.gz) + sha256 sidecar
nps keygen [-o name]              generate an Ed25519 signing key pair
nps sign <file> -k <key.pem>      sign a package digest (Ed25519)
nps dev <dir>                     validate + print hot-reload run steps
```

**Signing** uses Ed25519 over the package's SHA-256 digest — the exact scheme the
runtime verifies. `nps keygen` prints a **key id**; once that key is registered as
trusted in the host, signatures from its private key verify. (The trust store
ships empty; registering keys is an admin action.)

## 5. Develop with hot reload

Point the host at a folder of plugins; edits hot-reload automatically:

```
export NEUROPAUSE_PLUGINS_DIR="/absolute/path/to/your/plugins"
npm run dev
```

Then enable your plugin from the app. The Plugin Loader watches the folder and
reloads enabled plugins on change.

## 6. Examples (in `examples/`)

- **`plugins/hello-automation`** — background plugin: storage, a permission-gated
  notification, and a heartbeat. Loads and runs via the host.
- **`plugins/echo-agent`** — AI agent plugin exercising the `local_models` seam.
- **`mcp/clock-server`** — a real standalone MCP server (stdio JSON-RPC 2.0) with
  a `current_time` tool. Run `node server.cjs`.

Try one:

```
export NEUROPAUSE_PLUGINS_DIR="$(pwd)/examples/plugins"
npm run dev
```

## 7. What's real vs. forthcoming

- **Real now:** process isolation, the permission-gated host API, install/enable/
  disable/update/reload/remove, version-compat gating, crash detection, manifest
  validation, packaging, and Ed25519 signing.
- **Forthcoming:** live sandboxed rendering of UI contributions (Stage 3 host UI);
  the host-side MCP client that calls `mcp_server` plugins (Phase 4 — the server
  half is real today); and the `local_models` runtime behind `host.runModel`.
