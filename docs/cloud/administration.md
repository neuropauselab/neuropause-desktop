# Enterprise Administration

> `apps/desktop/src/main/cloud/admin/admin.ts` (pure)

The cross-tenant control plane: tenant administration, user management, usage,
billing, audit, and compliance.

## Outputs

- **AdminOverview** — tenant rows (tier, status, region, users, projects,
  monthly spend), the user list (source local/scim/sso + MFA), usage
  (API requests, sync ops, storage, active workers/users), and a billing rollup.
- **ComplianceReport** — six controls across SOC 2, GDPR, and ISO 27001, an
  overall score (`pass`=100 / `warn`=60 / `fail`=0, averaged), and a
  data-residency breakdown by region.

## Compliance controls

- **SOC 2 CC6.1** (logical access) — `pass` when SSO is enforced or MFA is
  required, else `warn`.
- **SOC 2 CC7.2** (monitoring & audit) — `pass`; audit logging is active across
  governance, gateway, and admin.
- **GDPR Art. 32** (encryption at rest) — `pass`; per-tenant namespace + key.
- **GDPR Art. 17** (right to erasure) — `warn`; tracked seam.
- **ISO 27001 A.9** (access management) — `pass` when MFA is required.
- **ISO 27001 A.12** (data residency) — `pass`; tenants pinned to regions with
  declared residency.

## Data sources

Built purely from the live control plane: tenants + isolation from tenancy, home
users from the organization runtime, identity posture from the federation store,
API volume from the gateway, sync operations from the sync store, and active
workers from the workforce registry. The **home tenant's billing is real** (the
licensed subscription); demo-tenant spend is tier-based synthetic.

## Seam

A read-only rollup. The only synthetic inputs are demo-tenant user counts (from
object volume) and demo-tenant billing (from tier); everything for the home
tenant is real. Right-to-erasure is reported as `warn` rather than claimed.
