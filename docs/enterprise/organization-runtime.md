# Organization Runtime

> The org chart, persisted and editable. Source: `apps/desktop/src/main/enterprise/org/`.

## Model

```
Organization
└── OrgUnit (kind: business_unit | department | team)   ← hierarchical, parentId
        └── OrgUnit …
OrgUser (kind: human | ai_worker)   ← belongs to a unit, holds roles
OrgRole (permissions: EnterprisePermission[])
```

- **Organization** — id, name, slug, description, metadata.
- **OrgUnit** — a node in the chart. Business units contain departments contain
  teams (`parentId`); each may have a `leadUserId`.
- **OrgUser** — a member. Humans and AI workers share one model; an `ai_worker`
  member carries the underlying `workerId` from the workforce registry.
- **OrgRole** — a named permission set. Six built-in roles ship and cannot be
  deleted: Owner, Admin, Manager, Member, Viewer, AI Worker.

## Permissions

Coarse-grained, least-privilege scopes (`EnterprisePermission`): `org:*`,
`people:*`, `workspace:*`, `workforce:read|operate|approve`, `governance:*`,
`intelligence:read`, `operations:*`, `dashboard:read`. Roles are bundles of these.

## Seed

On first run the runtime seeds a default organization, **NeuroPause**, with a full
unit hierarchy (Product & Engineering → Engineering → Platform/AI Team, Design;
Business → Sales/Marketing/Finance/Legal; Operations → IT/Support), the six
built-in roles, and a single **Owner** member. The owner is renamed to the
signed-in account at startup. Stable ids make the seed deterministic.

## Folding in the AI workforce

`syncWorkers(workers, roleToUnitId)` upserts an `ai_worker` member for every
registered worker, placed on the team matching its role (engineering → Platform,
finance → Finance, …). It is **idempotent** (re-running changes nothing), refreshes
existing members, and prunes members whose worker is gone. This runs at startup
and whenever the registry changes, so the org chart always reflects the live
workforce. No people are invented.

## Persistence

`OrgStore` is a serialized background writer (the same pattern as the knowledge
graph store): atomic temp-write + rename, mode `0600`, coalesced writes, awaitable
`flush()`. The class is electron-free (the file path is injected) and unit-tested
on a temp file; the `userData` singleton lives in `orgInstance.ts`.

## Channels

- `enterprise:org.get` → `{ organization, units, roles, users }`
- `enterprise:org.{create,update,delete}Unit`
- `enterprise:org.{create,update,delete}User` (delete refuses AI workers)
- `enterprise:org.{create,update,delete}Role` (delete refuses built-ins)

Every mutation records an entry to the org-level audit trail.
