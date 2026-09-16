# SESSION 110 — FULL-STACK CONVERGENCE · CONNECTOR INVENTORY · H4 ABAC HARVEST

One coherent platform, action-oriented. **No package deleted/archived/excluded/deprecated · no second spine · no business-policy invented · no release work.** Baseline S109 GREEN (HEAD `3d54ea6`). `baseline.json` untouched.

**Headline:** H4 harvested — the **ABAC contextual-policy evaluator** is now live in the tree as a pure, deny-wins, fail-closed **evaluation/authoring capability** that **cannot replace, bypass, or generate authority** (proven adversarially). It does **not** change any live authorization decision; enforcement wiring is a separate **operator-decision + FG gate** (it changes authz semantics). Connector inventory + package activation matrix delivered to drive the next waves.

---

## 1–5. Census / packages inspected / live / activated / harvested
- **Packages inspected:** 46 (all of `packages/*`) + 4 apps, re-confirmed against HEAD. Live-wired into the running product: `@neuropause/shared`, `@neuropause/cst` (vendored, frozen), `@neuropause/companion-protocol`, `@neuropause/solution-packs` (desktop); `@neuropause/cloud-core`, `@neuropause/shared-cloud`, `@neuropause/runtime` (backend). **The other 39 remain unwired parallel-platform packages** (S106/S107 finding holds at HEAD).
- **Newly activated this session:** the ABAC evaluation capability (harvested from `packages/security`), landed in the live tree at `apps/desktop/src/main/security/abac.ts`.
- **Capabilities harvested to date:** H1 error-budget (S107) · H2 TrustModel (S108) · H3 event-log tamper-evidence (S109) · **H4 ABAC evaluator (S110)**.

## 6–8. Connector inventory (action-oriented)
The **live connector framework is canonical and mature** — one coherent system reachable through `connectors/index.ts:initConnectors()`: OAuth2 + PKCE engine (`oauthEngine.ts`, RFC-8252 loopback; client secret never leaves main), per-workspace encrypted token **vault** (`connectorVault.ts`, quarantine-not-reset), credential-scrubbing metadata store, inbound webhook verify+router (GitHub/Slack/Notion/MS-Graph, timing-safe), outbound webhook signing + **SSRF guard** + **durable retry/dead-letter** dispatcher (per-tenant principal), Slack Socket Mode (conditional), the **companion mobile gateway** (sealed X25519, per-device tenant binding), the entity bridge, and the connector runtime supervisor.
- **Already governed AI-tool-shaped (CST kernel, deny-by-default, at-most-once):** `mail.send` + the **M365 governed-action cohorts** (11 further write actions across mail/calendar/drive/teams/contacts via `cst/governedAction.ts` + `DurableIdempotencyStore`). This is meaningfully more than "mail.send only."
- **Residual ungoverned surface:** the M365 executor path (confirmation-gated, not CST) still carries write actions not yet in a cohort.
- **Connectors activated this session:** **0** — correctly. The 3 highest-value activations (widen CST cohorts to remaining M365 writes · surface verified inbound webhook events to the AI intake · wrap the durable outbound dispatcher as a governed "notify" tool) **each require a per-action consequence/reversibility classification — a product/business-policy decision this session must not invent** (STOP condition). They are queued as the next connector wave with their exact blockers.
- **Connector packages `connectors`/`integrations`/`enterprise-connectivity`/`integration-platform`/`connectivity`:** five unwired re-implementations of the live framework, each self-declaring PREVIEW/simulated/infra-pending. **Retirement candidates — NO ACTION.**

## 9. H4 ABAC result
- **Source reproduced** (`packages/security/src/policy.ts` `PolicyEngine`): typed conditions (`eq/ne/in/gt/lt/contains/exists`), **deny-wins** precedence, applicability by target + all-conditions, `evaluate`/`simulate`/`test`.
- **Compared to live** `enterprise/authz.ts` (RBAC = permission-union over active roles) + `runtimeAuthz` (fail-closed channel classification): **no live ABAC/contextual evaluator exists** — RBAC is role/permission only. Confirmed unique; RBAC untouched (its suite 10/10 green).
- **Harvested** (adapted, not imported — no `@neuropause/security`, dependency-free) to `apps/desktop/src/main/security/abac.ts`: `evaluatePolicies` (deny-wins), `conditionHolds`, `applicablePolicies`, `simulatePolicies`, `testPolicies`, `isAbacPermitted` (fail-closed: permit-only), and an in-memory versioned `AbacPolicySet` authoring workbench. **Evaluation-only** — returns an inert decision; nothing enforces it.
- **Smallest safe live integration = policy AUTHORING + SIMULATION + TESTING** (changes no live decision). **Enforcement** (a deny actually blocking, or a permit being required) **CHANGES authorization semantics** → deliberately NOT wired; see the gate below.

## 10. Security adversarial results (`abac.test.ts`, 11/11)
Every S110 §5 requirement proven: **tenant A cannot use tenant B attributes** (a tenant-scoped permit only matches its own tenant; other tenant → not-applicable → not permitted); **deny wins**; **forged attributes cannot elevate** (a permit is inert `{effect,reason,policyId}` — no permission/token/grant/role field, no callable); **missing attributes fail safe** (condition on absent attr → not-applicable → `isAbacPermitted` false); **`isAbacPermitted` fail-closed** (only explicit permit → true); **STRUCTURAL**: `abac.ts` has **zero imports** (no `enterprise/authz`/`runtimeAuthz`/`cst`/`commandBus`/`dispatchCommand`/`approvalEngine`/store) — so ABAC **cannot bypass RBAC/CST/approval/command-bus**, cannot be an AI permission-generator, and exposes no `enforce`/`grant` method a renderer could invoke. **S104 architecture-defeat 8/8 intact; live authority byte-identical** (no live authz file modified).

