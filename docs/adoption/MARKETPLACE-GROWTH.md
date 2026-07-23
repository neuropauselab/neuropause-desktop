# NeuroPause — Marketplace Growth Program

> A GEAP **adoption-enablement** artifact: the **models, workflows, and methodologies**
> that let developers publish to, and organizations adopt from, the **existing**
> NeuroPause store and marketplace. It adds **no runtime, no package format, no PKI, and
> no new store** — every model maps to shipping code (`apps/backend/src/store/*`,
> `apps/desktop/src/main/{marketplace,nps,ecosystem}/*`).
>
> **Maturity:** Validated Release Candidate (`ENTERPRISE-VALIDATION-REPORT.md`).
> **License:** Proprietary (`LICENSE`) — so a **public** third-party publishing program
> is a **proposed** path, initially operated for internal and invited partner publishers.
>
> **Anti-fabrication (binding):** this document reports **no marketplace activity** — no
> app counts, install numbers, ratings, revenue, take-rate values, or top-charts. Numeric
> constants cited from code are **algorithm parameters**, never observed data. The
> ecosystem exchange ships an **empty production seed**, verified by
> `ecosystem/exchange/ecosystemProdSeed.test.ts` (packs and partners both seed to 0).
> Companions (`ADOPTION-MATRICES.md`): `DEVELOPER-ECOSYSTEM.md`, `PARTNER-ECOSYSTEM.md`,
> `BUSINESS-EXPANSION.md`.

---

## 1. Marketplace categories

Categorization exists at **two real layers**: a data-driven **editorial** surface and
**fixed type taxonomies** in code. Growth uses the editorial layer for merchandising and
the type layer for install routing.

**Editorial categories (curated).** `GET /store/categories` (`store/router.ts` →
`repository.listCategories`) returns each category with `slug`, `name`, `icon`,
`sort_order`, and an `appCount` = `count(a.id) FILTER (WHERE a.status = 'published')`.
Categories are **data**, not hard-coded, so this program defines a curation method, not a
fixed list: publishers propose via listing `category`; Marketplace Ops curate/merge into
`categories`; only `published` apps contribute to `appCount`; empty categories are retired
at a review cadence. The shipped seed uses `(Example)`-labelled categories
(`ecosystem/marketplace/seeds.ts`) — examples, not a live catalog.

**Type taxonomies (fixed, in code):**

| Taxonomy           | Source                                    | Members                                                                                                                                              |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| App type           | `store.ts` `AppType`                      | `web`, `desktop_plugin`, `electron`, `native`, `ai_agent`, `mcp_server`, `automation`                                                                |
| Listing kind       | `ecosystem.ts` `ListingKind`              | `ai_app`, `ai_worker`, `connector`, `plugin`, `automation_template`, `enterprise_template`                                                           |
| Package type (10)  | `marketplace.ts` `MarketplacePackageType` | `worker`, `connector`, `template`, `workflow_pack`, `knowledge_pack`, `automation_pack`, `dashboard_pack`, `policy_pack`, `blueprint`, `prompt_pack` |
| Install capability | `marketplace.ts` `InstallCapability`      | `installable`, `connect`, `import`, `catalog`                                                                                                        |

Listing kinds map to package types and to an **honest install capability** — what can
actually be installed today (`marketplaceModel.ts` `KIND_TO_TYPE` + `capabilityFor`):

| Listing kind          | → Package type    | → Capability  | Adoption today                           |
| --------------------- | ----------------- | ------------- | ---------------------------------------- |
| `ai_worker`           | `worker`          | `installable` | Routes to the real P8.5 worker installer |
| `connector`           | `connector`       | `connect`     | Deep-links the OAuth connect flow        |
| `automation_template` | `automation_pack` | `import`      | Governed-import seam                     |
| `enterprise_template` | `blueprint`       | `catalog`     | Browse + govern (no importer yet)        |
| `plugin` / `ai_app`   | `template`        | `catalog`     | Browse + govern (no importer yet)        |

**Action:** publish workers and connectors first — they have a real install/connect path;
catalog-only types are honest placeholders until an importer ships.

---

## 2. Publishing workflow (submit → sign → review → publish)

