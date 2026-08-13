# NeuroPause — Pilot Acceptance Criteria

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilot leads, evaluators, IT
>
> Measurable criteria for a NeuroPause pilot. Each has an ID, description, test, expected result, evidence, and an **honest current status**. Status is stated to the current environment: several items are **VERIFIED** by the automated gate or Phase-3 certification; GUI-bound items are **PENDING GUI** (a human task on macOS); provider-bound items are **EXTERNAL DEP**.

**Status legend:** `VERIFIED (gate)` automated tests · `VERIFIED (Phase 3)` real backend certification · `PENDING GUI` needs on-device GUI verification (macOS) · `EXTERNAL DEP` needs an operator-configured provider · `OPERATOR` needs an operator credential/action · `PREVIEW` seeded/in-memory.

## A. Installation
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| INS-1 | App installs on macOS (Apple Silicon) | Download artifact, install, launch | App launches; Gatekeeper accepts a signed/notarized build | electron-builder dmg/zip configured (`electron-builder.yml`) | PENDING GUI · OPERATOR (signing) |
| INS-2 | First launch produces runtime logs | Launch, generate support bundle | `logs/app.log` present in bundle | Phase-8 rotating log; `SupportGenerateBundle` | PENDING GUI |
| INS-3 | Uninstall is clean | Remove app | No orphaned background processes | electron-builder NSIS/DMG defaults | PENDING GUI |

## B. Authentication
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| AUTH-1 | Email/password sign-in | Valid creds → shell | Session established (JWT) | `auth` tests; Phase-3 auth cert | VERIFIED (Phase 3) · GUI PENDING |
| AUTH-2 | Invalid login rejected | Wrong creds | Rejected, no session | `auth` tests | VERIFIED (gate) |
| AUTH-3 | Refresh + session persistence | Restart app | Session restored via keychain-encrypted refresh token | `auth` + main-process token handling | VERIFIED (gate) · GUI PENDING |
| AUTH-4 | Logout clears credentials | Log out | Token removed from keychain | keychain/`safeStorage` path | PENDING GUI |
| AUTH-5 | OAuth (GitHub / Microsoft Entra) | Social sign-in | Provider round-trip | PKCE providers implemented | EXTERNAL DEP (provider registration) |

## C. Navigation & first-run
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| NAV-1 | Sidebar groups are coherent | Open shell | Today / Business / Advanced legible; no duplicate/competing names | `shell/sections.test.ts` nav-lock (34 tests); Phase-2 | VERIFIED (gate) · GUI PENDING |
| NAV-2 | Command Palette reaches every surface | ⌘K → jump | Any surface reachable | palette tests | VERIFIED (gate) · GUI PENDING |
| NAV-3 | New user understands where to start | First-run | Today/Work Hub obvious; help links resolve | Phase-4 docs; 38/38 validate | PENDING GUI |

## D. Core business workflows (local-first)
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| ERP-1 | Create/reopen a record persists locally | Create → restart → reopen | Record intact on device | `enterprise/framework` tests (~32); atomic JSON store | VERIFIED (gate) · GUI PENDING |
| ERP-2 | Finance representative journey | Create/update/view a financial record | Correct state + GL effect | finance tests (~192) | VERIFIED (gate) · GUI PENDING |
| ERP-3 | CRM lead→opportunity | Progress a customer | State transitions persist | crm tests | VERIFIED (gate) · GUI PENDING |
| ERP-4 | HR privacy gating | Non-manager opens HR | Read/manage restricted to Manager/Admin | hr tests (~83); RBAC | VERIFIED (gate) · GUI PENDING |
| ERP-5 | Procurement approval chain | Request→approval→PO | Budget/contract-gated state | procurement tests | VERIFIED (gate) · GUI PENDING |
| ERP-6 | Inventory movement | Item→movement→qty | Ledger updates | inventory/warehouse tests | VERIFIED (gate) · GUI PENDING |
| ERP-7 | No data loss on normal restart | Restart repeatedly | All stores intact | Phase-8 backup registry + envelope | VERIFIED (gate) · GUI PENDING |

