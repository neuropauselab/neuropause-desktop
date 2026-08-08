# NeuroPause Enterprise — Administrator Guide

**Audience:** Enterprise administrators (org owners, admins, and platform operators).
**Scope:** How to administer a NeuroPause Enterprise deployment — organization structure, users and RBAC, identity, governance, compliance, audit, licensing, connectors, and the AI workforce.

> **About this guide.** Every capability below was verified against the shipping source and is cited as `path:line`. Where a feature is *modeled*, *projected*, *read-only*, or *not yet in-app*, this guide says so plainly rather than implying more than the product does. Read the **Known Admin Gaps** section before making procurement or security commitments.

---

## 1. Overview

NeuroPause administration spans two cooperating layers. They describe "the organization" at different levels and are intentionally **not** coupled (`apps/backend/src/organizations/types.ts:9-13`):

| Layer | What it governs | Roles | Where it lives |
|---|---|---|---|
| **Cloud tenancy** | SaaS org ⇄ user membership, invitations, workspaces, multi-tenant isolation | Flat role: `owner \| admin \| member \| viewer` (`apps/backend/src/organizations/types.ts:15`) | Backend service, Postgres (`apps/backend/src/organizations/`) |
| **Desktop Enterprise-OS** | The in-app org chart (business units → departments → teams), people + AI workers, a 57-scope RBAC model, governance policies, audit | 6 built-in roles + custom roles (`apps/desktop/src/main/enterprise/org/seed.ts:197-206`) | Electron main process, JSON-persisted (`apps/desktop/src/main/enterprise/`) |

Your day-to-day console is the **Administration workspace** — a single read-only lens over both layers that deep-links you into the real editors. It is described in Section 4.

**What is real vs. modeled at a glance:**

- **Real:** org/membership tenancy with row-scoped isolation; the 57-scope RBAC model and its enforcement gate; built-in + custom roles; governance approval-chain and compliance-rule toggles; the append-only audit trail; MFA org policy; SSO/SCIM configuration surfaces; backend-backed trusted devices; the connector registry; the 27-archetype AI workforce with install/enable/disable; Razorpay subscription checkout on the backend.
- **Modeled / projected / advisory:** SSO SAML/OIDC assertion validation (no signature/JWKS verification); the SOC 2 / GDPR / ISO scorecard (computed, not certified); the 7-tier commercial catalog and 5 deployment modes (synthesized packaging over the real plan tiers); seat counts (displayed, not enforced); partner records (demo fixture).

---

## 2. Getting Started — the roles you need

### 2.1 The desktop trust model

On a desktop install, the signed-in machine account is resolved to an Enterprise-OS member before any permission check. If your account email matches a human member, you act as **that member with their assigned roles**; if it matches no member, you resolve to the seeded **workspace Owner** — the desktop's existing "the machine's account holder owns the workspace" trust model (`apps/desktop/src/main/enterprise/authzGate.ts:53-65`). A session email matching a **suspended** or **invited** member resolves to that member, who holds **no** permissions — so suspending someone genuinely locks them out (`authzGate.ts:22-25`, `apps/desktop/src/main/enterprise/authz.ts:41`).

The seeded Owner is a protected **root of trust**: it can never be deleted, and its roles/status cannot be stripped (`authzGate.ts:186-205`).

### 2.2 Which scope unlocks which task

Effective permissions are the **union of the permissions on your active roles** (`authz.ts:36-48`). The scopes that matter for administration:

| To do this | You need the scope | Built-in role that has it |
|---|---|---|
| View org, people, dashboards | `org:read`, `people:read`, `dashboard:read` | every human role (Viewer and up) |
| Edit org structure (units) | `org:manage` | Admin, Owner |
| Add/edit people, assign roles to people | `people:manage` | Manager, Admin, Owner |
| Create/edit/delete roles; toggle governance policies | `governance:manage` | Admin, Owner |
| Create/switch workspaces | `workspace:manage` | Admin, Owner |
| Install/enable/disable AI workers | `workforce:manage` | Admin, Owner |
| Edit the marketplace org policy | `marketplace:manage` | Admin, Owner |
| Manage connectors | `connectors:manage` | Manager, Admin, Owner |

