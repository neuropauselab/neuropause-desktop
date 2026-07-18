/**
 * Enterprise Administration Platform v1.0 — the admin model (pure data; no React, no I/O; tested).
 *
 * The Enterprise Administration center is a CONTROL-CENTER LENS over existing services — it composes the
 * already-real enterprise-org, governance, RBAC, audit, cloud identity (SSO/SCIM/MFA), device, developer-key,
 * connector, workforce, memory, license and commercial surfaces, and deep-links to their existing editors. It
 * creates NO runtime, identity platform, RBAC system, governance engine, or store, and duplicates no admin
 * system. This file only labels/tones/summarises that real data, and records — honestly — the administrative
 * capabilities the platform does NOT have in-app (so the center never fabricates them).
 */
import type {
  ComplianceStatus,
  DeviceTrustStatus,
  GovernanceConfig,
  OrgRole,
  OrgUnit,
  OrgUnitKind,
  ComplianceFinding,
  SigningState,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OpsTone } from '@renderer/operations/lib';

/* ── status → tone maps (reuse the ops tone system) ─────────────────────────── */

export function complianceStatusTone(s: ComplianceStatus): OpsTone {
  return s === 'pass' ? 'green' : s === 'warn' ? 'orange' : 'red';
}

export function deviceTrustTone(s: DeviceTrustStatus): OpsTone {
  return s === 'trusted' ? 'green' : s === 'blocked' ? 'red' : 'gray';
}

/**
 * Generic keyword tone for string state values whose unions vary (license state, worker health, connector
 * lifecycle, SSO/SCIM status). Honest and defensive: healthy/active → green, degraded/grace → orange,
 * critical/invalid/error → red, otherwise gray. Never invents a value.
 */
export function stateTone(raw: string | null | undefined): OpsTone {
  const s = (raw ?? '').toLowerCase();
  // Negative states are checked FIRST — they often contain a positive substring
  // ("invalid" ⊃ "valid", "disconnected" ⊃ "connected"), which must not read as green.
  if (/(critical|invalid|error|fail|offline|blocked|revoked|disconnected|expired)/.test(s)) return 'red';
  if (/(degrad|grace|warn|pending|preview|reauth|starting|invited)/.test(s)) return 'orange';
  if (/(healthy|active|valid|connected|ok|enabled|running|production|pass|trusted)/.test(s)) return 'green';
  return 'gray';
}

/** Short, human code-signing label (the Security tab shows only the label). */
export function signingLabel(s: SigningState): string {
  switch (s) {
    case 'signed-notarized':
      return 'Signed & notarized';
    case 'signed':
      return 'Signed';
    case 'unsigned':
      return 'Unsigned';
    case 'not-applicable':
      return 'N/A (dev)';
    default:
      return 'Unknown';
  }
}

export function unitKindLabel(kind: OrgUnitKind): string {
  return kind === 'business_unit' ? 'Business unit' : kind === 'department' ? 'Department' : 'Team';
}

export function unitKindLabelPlural(kind: OrgUnitKind): string {
  return kind === 'business_unit' ? 'Business units' : kind === 'department' ? 'Departments' : 'Teams';
}

/* ── the honest administrative-gap catalog (verified ABSENT in-app; never fabricated) ── */

export type AdminGapKind = 'not-in-app' | 'managed';
export interface AdminGap {
  area: string;
  capability: string;
  kind: AdminGapKind;
  reason: string;
}

/**
 * Administrative capabilities the platform does NOT surface as settable in-app admin — each verified ABSENT
 * (or environment-managed) from source and cross-checked against the in-app capability registry. Shown as
 * honest, labeled rows (the Configuration Visibility Principle applied to administration).
 */
