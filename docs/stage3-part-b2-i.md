# Stage 3 · Part B-2 · I — Operations Center: Management Surfaces

This part completes the **visible** Operations Center: the five management
panels that were placeholders in B-1 are now live, and the Command Palette has
grown into a **Global Command Center**. Everything here is a renderer surface
built on the existing secure IPC bridge — no new main-process services, and no
new dependencies.

> Part B-2 is delivered in two passes. **This is pass I (management surfaces).**
> Pass II (platform core) adds the Internal Event Bus, Timeline Service, and
> Diagnostics — the typed internal services Phase 4's Connector Framework will
> consume. See "What's next" at the end.

---

## 1. What shipped

| Tab | Panel | Backed by |
|-----|-------|-----------|
| Plugins | **Plugin Manager** | `ipc.plugins.*` |
| Downloads | **Download Center** | `ipc.nps.*` (+ derived rate/ETA, persisted history) |
| Updates | **Update Center** | `ipc.catalog.checkUpdate`, `ipc.nps.update/rollback`, `ipc.plugins.update` |
| Permissions | **Permission Center** | `ipc.perms.*` |
| Collections | **Collections** | `ipc.registry.setFlags` + local store |
| — | **Global Command Center** | `ipc.registry/plugins/runtime/nps` (fetched on open) |

All five sub-nav tabs are now `ready: true`; the "arrives in B-2" accent dots
are gone. The Command Center can deep-link into any of these tabs via a new
one-shot `opsTab` channel on the shell (`useShell().openOperations(tab)`).

---

## 2. Plugin Manager

A production plugin console driven entirely by the Plugin Host (Stage 2 SDK).

**Per plugin:** glyph, name, author, kind; version; runtime state (with a live
pulse when enabled); health; compatibility (compatible ✓ / "Needs `engineRange`");
granted-vs-required permission count.

**Row actions:** Enable ↔ Disable, Reload, Update, View Logs (jumps to the
Activity tab), Uninstall (two-step armed confirm).

**Manifest drawer (click a row):** plugin id, engine range, kind, source path,
install/update timestamps, last error, contribution chips, and a
grant/revoke-able chip per required permission. The drawer surfaces the source
folder path (Finder-open is a desktop-shell action that lands with the Phase-4
updater). **Rollback** restores the Host's retained previous version after a
regressive update.

When no plugins are installed (the current state) the panel shows a precise
empty state; the full table activates the moment a plugin is loaded.

---

## 3. Download Center

A real transfer manager over the Package Service.

