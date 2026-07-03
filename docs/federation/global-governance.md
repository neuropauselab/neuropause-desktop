# Global Governance

Federation-wide governance: cross-organization policies, a deterministic
evaluation engine, delegated approvals, a shared audit trail, and compliance
rules. The guarantee is that **every federated action remains traceable**.

## Policies

A cross-org policy has a scope (`all` | `trusted` | `partner`), an effect
(`allow` | `deny` | `require_approval`), and an action it matches (e.g.
`cross_org_run`, `share_data`). Policies can be enabled or disabled.

Seeded policies: federated worker execution requires approval; partner data
exchange requires approval; public artifact publishing is allowed; untrusted
policy import is allowed only for trusted peers.

## Evaluation engine (pure, deterministic)

`evaluateFederatedAction` takes an action, the peer's trust level, and the
policy set, and returns a decision with the deciding policy. The rules:

- **Scope gating.** `all` applies to any peer; `trusted` applies only when the
  peer's trust is `verified` or `full`; `partner` applies in a partner context.
- **Most-restrictive-wins.** Among matching policies, a single `deny` overrides
  everything; otherwise any `require_approval` forces an approval; otherwise the
  action is allowed. With no matching policy, the action is allowed by default.

The engine is pure and unit-tested, so the same inputs always yield the same
decision — no hidden state, no model in the loop.

## Shared audit trail + delegated approvals

`recordAction` evaluates an action, appends an immutable audit entry (actor org,
peer org, action, decision, deciding policy, detail), and — when the decision is
`require_approval` — opens a **delegated approval**. Resolving an approval
appends a second audit entry. The audit trail is the single source of truth for
who did what across the federation.

## Compliance

`buildFedCompliance` produces five rules — shared audit trail, signed exchange
artifacts, peer trust attestation, cross-region residency, and delegated
approval review — each `pass` / `warn` / `fail`, scored to a single percentage.
The inputs are real (audit depth, whether all artifacts are signed, how many
active peers are attested, pending approvals).

## IPC

`fed:gov.*` — `policies`, `summary`, `approvals`, `audit`, `compliance`, plus
audited `addPolicy`, `setPolicyEnabled`, `resolveApproval`, and `recordAction`.