export const ADMIN_GAPS: AdminGap[] = [
  { area: 'Identity', capability: 'Groups', kind: 'not-in-app', reason: 'No group entity; org structure is business-unit / department / team, and SSO group claims map to roles.' },
  { area: 'Identity', capability: 'Locations / sites', kind: 'not-in-app', reason: 'The org model has no location entity — units are business-unit / department / team only.' },
  { area: 'Identity', capability: 'Admin session list & revoke', kind: 'not-in-app', reason: 'Only self sign-out exists; the backend has no list-or-revoke-others session API.' },
  { area: 'Security', capability: 'General secrets store', kind: 'not-in-app', reason: 'Token vaults are internal (encrypted, main-process only) and never exposed to IPC by design.' },
  { area: 'Security', capability: 'TLS / mTLS certificate store', kind: 'not-in-app', reason: 'Only build code-signing status is surfaced; no managed TLS certificate store exists.' },
  { area: 'Compliance', capability: 'Data-retention policy config', kind: 'not-in-app', reason: 'Audit trails use fixed caps; there is no retention configuration surface.' },
  { area: 'Compliance', capability: 'Risk register / thresholds', kind: 'not-in-app', reason: 'No risk-config surface; the Trust Engine scores business entities, not an admin risk register.' },
  { area: 'AI', capability: 'AI cost / token budgets', kind: 'not-in-app', reason: 'AI usage is tracked in-memory only; there is no persisted budget or threshold config.' },
  { area: 'AI', capability: 'AI provider & model config', kind: 'managed', reason: 'Environment / code-defined; shown read-only, never as a settable admin control.' },
  { area: 'Licensing', capability: 'Seat enforcement', kind: 'not-in-app', reason: 'Seats are displayed for administration but not enforced (no seat-cap gate).' },
  { area: 'Licensing', capability: 'Storage usage metering', kind: 'not-in-app', reason: 'A directory-size reader exists but is not wired to a live figure or an IPC channel.' },
  { area: 'Configuration', capability: 'Notification delivery preferences', kind: 'not-in-app', reason: 'A delivery-preference store exists but is not surfaced by any IPC channel.' },
  { area: 'Configuration', capability: 'Org branding / white-label', kind: 'not-in-app', reason: 'No org branding, logo, or white-label store exists (app theme is personal, not org-level).' },
  { area: 'Configuration', capability: 'Org defaults', kind: 'not-in-app', reason: 'No organization-defaults configuration store exists.' },
];

export function adminGapKindMeta(k: AdminGapKind): { label: string; tone: OpsTone; icon: IconName } {
  return k === 'managed'
    ? { label: 'Managed / env', tone: 'blue', icon: 'lock' }
    : { label: 'Not in-app', tone: 'gray', icon: 'info' };
}

/* ── pure summaries over the real admin data ────────────────────────────────── */

export interface UnitSummary {
  businessUnits: number;
  departments: number;
  teams: number;
  total: number;
}

export function summarizeUnits(units: OrgUnit[]): UnitSummary {
  const businessUnits = units.filter((u) => u.kind === 'business_unit').length;
  const departments = units.filter((u) => u.kind === 'department').length;
  const teams = units.filter((u) => u.kind === 'team').length;
  return { businessUnits, departments, teams, total: units.length };
}

export interface RoleSummary {
  total: number;
  builtIn: number;
  custom: number;
}

export function summarizeRoles(roles: OrgRole[]): RoleSummary {
  const builtIn = roles.filter((r) => r.builtIn).length;
  return { total: roles.length, builtIn, custom: roles.length - builtIn };
}

export interface GovernanceSummary {
  chains: number;
  chainsEnabled: number;
  rules: number;
  rulesEnabled: number;
}

export function summarizeGovernance(cfg: GovernanceConfig | null): GovernanceSummary {
  if (!cfg) return { chains: 0, chainsEnabled: 0, rules: 0, rulesEnabled: 0 };
  return {
    chains: cfg.approvalChains.length,
    chainsEnabled: cfg.approvalChains.filter((c) => c.enabled).length,
    rules: cfg.complianceRules.length,
    rulesEnabled: cfg.complianceRules.filter((r) => r.enabled).length,
  };
}

export interface ComplianceSummary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  /** Overall tone: red if any fail, orange if any warn, green otherwise (gray when empty). */
  tone: OpsTone;
}

export function summarizeCompliance(findings: ComplianceFinding[]): ComplianceSummary {
  const pass = findings.filter((f) => f.status === 'pass').length;
  const warn = findings.filter((f) => f.status === 'warn').length;
  const fail = findings.filter((f) => f.status === 'fail').length;
  const tone: OpsTone = findings.length === 0 ? 'gray' : fail > 0 ? 'red' : warn > 0 ? 'orange' : 'green';
  return { total: findings.length, pass, warn, fail, tone };
}
