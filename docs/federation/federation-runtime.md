# Federation Runtime

The federation engine: who is federated with whom, at what trust level, and what
is shared across the boundary. Strict tenant isolation is preserved throughout —
nothing is shared by default, sharing is explicit and per-resource, and trust is
per-peer.

## Model

- **Federated organizations.** The **home** organization (the local NeuroPause
  org, `org-default`) plus **peers**. Each org carries a role (`home` | `peer`),
  a status (`active` | `invited` | `suspended`), a region, a trust level, and
  shared-resource counts in each direction.
- **Organization invitations.** Inbound and outbound, each with a status
  (`pending` | `accepted` | `declined` | `revoked`) and a proposed trust level.
  Accepting an inbound invitation promotes the sender to an active peer and
  establishes a trust relationship.
- **Trust relationships.** Per peer: a trust level (`none` | `basic` |
  `verified` | `full`), a `delegatedApproval` flag, and two capability flags —
  `canShareWorkers` and `canShareData`. These flags are what the sharing gates
  check.
- **Shared resources.** Projects, workspaces, AI workers, governance policies,
  and connectors, each with a direction (`outbound` | `inbound`) and an access
  level (`read` | `collaborate`).

## Sharing gates (real enforcement)

`shareResource` refuses a share when trust does not permit it:

- Sharing an **AI worker** requires `canShareWorkers`.
- **Collaborative** sharing of a connector, project, or workspace requires
  `canShareData`.

A peer that is not active cannot receive shares at all. The gate returns a typed
error the UI surfaces inline, rather than silently succeeding.

## Seeded topology (a fixture)

On first run the runtime seeds the home org plus three peers — Helios Commerce
(EU, verified), Aperture Capital (US-West, full), and Northwind Labs (AP-South,
invited) — a pending outbound invitation, a pending inbound invitation from
Quanta Group, and four shared resources (two outbound to Helios, two inbound
from Aperture). These peers are **fixtures**, not live remote organizations;
they exist so the federation surface is populated and the gates are exercisable.
The operations themselves (invite, respond, set trust, share, revoke) are real
and persist across restarts.

## IPC

`fed:runtime.*` — `orgs`, `summary`, `invitations`, `trust`, `shared`, plus the
audited mutations `invite`, `respondInvite`, `setTrust`, `share`, `revokeShare`.