(Role→scope bundles: `apps/desktop/src/main/enterprise/org/seed.ts:63-126`. Channel→scope map: `authzGate.ts:89-137`. Note that **role CRUD sits under `governance:manage`, not `org:manage`** — `authzGate.ts:100-102`.)

For **cloud tenancy** actions (inviting members, workspaces), you must be an org **owner** or **admin**; only they can manage members (`apps/backend/src/organizations/service.ts:34-36`).

---

## 3. Organization & Tenancy

### 3.1 Cloud tenancy (backend)

The cloud layer is the multi-tenant SaaS model: one `Organization`, many `Membership` rows, each with a flat role and status (`apps/backend/src/organizations/types.ts:15-39`).

**Creating an org and inviting people.** The creator becomes `owner` automatically (`service.ts:81-113`). Owners/admins invite members by email and role (`service.ts:130-157`). Invitations are **opaque tokens** — only a SHA-256 hash is stored, the raw token is returned exactly once, invitations expire after **7 days**, and are bound to the invited email address (`service.ts:33`, `service.ts:50-56`, `service.ts:145-155`). The in-app surface is the **Organization** section (`apps/desktop/src/renderer/src/organization/OrgMembers.tsx`), where owners/admins invite, change role, and remove members (`OrgMembers.tsx:60-101`; the controls are gated by `canManage = owner || admin`, `OrgMembers.tsx:72`).

**Guardrails you will hit (by design):**
- The **last active owner** cannot be demoted or removed (`service.ts:228-235`, `service.ts:256-262`).
- Only an owner can grant, change, or remove another **owner** (`service.ts:134-135`, `service.ts:223-227`).

**Row-scoped tenant isolation.** Every production query is scoped to a single org via `WHERE org_id = $1`, and workspace writes are scoped by **both** workspace id and org id, so one tenant can never read or mutate another's rows (`apps/backend/src/organizations/repository.ts:149`, `:164`, `:171`, `:184`, `:233`, `:240`, `:248`). Membership uniqueness, owner counting, and pending-invite lookups are all org-scoped as well.

### 3.2 Desktop Enterprise-OS org chart

The in-app organization is a hierarchy: **business unit → department → team**, populated with people (`human`) and governed AI workers (`ai_worker`) (`packages/shared/src/types/enterprise.ts:16-67`). On first run it is seeded with a realistic chart, the six built-in roles, and a single Owner bound to your account (`apps/desktop/src/main/enterprise/org/seed.ts:137-223`). The runtime is JSON-persisted and edited through the **Enterprise → Customize** panel (Section 5).

**Editing structure** (needs `org:manage`): create units of any kind, re-parent them, assign a unit lead, and delete units (deleting a unit re-parents its children and detaches its members rather than orphaning them — `apps/desktop/src/main/enterprise/org/orgStore.ts:268-281`). The Customize panel exposes add/delete unit directly (`apps/desktop/src/renderer/src/enterprise/CustomizePanel.tsx:128-152`).

> **Honest note.** The org chart has exactly three unit kinds. There is **no separate "group" or "location/site" entity** — see Known Admin Gaps.

---

## 4. The Administration Workspace

Open the **Administration** workspace to get one console over everything. It has ten tabs (`apps/desktop/src/renderer/src/administration/AdministrationView.tsx:140-151`):

**Overview · Organization · Identity & Access · Roles & Permissions · Security · Compliance & Audit · AI Administration · Connectors · Licensing · Configuration**

**Read this before you rely on it:** the Administration workspace is a **read-only lens**. It composes existing data and **mutates nothing** — every actionable control is a **deep-link** that jumps you to the real editor (`AdministrationView.tsx:1-12`, `:217-228`). The deep-link destinations are:

| From the Admin tab | "Manage/Edit" sends you to |
|---|---|
| Organization | **Organization** section, or **Enterprise → Customize** (`AdministrationView.tsx:312`, `:322`) |
| Identity & Access | **Cloud** (SSO/SCIM/MFA), **Settings** (devices) (`:347`, `:357`) |
| Roles & Permissions | **Enterprise → Customize** (`:388`, `:409`) |
| Security | **Developer** (API keys) (`:425`) |
| Compliance & Audit | **Cloud** admin, **Enterprise** (`:456`, `:474`) |
| AI Administration | **AI Workforce**, **Enterprise → Customize** (governance) (`:511`, `:526`) |
| Connectors | **Connectors** (`:541`) |
| Licensing | **Commercial Center** (`:559`) |
| Configuration | **Cloud**, **Release Ops** (`:587`, `:594`) |