The pipeline is real and single-sourced in `ecosystem/marketplace/marketplaceStore.ts`,
driving the pure functions in `pipeline.ts`. The state machine (`ecosystem.ts`
`ListingStatus`) is `draft → scanning → signing → in_review → approved → published`, with
`rejected` and `rolled_back` branches.

| #   | Stage          | Method          | Transition                                                   |
| --- | -------------- | --------------- | ------------------------------------------------------------ |
| 1   | Create listing | `createListing` | → `draft` (slug, name, category, pricing, certified)         |
| 2   | Add version    | `addVersion`    | → `draft` (attaches a `ListingManifest` + changelog)         |
| 3   | Submit         | `submit`        | `draft/rejected/rolled_back → scanning`                      |
| 4   | Security scan  | `securityScan`  | `scanning →` fail ⇒ `rejected`, else `signing`               |
| 5   | Sign           | `signManifest`  | `signing → in_review` (Ed25519 over the canonical digest)    |
| 6   | Review         | `review`        | `in_review →` `approved` / `rejected` / `draft`              |
| 7   | Publish        | `publish`       | `approved → published` (sets `currentVersionId`)             |
| 8   | Rollback       | `rollback`      | `published → rolled_back` (restores prior published version) |

Every transition writes an audited `SubmissionEvent` (capped at 5000). A scan **`fail`
auto-rejects before signing** — the security gate precedes the cryptographic gate. On the
backend nothing is discoverable until `applications.status = 'published'` (search/section/
detail queries all filter it) and no artifact is served unless `releases.status =
'published'`.

**Publisher pre-submit checklist:** category set · manifest declares `entry` ·
least-privilege permissions · network domains declared if used · dependencies are registry
refs (no `..`, `/`, `file:`, `http:`) · changelog written · signing key registered with
Ops (§6).

---

## 3. Quality review (criteria checklist)

Review = an **automated static scan** (`pipeline.ts securityScan`, deterministic) plus a
**human decision** (`review` → approved / rejected / changes-requested-as-draft). The scan
rules are the real acceptance criteria:

| Rule                    | Severity | Trigger                                                                                                                          |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `entry.missing`         | critical | Manifest declares no entry point                                                                                                 |
| `permission.dangerous`  | high     | `system:exec`, `system:shell`, `fs:write:all`, `fs:read:all`, `secrets:read`, `credentials:read`, `network:raw`, `process:spawn` |
| `dependency.suspicious` | high     | Dependency ref contains `..` or starts with `/`, `file:`, `http:`                                                                |
| `network.undeclared`    | medium   | Network capability with no declared domains                                                                                      |
| `permission.excessive`  | low      | More than 8 permissions requested                                                                                                |
| `metadata.publisher`    | info     | No publisher declared in metadata                                                                                                |

**Scan verdict** (`SEVERITY_RANK`): `fail` if any finding ≥ high; `warn` if any ≥ low; else
`pass`. A `fail` blocks the pipeline automatically. Scanner id: `neuropause-static-scan/1`.

**Human reviewer checklist (on `warn`/`pass`):**

- [ ] Permissions match stated capability (each dangerous one justified); network domains and dependencies are specific and trusted
- [ ] Metadata, screenshots, and changelog are accurate; `certified` set only after a functional review (it raises trust — §6)
- [ ] Category and type taxonomy correct (drives discovery + routing); decision recorded with reviewer id + notes (`review()` writes a `ReviewRecord`)

**Action:** publish the scan rules and thresholds as a publisher pre-flight spec so defects
are fixed before submission.

---

## 4. Version lifecycle (versions, channels, releases)

Versioning spans `versions`, `releases`, `update_channels`, and `changelogs` (backend
`getVersions`), exercised by the desktop package service (`nps/packageService.ts`).

| Concept   | Source                                  | Meaning                                                                |
| --------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Version   | `versions` (`version`, `is_prerelease`) | Immutable semver record                                                |
| Channel   | `update_channels.slug`                  | Distribution track; install/download default `stable`                  |
| Release   | `releases` (`status='published'`)       | A version on a channel, with artifact + digest + signature             |
| Changelog | `changelogs` (`body`, `highlights[]`)   | Notes joined per version                                               |
| Artifact  | `ReleaseArtifact`                       | `url`, `sizeBytes`, `sha256`, `signature`, `signatureKeyId`, `isDelta` |

