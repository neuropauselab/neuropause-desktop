# AI Worker Marketplace

Where the organization installs governed AI workers and shares its own to the
network. Built on the Stage 1 marketplace (`ai_worker` listings) plus the
Stage 2 installs store.

## Browse & install

Worker listings render as cards with pricing, install count, and rating. The
install lifecycle is real and tracked per organization:

- **Install** records an `Installation` (org, listing, installed version) and
  bumps the listing's install count.
- **Update available** appears when the listing's current published version has
  moved ahead of the installed version; **Update** re-points the installation at
  the current version.
- **Enable / Disable** toggles the installation without removing it.
- **Uninstall** removes the installation.
- **Rate** posts a rating through the marketplace.

## Share a worker

"Share a worker" lists your live workforce workers (from the workforce registry).
Sharing one:

1. Reads the worker's identity, goals, skills, and permission scopes.
2. Creates an `ai_worker` marketplace listing.
3. Adds a version whose manifest is derived from the worker (capabilities from
   skills, permissions from scopes).
4. Submits it — running the **real** security scan and **Ed25519** signing from
   Stage 1.

This is a genuine bridge from the AI Workforce (Phase 6) into the marketplace:
the shared worker is the same shape the runtime governs, and it goes through the
same publishing pipeline as any other listing.

## IPC

`ipc.ecosystem.installs | installSummary | installListing | updateInstall |
setInstallEnabled | uninstall | shareWorker`, plus `listings` and `rate` from
Stage 1.