Each tab also renders an honest **"Administrative gaps"** panel listing capabilities the platform does *not* surface in-app, so the console never fabricates a control it lacks (`AdministrationView.tsx:230-255`, catalog in `apps/desktop/src/renderer/src/administration/adminModel.ts:88-103`).

---

## 5. Users, Roles & RBAC

### 5.1 The 57-scope permission model

Authorization is built on a fixed set of **57 coarse-grained, least-privilege permission scopes** — the `EnterprisePermission` union (`packages/shared/src/types/enterprise.ts:72-142`; the matching runtime array is `ALL_ENTERPRISE_PERMISSIONS`, `:144-215`). Scopes follow a `domain:action` shape, e.g. `org:read`/`org:manage`, `people:manage`, `governance:manage`, `workforce:operate`/`workforce:approve`/`workforce:manage`, `connectors:manage`, plus read scopes for every platform projection (`federation:*`, `cloud:*`, `developer:*`, and the P13–P20 read scopes).

**How enforcement works.** A member's effective permissions are the **union across their active roles**; **only `active` members hold permissions** — `invited` and `suspended` members hold none (`apps/desktop/src/main/enterprise/authz.ts:36-48`). The gate resolves your session to a member, then calls `requirePermission` before dispatching any permission-annotated IPC channel; a channel with no classification **fails closed at startup**, never open (`authzGate.ts:72-81`, `:165-175`).

### 5.2 Built-in roles

Six roles ship built-in and **cannot be deleted** (`orgStore.ts:353-355`); their permission sets are the calibrated RBAC baseline and are **immutable** (you may rename/redescribe them, but not change their scopes — `authzGate.ts:207-220`). On upgrade, built-in roles are auto-reconciled so new platform scopes backfill onto existing installs (`orgStore.ts:123-137`).

| Role | Permissions | Source |
|---|---|---|
| **Owner** | All 57 scopes (root of trust) | `seed.ts:198-200` |
| **Admin** | Manager + `org:manage`, `governance:manage`, `workspace:manage`, `workforce:manage`, `marketplace:manage`, `federation:*`, `cloud:manage`, `developer:manage` | `seed.ts:115-126` |
| **Manager** | Member + `workforce:approve`, `people:manage`, and the domain `:manage` scopes (crm/sales/inventory/…), `connectors:manage` | `seed.ts:99-113` |
| **Member** | Read-only + `workforce:operate` | `seed.ts:97` |
| **Viewer** | Read-only across the org | `seed.ts:63-95` |
| **AI Worker** | Constrained: `workforce:read`, `intelligence:read` | `seed.ts:128` |

### 5.3 Create a custom role (step-by-step)

Custom roles are supported by the model (`builtIn: false`) and gated by `governance:manage` (`orgStore.ts:327-342`; channel gate `authzGate.ts:100`). To create one:

1. Open **Enterprise → Customize** (or the Admin **Roles & Permissions** tab → **Edit roles**).
2. In the **Roles** panel, enter a role name.
3. Toggle the permission checkboxes you want, then **Create role** (`CustomizePanel.tsx:74-84`, `:155-171`).
4. The new role appears in the role list immediately, and the action is written to the audit trail (`apps/desktop/src/main/enterprise/index.ts:648-663`).

> **Honest limitation of the shipped UI.** The Customize role builder exposes only **eight common permission toggles** (View organization, View people, View/Operate/Approve workforce, View governance, View dashboards, View operations — `CustomizePanel.tsx:27-36`), not the full 57-scope palette. Assigning the remaining scopes, and **editing or deleting** an existing custom role, are supported by the IPC layer (`updateRole`/`deleteRole`, `apps/desktop/src/renderer/src/lib/ipc.ts:1218`, `:1230`; store `orgStore.ts:344-362`) but are **not surfaced** in the Customize panel today. Plan custom roles accordingly.

### 5.4 Assign a role to a person