**Channels** (`marketplace.ts` `RELEASE_CHANNELS`): `stable`, `beta`, `canary`, `lts`;
`channelFor()` defaults `stable`. Recommend: pre-release on `beta`/`canary`, promote to
`stable`, offer `lts` for enterprise change-control. **Update detection**
(`service.checkUpdate`) compares dotted-numeric versions (`compareVersions`; prerelease
suffixes ignored) between the installed pin and the channel's latest; installs **pin**
`version_id` + `channel_id`, so updates are deterministic per channel.

**Lifecycle ops** (`nps/packageService.ts`, tracked with progress events): `install`
(resolve → permission check → download → SHA-256 integrity → signature → register);
`update` (re-install channel latest, preserving grants); `rollback` (swap
`installedVersion`/`packageHash` with the recorded previous pair); `repair` (re-verify,
reinstall a corrupt artifact); `verify` (re-hash against the pinned `packageHash`).

**Action:** require a changelog per version; use `beta → stable` promotion so enterprises
can pin `lts` and roll back deterministically.

---

## 5. Revenue model (framework over real tiers)

A **framework** over pricing structures that already exist in code. It makes **no revenue
claims** and states **no numbers**; the take-rate is a **proposed parameter**, unset.

| Surface                   | Source                              | Values                                                         |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| Listing price (store)     | `store.ts` `PricingKind`            | `free`, `freemium`, `paid`, `subscription`, `enterprise`       |
| Listing price (ecosystem) | `ecosystem.ts` `ListingPricing`     | model ∈ `free`/`one_time`/`subscription`; `amount`; `currency` |
| Platform plan (buyer)     | `billing/plans.ts`, `subscriptions` | `free`, `starter`, `professional`, `enterprise`                |

The platform tiers are the **real** commercial tiers (`RAZORPAY_PLAN_STARTER/PROFESSIONAL/
ENTERPRISE`; `billing/schemas.ts` plan enum) — subject of `BUSINESS-EXPANSION.md`.
Marketplace monetization layers on top.

**Proposed take-rate methodology (parameter, not a number):** let **τ** be the take-rate,
`0 ≤ τ < 1`, set by policy — **this document fixes no value for τ**. Publisher payout =
`gross × (1 − τ)`; platform share = `gross × τ`. τ **may** be tiered by publisher trust
(§6) or listing type as a governance decision. Settlement runs through the existing billing
provider (Razorpay); payouts are enabled only when `billingConfigured()` is true
(`RAZORPAY_KEY_ID` + secret present).

| Element             | Owner             | Status                              |
| ------------------- | ----------------- | ----------------------------------- |
| τ value / schedule  | Commercial policy | **Proposed parameter — unset**      |
| Free vs. paid split | Publisher         | Real field (`ListingPricing.model`) |
| Payout rail         | Platform          | Real (Razorpay), gated by config    |
| Buyer entitlement   | Platform plan     | Real tiers (`free`…`enterprise`)    |

**Action:** launch with `free`/`freemium` listings to seed supply; introduce τ only after a published, transparent schedule exists.

---

## 6. Trust model (Ed25519 signing + publisher verification + honest open item)

**Real cryptographic signing** (Ed25519 via Node `crypto`, two places): publisher-side
(`ecosystem/marketplace/pipeline.ts`) `canonicalManifest` (stable key order) →
`digestManifest` (SHA-256) → `signManifest` produces `PackageSignature
{algorithm:'ed25519', keyId, digest, signature, signedAt}`; `verifyManifest` re-derives and
verifies. Host-side (`nps/signature.ts`) `verifySignature(data, sigB64, keyId)` checks a
detached signature against a **trust store** (`keyId → public-key PEM`), returning `ok` ·
`no_signature` · `no_trusted_key` · `bad_signature` · `error`. Integrity is separately
enforced by `nps/integrity.ts verifyFileHash` (streamed SHA-256, `timingSafeEqual`).

**Publisher verification tiers** (`marketplaceModel.ts`; mirrored by backend
`developer_verifications` → card `isVerified`/`verifiedTier`):

