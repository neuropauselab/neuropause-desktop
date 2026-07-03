# Multi-Workspace Support

> Multiple organizations and workspaces with isolated, switchable contexts.
> Source: `apps/desktop/src/main/enterprise/workspace/`.

A **workspace** is an isolated operating context bound to exactly one
organization. Several coexist; exactly one is active at a time. The active
workspace determines which organization every other enterprise channel reads
(`activeOrg()` resolves the active workspace's org).

## Isolation

Each workspace declares `isolation: 'isolated'` — its data is scoped to that
workspace. Switching the active workspace re-points the org graph, governance
config, and executive snapshot at that workspace's organization. State is keyed
per workspace, so contexts do not bleed into one another.

## Seed

On first run a single **Default Workspace** is created, bound to the seeded
organization, and marked active.

## Persistence

`WorkspaceStore` is a serialized background writer (atomic write + rename, mode
`0600`, awaitable `flush()`), electron-free, unit-tested on a temp file. The
`userData` singleton lives in `workspaceInstance.ts`. It persists the workspace
list **and** the active selection across restarts.

## Channels

- `enterprise:workspace.list` → `WorkspaceSummary[]` (with org name + member/unit counts)
- `enterprise:workspace.active` → `Workspace`
- `enterprise:workspace.create` `{ name, organizationId? }`
- `enterprise:workspace.switch` `{ id }`