Roles are assigned via a person's `roleIds`. Creating or updating a member takes a `roleIds` array and a status, gated by `people:manage` (`apps/desktop/src/renderer/src/enterprise/EnterpriseProvider.tsx:79-80`; store `orgStore.ts:283-314`; channel gate `authzGate.ts:97-99`). Suspending a member (status → `suspended`) immediately revokes all their effective permissions (Section 2.1).

---

## 6. Identity & Access (SSO / SCIM / MFA / Devices)

Cloud identity is configured in the **Cloud** section and surfaced read-only in the Admin **Identity & Access** tab. The backing store holds SSO connections, the SCIM config, and the MFA policy per tenant (`apps/desktop/src/main/cloud/identity/federationStore.ts`).

### 6.1 What is real

- **SSO configuration is a real surface.** You can create SAML/OIDC connections, set status/enforcement, edit allowed domains, and map attributes; connections persist atomically (`federationStore.ts:165-209`). A **fresh production install ships with no SSO configured** — an empty connection list with SCIM/MFA off is the honest default (the sample Okta/Entra connections appear **only when demo seeds are enabled**) (`federationStore.ts:61-108`).
- **SCIM provisioning** can be toggled on/off; its token is stored only as a **last-4 hint**, never in full (`federationStore.ts:211-225`).
- **MFA is a real org policy.** Set `required`, the allowed methods (`totp`, `webauthn`), and a grace period (default 7 days) per tenant (`federationStore.ts:237-249`).
- **Trusted devices are backend-backed.** Devices are registered and persisted in Postgres with a trust status of `trusted | blocked | revoked` (`apps/backend/src/devices/types.ts:11`, `apps/backend/src/devices/repository.ts:36`, `:49`). The Admin tab lists them and deep-links to Settings.

### 6.2 What is MODELED (read this carefully)

**SSO assertion validation is modeled, not a live IdP round-trip.** The federation engine deterministically checks issuer, audience/entity-id, allowed email domain, attribute mapping, and enforces the tenant MFA policy — but it performs **no cryptographic signature or JWKS verification** and does not call a live IdP (`apps/desktop/src/main/cloud/identity/federation.ts:1-10`, `:35-68`). The code is explicitly structured so "a real SAML/OIDC validator (signature + JWKS verification) drops in behind the same interface" (`federation.ts:8-9`). The UI states this in-line: *"SSO/SCIM are real config surfaces; identity assertion is modeled (deterministic checks), not a live IdP round-trip"* (`AdministrationView.tsx:354`).

**Practical implication:** treat SSO/SCIM/MFA here as fully functional **configuration and policy** surfaces, but do **not** rely on them as a production federation authority until the signature-verification seam is implemented.

### 6.3 Identity gaps

- **No "groups" entity** — SSO group claims are intended to map onto roles (`adminModel.ts:89`).
- **No "locations/sites" entity** — units are business-unit/department/team only (`adminModel.ts:90`).
- **No admin "list & revoke other users' sessions."** Only self sign-out exists; the backend has no list-or-revoke-others session API (`adminModel.ts:91`).

---

## 7. Governance & Compliance

The editable governance configuration for an org is `GovernanceConfig = { roles, approvalChains, complianceRules }` (`packages/shared/src/types/enterprise.ts:385-389`). Roles live in the org runtime; chains and rules live in the governance store; the composition root assembles them into one view.

### 7.1 Approval chains

Three chains are seeded and enabled by default (`apps/desktop/src/main/enterprise/governance/enterpriseGovernance.ts:19-62`):

| Chain | Applies to | Steps |
|---|---|---|
| **Side-effect approval** | any side-effecting AI worker action | Manager |
| **Governance change** | changes to policies/roles/rules | Admin → Owner |
| **Spend approval** | financial commitments | Manager → Owner |

You **enable/disable** each chain from **Enterprise → Customize → Approval chains** (`CustomizePanel.tsx:184-197`; store `apps/desktop/src/main/enterprise/governance/governanceStore.ts:118-126`, gated `governance:manage`).

> **Honest scope.** The Customize UI **toggles** the seeded chains on/off. Adding new chains, editing steps, or wiring new triggers (`org_structure_change`, `data_export` exist in the type at `enterprise.ts:314-315` but are not seeded) are not exposed in-app today.