**Active table:** name + kind, progress bar + bytes, **Speed** and **ETA**
(derived in the provider from bytes-over-time — see §8), **Integrity**
(Checking → Verified as the op moves through `verifying`/`installing`),
**Signature** (looked up from the registry's `hasSignature`), status, and
Pause/Resume + Cancel.

**History:** completed/failed/cancelled transfers are **persisted across
relaunches** (`np.downloadHistory`, capped at 100). Failed entries expose a
one-tap Retry; "Clear" empties the history.

The transfer queue is FIFO in the Package Service; "Prioritize" is intentionally
left as a seam rather than faked client-side.

---

## 4. Update Center

Unified updates across three layers:

- **Applications** — on mount the panel calls `ipc.catalog.checkUpdate` for each
  installed app and lists those with an update (minus ignored versions). Per
  app: Update, Rollback, Ignore-this-version (`np.ignoredVersions`). **Update
  All** runs them in sequence.
- **Plugins** — Update via the Plugin Host.
- **Platform** — Desktop (live version from `ipc.app.getInfo`), Runtime, and
  Connector packages shown as honest managed-status rows. Desktop/runtime
  self-update is a status surface pending the Phase-4 updater; connector
  packages read "Phase 4".

**Release channels** (Stable / Beta / Nightly) and **automatic updates** persist
to prefs (`np.updateChannel`, `np.autoUpdate`). The 6-hour background update
checker that already runs in the main process is reflected in the footer. The
changelog is surfaced inline from `UpdateCheck` (version + release id); a full
release-notes viewer arrives with the release-notes endpoint.

---

## 5. Permission Center

A security dashboard that **groups every grant by capability** — Filesystem,
Network, Clipboard, Notifications, Camera, Microphone, Automation, Background
Services, Local AI Models, Shell Execution (Filesystem folds read + write).

For each capability: a live count of granted / denied / revoked across all apps,
expandable to per-app rows showing state, last-modified, and a Grant/Revoke
toggle (`ipc.perms.grant/revoke`, applied immediately). An **Audit history**
section lists recent permission changes. Plugin permissions are managed in the
Plugin Manager; both write to the same activity stream — which, in pass II, the
Timeline Service will persist durably.

---

## 6. Collections

Organize installed apps with **smart** and **custom** collections.

- **Smart (computed live from the registry):** Favorites, Pinned, AI Agents,
  MCP Servers, Local Models.
- **Custom:** seeded with Development / Research / Business / Marketing, plus
  user-created collections. Create, delete, assign, and tag — all persisted to
  `np.collections`.
- **Drag and drop:** drag an app card onto a collection. Dropping on Favorites
  or Pinned flips the registry flag (`setFlags`); dropping on a custom
  collection adds an assignment; type-based smart collections are not manually
  assignable.
- **Search**, **sort** (Name / Recent), and inline **tags** per app.

**Sync** is prepared but not implemented: a typed `CollectionSyncTarget`
interface (`push`/`pull` over a `CollectionsStore` snapshot) defines the seam,
and the "Cloud sync" control is present-but-disabled. Cloud sync lands with
account sync.

---

## 7. Global Command Center (⌘K)

The palette now searches across domains, keyboard-first:

- **Applications** (catalog) → open in Workspace
- **Plugins / Sessions / Downloads** → fetched live when the palette opens
  (`ipc.plugins.list`, `ipc.runtime.list`, `ipc.nps.operations`)
- **Go to** → every section *and* every Operations sub-tab (Activity Log,
  Permission Center, Collections, Health, …) via `openOperations(tab)`
- **Commands** → appearance, sidebar, settings

Empty query shows **Recent actions** (`np.recentCommands`) plus navigation;
typing runs the existing subsequence scorer across every group. Arrow keys +
Enter throughout; the active row auto-scrolls into view.

The palette lives above the Operations provider (it's global), so it fetches its
own snapshot rather than depending on any one view being mounted.

---

## 8. Performance considerations

- **Single live hub.** All Operations panels read one `OperationsProvider` —
  one set of event subscriptions (`runtime.onEvent`, `plugins.onEvent`,
  `nps.onProgress`) and one 3 s poll for runtime/operations, shared across
  every tab. Panels are pure consumers; switching tabs mounts/unmounts a view
  but never re-opens a subscription.
- **Rate/ETA without timers.** Transfer speed is derived from the progress
  events themselves: a per-op `{bytes, at}` sample is compared to the previous
  one. No extra polling, and samples are deleted on terminal status so the map
  can't grow unbounded.
- **Bounded buffers.** Activity log is capped at 500 entries; download history
  at 100. Both trim on write.
- **Lazy fetch.** Per-app `checkUpdate` and per-app `perms.list` run only when
  the Update or Permission panel is mounted — not on app start. The Command
  Center fetches its snapshot only on open.
- **JIT-safe styling.** All tone/status colors use literal class records (no
  interpolated Tailwind classes), so nothing is purged at build time.
- **Persistence is fail-safe.** All new prefs (`collections`, `downloadHistory`,
  `updateChannel`, `ignoredVersions`, `autoUpdate`, `recentCommands`) go through
  the typed `prefs` wrapper, which falls back to defaults rather than throwing.

---

## 9. Honest status — real vs. seam

**Real now:** plugin enable/disable/reload/update/uninstall + permission
grant/revoke; download pause/resume/cancel/retry with live speed/ETA and
persisted history; app update/rollback/ignore via the Package Service; per-app
permission toggles grouped by capability with an audit trail; collections with
drag-drop, tags, smart filters, and local persistence; a cross-domain command
center with recents.

**Honest seams (typed, visible, not faked):** desktop/runtime self-update and
connector packages (Phase-4 updater); plugin folder open (desktop shell);
download "Prioritize" (FIFO queue); full changelog viewer (release-notes
endpoint); collection cloud sync (`CollectionSyncTarget`, account sync).

Because nothing is installed yet, most panels show empty states. Install a few
apps from the **AI Store** to see the registry, sessions, permissions, updates,
and collections populate with real data.

---

## What's next — Part B-2 · II (Platform Core)

The infrastructure the Connector Framework will build on, as its own carefully
verified pass:

1. **Internal Event Bus** — a typed main-process pub/sub unifying runtime,
   plugin, registry, permission, and download events into one `PlatformEvent`
   stream with strongly-typed categories; broadcast to the UI without exposing
   implementation details.
2. **Timeline Service** — durable capture of every significant event
   (timestamp, type, resource, actor, metadata) with a query API; the
   foundation for Activity Intelligence, Daily Summaries, the Reminder Engine,
   Automation Rules, and AI Memory. Capture + query only — no AI analysis.
3. **Diagnostics** — runtime / IPC / background-services / DB / cache / event-bus
   / timeline / registry health, with exportable reports.

Delivered with the event-bus architecture doc, timeline-service doc, and
updated performance notes. **Phase 4 (Connector Framework) waits until B-2 · II
is approved.**
