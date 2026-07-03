# Organization Exchange

A network where organizations share curated **packs** — bundles of knowledge,
AI workers, automations, or connectors — and adopt packs shared by others.

## Packs

A pack has a kind (knowledge / ai_worker / automation / connector), a publishing
organization, a list of items, and adoption state. The panel separates **My
packs** (published by the local organization) from **Shared from the network**.

- **Publish a pack** bundles items and shares them; the pack is marked local and
  installed.
- **Import** records the local organization adopting a network pack and
  increments its install count.
- **Remove** deletes a pack you published.

## Honest seam — the network

This is a single-tenant application modeling a multi-organization network. The
external publishing organizations (Helios Commerce, Aperture Capital, Northwind
Labs) are **seeded fixtures**, and "import" records local adoption rather than a
real cross-tenant transfer. The data model and flows are real; the multi-tenant
backplane is the seam that a Cloud/Federation phase would provide.

## IPC

`ipc.ecosystem.packs | packsStats | publishPack | importPack | removePack`.