### 7.2 Compliance rules and findings

Six deterministic rules are seeded (`enterpriseGovernance.ts:64-125`): side-effects-require-approval (critical), governed-actions-audited (critical), approval-chain-defined (warning), workforce-healthy (warning), members-assigned (warning), units-have-leaders (info). Each is evaluated over **live org + workforce state** and returns a finding with the evidence that drove it — no fabrication (`enterpriseGovernance.ts:153-214`). Toggle rules in **Customize → Compliance rules** (`CustomizePanel.tsx:199-212`; store `governanceStore.ts:128-136`).

### 7.3 AI worker governance runtime

Every proposed AI worker action runs through a four-check decision core that returns the **most restrictive** outcome (`deny > require_approval > allow`): permission (all touched scopes granted), trust (side-effecting/high-risk actions need trust ≥ a risk floor), evidence (side-effecting actions must be grounded), and declarative policy rules (`apps/desktop/src/main/workforce/governance/policyEngine.ts:1-68`). This is what "auto-execution is governance-controlled" means in the Admin AI tab (`AdministrationView.tsx:522`).

### 7.4 Marketplace org policy

An org-wide marketplace governance policy exists and is edited in **Marketplace → Governance** (gated `marketplace:manage`, audited). The real policy shape is `OrgMarketplacePolicy` (`packages/shared/src/types/marketplace.ts:112-124`): `requireApproval`, `allowedPublishers`, `blockedPublishers`, `blockedTypes`, `minPublisherTier`, `requireSignature`. The evaluator genuinely checks these before a governed install (`apps/desktop/src/main/marketplace/marketplaceModel.ts:292-319`; store `apps/desktop/src/main/marketplace/orgPolicyStore.ts`).

> **Honest gaps you must weigh:**
> - It is a **single global policy object**, not keyed per-org (`apps/desktop/src/main/marketplace/instance.ts`).
> - **Enforcement is bypassable:** the actual worker-install chokepoint (`workforce:install` → `WorkerInstallService.install`, `apps/desktop/src/main/workforce/install/installService.ts:107-132`) validates signature/checksum/namespace but does **not** consult the org marketplace policy — only the marketplace's own install path does.
> - **`require_approval` has no backing workflow** — it blocks with a message, with no approval queue to later unblock it (`apps/desktop/src/main/marketplace/marketplaceService.ts:168-170`).
> - The **allowed/blocked-publisher** lists have no editor UI (persisted/enforced but unreachable from the Governance tab).
> - There are **no spend/budget limits or category restrictions** in the model.

### 7.5 Compliance scorecard (SOC 2 / GDPR / ISO 27001)

The Admin **Compliance & Audit** tab shows a scorecard over six controls — SOC 2 (CC6.1, CC7.2), GDPR (Art. 32, Art. 17), ISO 27001 (A.9, A.12). Each status is **computed from live posture** (SSO enforcement / MFA requirement, audit activity, tenant-region residency), and the score is a weighted average (pass=100, warn=60, fail=0) (`apps/desktop/src/main/cloud/admin/admin.ts:51-107`).

> **Honest label.** This is a **computed readiness scorecard**, not a certification or an attestation. Use it to see which controls your current configuration satisfies (e.g. enforcing MFA flips ISO A.9 to pass), not as evidence of formal compliance.

---

## 8. Audit

Governed actions are recorded to an **append-only** organization audit trail. Each entry carries `{ actor, action, target, summary, workspaceId, at }` (`packages/shared/src/types/enterprise.ts:374-382`). The trail is **capped at 2,000 entries** — the oldest are trimmed once the cap is exceeded — and is read newest-first (`governanceStore.ts:18`, `:110-112`, `:138-145`). It is persisted to disk atomically.

Every enterprise mutation writes an entry: role create/update/delete, user changes, unit changes, workspace changes, governance toggles, and marketplace-policy edits all run with `audit: true` (e.g. `apps/desktop/src/main/enterprise/index.ts:660`, `:677`, `:688`). View the recent trail in the Admin **Compliance & Audit** tab (`AdministrationView.tsx:483-498`).

