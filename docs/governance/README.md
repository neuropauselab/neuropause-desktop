# NeuroPause — Product Evolution & Release Governance Program (PERG)

The **official governance manual for how NeuroPause evolves after GA** — product
decisions, release/version policy, prioritization, technical debt, roadmap,
architecture stewardship, and long-term vision. Every process is **actionable** and
**evidence-based**; every item carries one label: **Implemented · Validated ·
Proposed · Future Vision**.

> **No GA declared. No release beyond `1.0.0-rc.1`. No customer, no production
> fleet.** PERG governs the real backlog and activates at GA. No fabricated
> customers, feedback, metrics, budgets, roadmap progress, or dates. The debt and
> risk registers are the real GA matrices; the roadmap is seeded only with the real
> seven open items.

Final synthesis: [`../../PRODUCT-GOVERNANCE-REPORT.md`](../../PRODUCT-GOVERNANCE-REPORT.md).

## By governance role

| You govern…              | Read                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| Product direction        | [Product Strategy](PRODUCT-STRATEGY.md), [Future Vision](FUTURE-VISION.md)       |
| Releases & versions      | [Release Governance](RELEASE-GOVERNANCE.md)                                      |
| What to build next       | [Prioritization](PRIORITIZATION.md), [Roadmap Governance](ROADMAP-GOVERNANCE.md) |
| Technical debt           | [Technical Debt Governance](TECHNICAL-DEBT-GOVERNANCE.md)                        |
| Research & experiments   | [Innovation Management](INNOVATION-MANAGEMENT.md)                                |
| Product measurement      | [Product Analytics](PRODUCT-ANALYTICS.md)                                        |
| Risk                     | [Risk Governance](RISK-GOVERNANCE.md)                                            |
| Architecture & contracts | [Architecture Stewardship](ARCHITECTURE-STEWARDSHIP.md)                          |
| Portfolio & investment   | [Executive Governance](EXECUTIVE-GOVERNANCE.md)                                  |

## The program

| Area                                                            | Document                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| Authoring anchor (four-way split + real registers)              | [_grounding.md](_grounding.md)                               |
| Governance matrices (Evolution / Readiness / Debt / Dependency) | [GOVERNANCE-MATRICES.md](GOVERNANCE-MATRICES.md)             |
| Product strategy                                                | [PRODUCT-STRATEGY.md](PRODUCT-STRATEGY.md)                   |
| Release governance                                              | [RELEASE-GOVERNANCE.md](RELEASE-GOVERNANCE.md)               |
| Evidence-based prioritization                                   | [PRIORITIZATION.md](PRIORITIZATION.md)                       |
| Technical debt governance                                       | [TECHNICAL-DEBT-GOVERNANCE.md](TECHNICAL-DEBT-GOVERNANCE.md) |
| Roadmap governance                                              | [ROADMAP-GOVERNANCE.md](ROADMAP-GOVERNANCE.md)               |
| Innovation management                                           | [INNOVATION-MANAGEMENT.md](INNOVATION-MANAGEMENT.md)         |
| Product analytics                                               | [PRODUCT-ANALYTICS.md](PRODUCT-ANALYTICS.md)                 |
| Risk governance                                                 | [RISK-GOVERNANCE.md](RISK-GOVERNANCE.md)                     |
| Architecture stewardship                                        | [ARCHITECTURE-STEWARDSHIP.md](ARCHITECTURE-STEWARDSHIP.md)   |
| Executive governance                                            | [EXECUTIVE-GOVERNANCE.md](EXECUTIVE-GOVERNANCE.md)           |
| Future vision (1.x / 2.x)                                       | [FUTURE-VISION.md](FUTURE-VISION.md)                         |

## The governed registers (real)

The technical-debt register is the GA report's **TD-1…TD-10** (Apple JWKS and
unsigned-install both High, down to FNV-1a Low); the risk register is **PR-1…PR-8**
(PR-8 already Eliminated via `SEED_STORE_ON_BOOT`). The near-term roadmap is the
**seven open items** sequenced by dependency wave. Breaking change is defined
against the real contracts: 604 IPC channels, the SDK resources, the `v1|v2` HTTP
API, and forward-only migrations. Source: [`../../ENTERPRISE-GA-REPORT.md`](../../ENTERPRISE-GA-REPORT.md).

## Honesty note

PERG defines **how** NeuroPause is governed after GA; it does not claim GA has
happened or a board is staffed. Every roadmap item carries its honest label, every
register is the real one, and 2.x is Future Vision — not a plan.