## E. AI Workforce & Automation
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| AI-1 | Governed action lifecycle | Run one action | intent→governance→permission→execution→evidence; evidence trail left | workforce tests (~219) | VERIFIED (gate) · GUI PENDING |
| AI-2 | Live AI with a provider | Configure provider, run | Real result | provider integration | EXTERNAL DEP (AI provider) |
| AI-3 | Honest fallback without a provider | No provider | Deterministic fallback, no fake result | workforce executor | VERIFIED (gate) |
| AUTO-1 | Automation produces a real effect | Run reminder/save-memory | Actual effect or honest failure (never fake ok) | automation engine tests | VERIFIED (gate) · GUI PENDING |

## F. Knowledge
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| KN-1 | Save to AI Memory, retrieve | Save → search | Retrieved via lexical search | memory tests (~235) | VERIFIED (gate) · GUI PENDING |
| KN-2 | Semantic ranking | Enable Qdrant+embeddings | Improved ranking; degrades to lexical if absent | `resilientSemanticSearch`; backend semantic tests (~102) | EXTERNAL DEP (Qdrant+embeddings) |

## G. Operations
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| OPS-1 | Honest status | Load Operations with/without data | "Live" only when data loaded; degraded/empty truthful | operationsPlatform tests; Phase-1 | VERIFIED (gate) · GUI PENDING |

## H. Industry & Marketplace
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| IND-1 | Select a vertical pack | Open Industry Center | Pack catalog + selection (Preview) | industry tests | PREVIEW · GUI PENDING |
| MKT-1 | AI Store catalog | Browse/install | Catalog served; worker install path | backend store tests; marketplace tests | VERIFIED (gate, catalog) · install worker-only |

## I. Security
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| SEC-1 | Tenant isolation | Cross-tenant access | Not-found; no leakage | Phase-3 tenancy cert | VERIFIED (Phase 3) |
| SEC-2 | Passwords hashed | Inspect | argon2, never plaintext | `passwords.ts` (`@node-rs/argon2`) | VERIFIED (gate) |
| SEC-3 | Refresh token encrypted | Inspect | Keychain (`safeStorage`); refuses plaintext | main-process token handling | VERIFIED (code) · GUI PENDING |
| SEC-4 | No secrets in logs/responses | Trigger errors | `requestId` only, values redacted | error-handler tests | VERIFIED (gate) |
| SEC-5 | Provider secrets rotated | Operator | Dotfile secrets rotated + moved to secret mgmt | see [Release Blockers](../product/RELEASE-BLOCKERS.md) | OPERATOR |

## J. Updates, Recovery, Documentation
| ID | Description | Test | Expected | Evidence | Status |
|---|---|---|---|---|---|
| UPD-1 | Update discovery→install→restart | Publish newer build to feed | Update applies; version verifies | electron-updater configured (`neuropause033.com/updates`, channel beta) | OPERATOR (feed hosting + signed build) |
| REC-1 | Recovery from unexpected quit | Kill + relaunch | Local data intact; corrupt store quarantined not reset | Phase-8 store envelope + quarantine | VERIFIED (gate) · GUI PENDING |
| DOC-1 | Documentation coherent & valid | `npm run docs:validate` | All governed docs pass | 38/38 clean | VERIFIED (gate) |

## Acceptance summary rule
A pilot is **accepted** when: all S1 criteria pass in the evaluator's environment; local-first ERP persistence (ERP-1/2/7), honest AI/Operations states (AI-3, OPS-1), tenant isolation (SEC-1), and documentation (DOC-1) are confirmed; and every remaining item is either PASS or an explicitly **accepted** EXTERNAL DEP / OPERATOR / PREVIEW item with an owner in the [Release Blockers](../product/RELEASE-BLOCKERS.md) register.

## Related
[Pilot Test Pack](PILOT-TEST-PACK.md) · [Pilot Support Runbook](PILOT-SUPPORT-RUNBOOK.md) · [Product Maturity Matrix](../product/PRODUCT-MATURITY-MATRIX.md) · [Release Blockers](../product/RELEASE-BLOCKERS.md)