> **Honest gaps.** There is **no data-retention configuration** — the cap is fixed, not admin-settable — and **no risk register / threshold config** surface (`adminModel.ts:94-95`). Export of the full trail beyond the in-app view is not surfaced.

---

## 9. Licensing & Billing

Licensing and seats are surfaced in the Admin **Licensing** tab and edited/purchased in the **Commercial Center**. The commercial layer is a **read-only projection** of the real billing substrate — it assigns no seats, revokes no licenses, and never projects a card, token, or payment-provider id (`apps/desktop/src/main/commercial/commercialModel.ts:9-12`, `:305`).

- **Plans and packaging.** The seven-tier catalog (Free, Professional, Business, Enterprise, Government, Education, OEM) is **synthesized commercial packaging** over the three real underlying plan tiers — `free / pro / enterprise` (`commercialModel.ts:219-232`). The five deployment modes (Cloud SaaS, Private Cloud, Hybrid, On-Premises, Air-Gapped) are likewise synthesized over the current multi-tenant cloud posture (`commercialModel.ts:250-259`).
- **Seats.** Seat totals, used, available, and utilization are computed and displayed (`commercialModel.ts:286-307`). **Seats are displayed for administration but NOT enforced — there is no seat-cap gate** (`adminModel.ts:98`). Do not treat the seat count as a hard limit.
- **Checkout is real.** Subscription purchase/cancel runs through a live **Razorpay** gateway on the backend (`apps/backend/src/billing/razorpayGateway.ts:26-65`); it is lazily configured from env and the server boots cleanly even when billing is unconfigured (`razorpayGateway.ts:15-24`). Checkout flows through this existing billing engine — the commercial projection performs no charge itself.
- **Metering** reads **zero by default until there is real traffic** (`AdministrationView.tsx:571`; `commercialModel.ts:340-359`).

> **Honest gaps.** No seat enforcement (above); storage-usage metering is not wired to a live figure (`adminModel.ts:99`).

---

## 10. Connectors

The Admin **Connectors** tab is a lens over the connector registry, showing total/connected counts, connected accounts, and health (`AdministrationView.tsx:537-550`). A connector's **lifecycle is derived from whether a real data adapter is registered** — `production` connectors have a real adapter, `preview` connectors do not yet have a data adapter (`packages/shared/src/types/connectors.ts:229-233`; the tab labels these "real adapters" vs "no data adapter", `AdministrationView.tsx:544-545`). Manage connectors (OAuth, health, sync) in the **Connectors** section.

Security posture, stated in-app: connector **client credentials are environment-provisioned**, and **OAuth tokens are vaulted** — never exposed to the renderer (`AdministrationView.tsx:548`).

---

## 11. AI Workforce

The managed digital-worker roster ships with **27 built-in archetypes** (`apps/desktop/src/main/workforce/workers/index.ts:51-83`):

- **9 function workers** — Founder, Research, Engineering, Marketing, Sales, Finance, Legal, Operations, Support.
- **8 executive-tier** — CEO, COO, CTO, CFO, CIO, CISO, CDO, CCO.
- **8 infrastructure-tier** — Cloud, Platform, DevOps, Kubernetes, Database, Network, Security, SRE.
- **2 additional departments** — HR, Procurement.

Workers are folded into the org chart as `ai_worker` members on the team matching their role (`orgStore.ts:378-423`).

**Administering workers** (all gated by `workforce:manage`): install, update, enable, disable, rollback, and uninstall installable worker packages from the **AI Workforce** section (`apps/desktop/src/main/workforce/index.ts:241-280`). A marketplace worker install routes through the same install service (the marketplace policy is evaluated first on that path) (`workforce/index.ts:102-105`). Worker actions at runtime are constrained by the governance decision core in Section 7.3, and auto-execution is derived from your governance approval policies (`AdministrationView.tsx:522-526`).

---

## 12. Known Admin Gaps (read before committing)

These are recorded honestly in-product and surfaced in the Administration workspace's "Administrative gaps" panels (`adminModel.ts:88-103`). None of them is fabricated as a working control.