| Tier         | Rule (`publisherTier`)                              | Base trust (`publisherTrust`) |
| ------------ | --------------------------------------------------- | ----------------------------- |
| `official`   | flagged official                                    | 0.95                          |
| `trusted`    | verified **and** installs ≥ 1000 _(code threshold)_ | 0.80                          |
| `verified`   | verified                                            | 0.60                          |
| `unverified` | default                                             | 0.20                          |

A registered signing `keyId` adds `+0.05`. **Package trust** (`packageTrust`) blends
signature/certification/scan with publisher trust — base `0.25`, `+0.35` signed, `+0.20`
certified, `+0.10` scan-pass, `−0.30` scan-fail, then `pkg×0.55 + publisherTrust×0.45`.
These are **algorithm weights**, not observed metrics. `TrustReport.certificate` is
`unsigned`, `valid`, or `untrusted`.

**Governed install — fail-closed vs. the honest open item.** Org governance
(`evaluatePolicy`, `OrgMarketplacePolicy`) is evaluated before install and **never
bypassed** (`marketplaceService.install`): it can `deny` (blocked publisher/type, below
min-tier, or `requireSignature` unmet — keyed on cryptographic **validity**, so a
present-but-invalid signature cannot satisfy it) or `require_approval`. Worker installs are
**fail-closed**: only an allowed, signed worker package routes to the real installer, and a
**present** signature that fails verification **throws** (`packageService.ts:184` —
`if (artifact.signature && !sig.verified) throw`).

> **Honest open item — unsigned install allowed when the trust store is empty.** The host
> `trustStore` (`signature.ts`) is **empty until a real signing pipeline registers public
> keys**. So: (1) an artifact shipped **without** a signature skips the guard at
> `packageService.ts:184` and **installs** (fail-open for unsigned); (2) a **signed**
> artifact whose `keyId` is not in the trust store returns `no_trusted_key` and **fails
> closed** (throws). Additionally the **default `OrgMarketplacePolicy` is permissive**
> (`requireSignature:false`, `minPublisherTier:'unverified'`, `requireApproval:false` —
> `orgPolicyStore.ts DEFAULT_ORG_POLICY`).

**Action (closes the gap operationally):** register publisher public keys via
`registerTrustedKey(keyId, pem)` before opening publishing · set `requireSignature: true`
(denies unsigned) · raise `minPublisherTier` and use `allowedPublishers` allowlists for
regulated tenants · gate "activate signed-artifact enforcement" in `RELEASE-CHECKLIST-GUIDE.md`.

---

## 7. Discovery model (categories · featured · collections · search)

Discovery is served by real, public endpoints (`store/router.ts`) — no sign-in required
(`optionalAuth` only personalizes):

| Surface          | Endpoint                   | Source                        | Model                                         |
| ---------------- | -------------------------- | ----------------------------- | --------------------------------------------- |
| Featured hero    | `GET /featured`            | `featured_apps`               | Active rows in a date window, `sort_order`    |
| Collection rails | `GET /collections`         | `collections` (`is_featured`) | `manual` (curated) or `auto` (rule → section) |
| Sections         | `GET /sections/:key`       | `SECTION_SQL`                 | 7 keys (below)                                |
| Search           | `GET /apps`                | `searchApps`                  | Full-text + filters + sort + pagination       |
| Detail           | `GET /apps/:slug`          | `getAppDetail`                | Card + screenshots + versions + reviews       |
| Taxonomy         | `GET /categories`, `/tags` | `listCategories`, `listTags`  | Counts from published apps                    |
| Recommendations  | `GET /me/recommendations`  | `recommendApps`               | Category-affinity, excludes owned             |

**Sections** (`store.ts` `STORE_SECTION_KEYS`): `trending`, `new`, `verified`, `enterprise`,
`open_source`, `staff_picks`, `recently_updated` — auto-collections reference these by rule
(`normalizeSectionKey`). **Search filters** (`schemas.ts`): `q` (websearch full-text over
`search_tsv` + name `ILIKE`), `category`, `tags`, `pricing`, `type`, `openSource`,
`verified`; sort ∈ `relevance/trending/installs/rating/newest/updated/name`; paginated
(`pageSize ≤ 60`).

**Action:** optimize discovery via accurate category + tags, a keyword-rich name/tagline
(feeds `search_tsv`), verification (unlocks the `verified` rail + filter), and correct
`enterprise`/`open_source` flags.