## 11. ERP/CRM/HR workflows advanced
None mutated this session (H4 was the named implementation slice). The connector inventory identifies the next end-to-end connector→governed-tool wave; the ERP cross-domain control planes remain certified (S94–S104). No workflow needed an invented policy this session; the connector activations that do are documented (§6–8), not invented.

## 12. AI capabilities advanced
ABAC is the substrate for future **L6 policy-governed execution**: a contextual policy layer that will (once enforcement is gated and operator-defined) sit inside the canonical RBAC+CST path as *RBAC ∧ ABAC ∧ CST ∧ approval* — never a second auth system, never AI-writable. S109 TrustModel remains advisory. No autonomous execution built; no agent runtime created.

## 13. Real-time capabilities advanced
Recorded, not built: the verified inbound-webhook event (already authenticated + tenant-scoped) is the natural real-time feed into the existing platform event bus → background intelligence → notification, reusing the S109 tamper-evident domain-event chain — no new event bus. Queued in the connector wave (needs an additive port from the inbound router; no policy question for the read-only path).

## 14. Persistence/event capabilities advanced
H3 (S109) is live. Remaining `packages/persistence` harvest candidates (upcaster, snapshot, migration) are SQL-engine features tied to PGlite — deliberately NOT harvested into the in-memory log (would be a second persistence spine); recorded for a future durable-events slice with its own decision gate.

## 15. UI surfaces connected
None this session — ABAC's only safe live surface (policy authoring/simulation UI) needs a frozen IPC channel + renderer, folded into the enforcement gate below. No isolated demo screen created.

## 16–17. Real-Electron / restart
N/A for a pure, stateless evaluator with no live consumer yet. When enforcement is gated + wired, its real-Electron proof (fresh profile, real authz decision unchanged for RBAC-only, ABAC deny observed, tenant isolation, restart) rides with that slice.

## 18. Full regression
ABAC 11/11 · live `security` + `enterprise/authz` 58/58 (RBAC unchanged) · **S104 8/8** · node typecheck exit 0 · eslint clean · gate-detector **PROCEED** on `abac.ts`. No live/frozen file modified ⇒ ERP/governance suites structurally unaffected (full main last measured 10545/7 at S109).

## 19. Frozen gates required
- **⛔ GATE (H4 enforcement) — operator decision + FG, PREPARED, NOT APPLIED.** To make ABAC *enforce*, three things are needed and this session provides none of them without you: (a) the **enforcement point** — where ABAC augments RBAC in the live authorization path (a semantics change; must be *RBAC permit ∧ ABAC-not-deny*, never ABAC-permit-alone, so ABAC can only ever *further restrict*, never grant); (b) the **actual policies** (contextual business rules — undefined business policy, yours to define, not mine to invent); (c) a **frozen IPC channel** (`packages/shared/channels.ts` + contracts) if an authoring/simulation UI is exposed. On your ruling I prepare the exact FG token + diff and wire *restrict-only* enforcement behind it. **No token guessed; nothing frozen touched.**

## 20. Business-policy decisions required
- The ABAC enforcement point + the policy content (§19a/b).
- Per-action consequence/reversibility classification for the 3 connector activations (§6–8).
Both are documented, not invented.

## 21. Retirement candidates — NO ACTION TAKEN
S107 list unchanged; **added, no action:** the five connector packages (`connectors`, `integrations`, `enterprise-connectivity`, `integration-platform`, `connectivity`) are duplicate re-implementations of the live connector framework — retirement candidates pending operator approval. `packages/security` **stays** (still a harvest source: H5 Ed25519, H6 envelope encryption). Nothing deleted/archived/excluded/deprecated.

## 22. Remaining package/capability backlog
Harvest: **H5** Ed25519 audit-chain signing (closes the documented forgery gap) · **H6** envelope encryption/rotation (`security/keys.ts`) · **H7** ordered-step orchestrator w/ rollback (design note first) · **H8** decision-quality checklist (`ckdl/analysis.ts`). Connector wave: 3 activations (policy-gated). Real-time: inbound-webhook → event-bus port. ABAC: enforcement gate (operator).

## 23. Exact commits
- `<this>` — `feat(s110-h4): ABAC contextual-policy evaluator harvest (pure, adversarial, enforcement-gated) + S110 cert`.

## 24. Working-tree state
Only the pre-existing custody-protected `baseline.json` (M, untouched by me) + pre-existing untracked `.claude/` and two `source-update/*EVIDENCE.md`. No release/tag/notarize/dist change.

## 25. Recommended next implementation wave
1. **Operator ruling on the ABAC enforcement gate** (§19) → then wire *restrict-only* ABAC behind the FG + a policy-authoring UI.
2. **H5 Ed25519 audit-chain signing** — self-contained, closes a documented forgery gap, own slice.
3. **Connector wave**: with per-action classifications you provide, widen CST cohorts + expose inbound-webhook events as a read-only AI intake (no policy needed for the read path).

## STOP-condition check — none tripped
No security/authority bypass (ABAC proven non-authoritative; S104 8/8). No tenant-isolation failure (proven). No second auth/spine (evaluation-only, zero imports). No unauthorized frozen change. No undefined business policy invented (both flagged for you). No connector credential exposure / connector→ERP bypass (no connector activated). No AI→ERP mutation. No package deletion.
