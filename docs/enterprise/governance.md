# Enterprise Governance

> Organization-wide roles, permissions, approval chains, compliance rules, and an
> audit trail. Source: `apps/desktop/src/main/enterprise/governance/`.

## Layers

- **Roles & permissions** live in the Organization Runtime (`OrgRole`).
- **Policies** that gate individual worker actions live with the workforce
  (Phase 6). The Enterprise OS does not duplicate them.
- **Approval chains** and **compliance rules** are the new org-wide governance
  config, persisted here and seeded from engine defaults.
- **Audit trail** records org-level actions (unit/user/role edits, workspace
  changes, governance toggles) — distinct from, and complementary to, the
  workforce's per-action audit.

`enterprise:governance.config` returns all three (`roles`, `approvalChains`,
`complianceRules`) as one `GovernanceConfig`.

## Approval chains

Multi-step routing by role for a trigger (`workforce_side_effect`,
`governance_change`, `spend`, …). Defaults: side-effect approval (manager),
governance change (admin → owner), spend (manager → owner). Toggle with
`enterprise:governance.setChain`.

## Compliance rules (deterministic)

Each rule names a `check` the engine evaluates against live state. Findings carry
a status (`pass`/`warn`/`fail`) and the **evidence** ids that drove them. A failed
`critical` rule is a `fail`; lower severities are a `warn`.

| Check | Passes when |
| --- | --- |
| `every_side_effect_approved` | no side-effecting proposal is awaiting a decision |
| `audit_trail_present` | workers haven't run, or decisions are recorded |
| `approval_chain_defined` | a side-effect approval chain is enabled |
| `no_unhealthy_workers` | no worker is unhealthy |
| `no_orphaned_members` | every person belongs to a unit |
| `every_unit_has_lead` | every unit has a lead (informational) |

`evaluateCompliance(rules, input)` is pure — no hidden state, fully tested per
check. `enterprise:governance.compliance` runs it on demand;
`enterprise:governance.setRule` toggles a rule; `enterprise:governance.audit`
returns recent audit entries.