---

## 8. Ranking methodology (a proposed transparent method)

This defines a **method** — **not** tuned weights presented as live, and it reports **no
rankings**. It composes only **real signals** already in code:

| Signal         | Source                                                    | Backend sort key        |
| -------------- | --------------------------------------------------------- | ----------------------- |
| Text relevance | `ts_rank(search_tsv, websearch_to_tsquery)`               | relevance (with `q`)    |
| Trending score | `applications.trending_score` (opaque precomputed column) | `trending`, `relevance` |
| Install count  | `applications.install_count`                              | `installs`              |
| Review signal  | `app_ratings.rating_avg`, `rating_count`                  | `rating`                |
| Recency        | `first_published_at`, `latest_release_at`                 | `newest`, `updated`     |
| Trust          | `packageTrust` / `publisherTrust` (`marketplaceModel.ts`) | marketplace `trust`     |

The **only** explicit blend in code is the marketplace trending formula
(`marketplaceModel.ts trendScore`): `installs × 0.6 + rating × ratingCount × 0.4`. The
backend `trending_score` is an opaque precomputed column — this document does **not** invent
its recipe.

**Proposed composite:** `Score(app) = Σ wᵢ · normalize(signalᵢ)`

| signalᵢ        | Dir | Real source                                | Weight |
| -------------- | --- | ------------------------------------------ | ------ |
| Text relevance | ↑   | `ts_rank`                                  | wₜ     |
| Recency        | ↑   | `latest_release_at` / `first_published_at` | wᵣ     |
| Review quality | ↑   | `rating_avg`, damped by `rating_count`     | wq     |
| Trending       | ↑   | `trendScore` recipe above                  | wₙ     |
| Trust          | ↑   | `packageTrust`                             | wₖ     |
| Scan/safety    | ↑   | scan `pass`/`warn`                         | wₛ     |

Method rules (transparent, not a black box): (1) `normalize` is min-max or z-score per
signal over the candidate set — documented and deterministic; (2) weights `wᵢ` are
**governance-owned placeholders to be calibrated offline**, published on a
ranking-transparency page, never presented here as live values; (3) review count **damps,
not inflates** (Bayesian/`rating_count` damping), so a high average on few reviews cannot
outrank a proven listing; (4) trust and safety are ranking inputs, so unsigned/low-tier
listings sort below signed, verified ones; (5) **no pay-to-rank** — any paid placement is
labeled and separated from organic Score; (6) auditable — every input is a real column, so
any ranking is reproducible from stored signals.

**Action:** ship the signal list and normalization publicly first; calibrate weights on real (not fabricated) engagement once the marketplace has genuine activity.

---

## 9. Open items & growth actions

**Honest open items (do not overstate maturity):**

| Item                                              | State             | Where                                       |
| ------------------------------------------------- | ----------------- | ------------------------------------------- |
| Unsigned install when trust store empty           | Open (fail-open)  | `nps/signature.ts`, `packageService.ts:184` |
| Trust store unpopulated by default                | Open              | `signature.ts trustStore`                   |
| Default org policy permissive                     | Open              | `orgPolicyStore.ts DEFAULT_ORG_POLICY`      |
| Importers for `automation_pack` / `catalog` types | Not built         | `capabilityFor`                             |
| Ecosystem exchange production seed                | Empty (by design) | `ecosystemProdSeed.test.ts`                 |
| Public third-party publishing                     | Proposed only     | `LICENSE` (proprietary)                     |

**Sequenced growth plan (supply → trust → demand):** (1) open publishing to internal +
invited partners, shipping the §2 workflow and §3 scan spec as pre-flight; (2) harden trust
— register keys, set `requireSignature: true`, raise `minPublisherTier` (closes the §6 open
item); (3) prioritize installable types (`worker` + `connector`); (4) grow demand — curate
`featured`/`collections`, verify publishers, ship the §8 transparency page; (5) introduce
monetization last — publish a τ schedule (§5) only after transparent discovery + trust are
live. Enforcement and posture cross-refs: `docs/guides/RELEASE-CHECKLIST-GUIDE.md`,
`docs/guides/SECURITY-GUIDE.md`.