| Area | Gap | Reality |
|---|---|---|
| Identity | **Groups** | No group entity; SSO group claims are meant to map to roles (`adminModel.ts:89`). |
| Identity | **Locations / sites** | No location entity; units are BU/dept/team only (`adminModel.ts:90`). |
| Identity | **Admin session list & revoke** | Only self sign-out; no list/revoke-others API (`adminModel.ts:91`). |
| Identity | **SSO signature verification** | Assertion validation is **modeled** — issuer/audience/domain/attribute checks only, no signature/JWKS verification (`federation.ts:1-10`). |
| Security | **General secrets store** | Token vaults are internal, main-process-only, never exposed to IPC (`adminModel.ts:92`). |
| Security | **TLS / mTLS certificate store** | Only build code-signing status is surfaced (`adminModel.ts:93`). |
| Compliance | **Data-retention config** | Audit cap is fixed (2,000); no retention setting (`adminModel.ts:94`, `governanceStore.ts:18`). |
| Compliance | **Risk register / thresholds** | No admin risk-config surface (`adminModel.ts:95`). |
| Governance | **Marketplace policy enforcement** | Editable + evaluated, but the real worker-install path bypasses it, and `require_approval` has no backing workflow (Section 7.4). |
| AI | **AI cost / token budgets** | Usage tracked in-memory only; no persisted budget/threshold (`adminModel.ts:96`). |
| AI | **AI provider & model config** | Environment/code-defined; shown read-only, never a settable control (`adminModel.ts:97`). |
| Licensing | **Seat enforcement** | Seats displayed, not enforced (no seat-cap gate) (`adminModel.ts:98`). |
| Licensing | **Storage-usage metering** | Reader exists but is not wired to a live figure (`adminModel.ts:99`). |
| Configuration | **Notification delivery prefs** | Store exists but is not surfaced by any IPC channel (`adminModel.ts:100`). |
| Configuration | **Org branding / white-label** | No org branding/logo/white-label store; app theme is personal, not org-level (`adminModel.ts:101`, `CustomizePanel.tsx:123`). |
| Configuration | **Org defaults** | No organization-defaults store (`adminModel.ts:102`). |
| Ecosystem | **Partner records** | The partner directory is a **demo-only fixture**; NeuroPause ships no partner-records product (`apps/desktop/src/renderer/src/platformEcosystem/partnersModel.ts:4-6`). |

---

### Appendix — Primary source map

| Concern | File |
|---|---|
| Cloud tenancy service / rules | `apps/backend/src/organizations/service.ts` |
| Row-scoped isolation (Postgres) | `apps/backend/src/organizations/repository.ts` |
| 57-scope permission model | `packages/shared/src/types/enterprise.ts:72-215` |
| RBAC resolver | `apps/desktop/src/main/enterprise/authz.ts` |
| RBAC gate + root-of-trust guards | `apps/desktop/src/main/enterprise/authzGate.ts` |
| Built-in roles + org seed | `apps/desktop/src/main/enterprise/org/seed.ts` |
| Org runtime store (units/users/roles) | `apps/desktop/src/main/enterprise/org/orgStore.ts` |
| Administration workspace (read-only lens) | `apps/desktop/src/renderer/src/administration/AdministrationView.tsx` |
| Admin gaps catalog | `apps/desktop/src/renderer/src/administration/adminModel.ts` |
| Governance engine (chains + rules) | `apps/desktop/src/main/enterprise/governance/enterpriseGovernance.ts` |
| Governance store + audit cap (2000) | `apps/desktop/src/main/enterprise/governance/governanceStore.ts` |
| Governance editor UI | `apps/desktop/src/renderer/src/enterprise/CustomizePanel.tsx` |
| Identity store (SSO/SCIM/MFA) | `apps/desktop/src/main/cloud/identity/federationStore.ts` |
| SSO assertion engine (modeled) | `apps/desktop/src/main/cloud/identity/federation.ts` |
| Compliance scorecard (SOC2/GDPR/ISO) | `apps/desktop/src/main/cloud/admin/admin.ts` |
| Commercial projection (licensing/seats) | `apps/desktop/src/main/commercial/commercialModel.ts` |
| Razorpay billing gateway | `apps/backend/src/billing/razorpayGateway.ts` |
| Worker governance decision core | `apps/desktop/src/main/workforce/governance/policyEngine.ts` |
| Built-in workforce (27 archetypes) | `apps/desktop/src/main/workforce/workers/index.ts` |
