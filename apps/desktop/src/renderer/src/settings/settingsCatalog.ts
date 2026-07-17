/**
 * Constitutional Settings v1.0 — the settings catalog (pure data; no React, no I/O; unit-tested).
 *
 * This is the CONSTITUTION's index. It does NOT own any configuration — every entry points at a real
 * existing production surface. It encodes the Configuration Visibility Principle for every capability:
 *
 *   - EDITABLE    — a real read + a real mutator exist and the user may change it here.
 *   - MANAGED     — the value is real but governed elsewhere (org policy, another runtime, the environment);
 *                   shown read-only with its source, never as a fake control.
 *   - UNAVAILABLE — the capability has no real production implementation; it is HIDDEN from the UI and only
 *                   listed in the Capabilities inventory (so we are honest about what does not exist yet).
 *
 * The search index and capability inventory below are the single source of truth the Settings shell renders.
 */
import type { IconName } from '@renderer/components/ui/Icon';
import type { SectionId } from '@renderer/shell/sections';
import { CAPABILITY_REGISTRY } from '@renderer/capability/capabilityRegistry';

export type VisibilityState = 'editable' | 'managed' | 'unavailable';

export type SettingsDomainId =
  | 'identity'
  | 'security'
  | 'governance'
  | 'privacy'
  | 'ai'
  | 'workspace'
  | 'organization'
  | 'integrations'
  | 'developer'
  | 'billing'
  | 'system'
  | 'capabilities';

export interface SettingsDomain {
  id: SettingsDomainId;
  label: string;
  icon: IconName;
  summary: string;
}

/** The constitutional domains (left-hand navigation). `capabilities` is the honesty ledger, pinned last. */
export const SETTINGS_DOMAINS: SettingsDomain[] = [
  { id: 'identity', label: 'Identity', icon: 'user', summary: 'Profile, organizations, roles, connected accounts' },
  { id: 'security', label: 'Security', icon: 'shield', summary: 'Two-factor policy, trusted devices, recovery' },
  { id: 'governance', label: 'Governance', icon: 'lock', summary: 'Approval policies, feature flags, compliance, audit' },
  { id: 'privacy', label: 'Privacy', icon: 'shield', summary: 'Telemetry, memory data, sharing, residency' },
  { id: 'ai', label: 'AI', icon: 'sparkles', summary: 'Provider, model, execution & approval policy' },
  { id: 'workspace', label: 'Workspace', icon: 'grid', summary: 'Appearance, scale, startup experience, layout' },
  { id: 'organization', label: 'Organization', icon: 'command', summary: 'Departments, teams, people, digital workers, licenses' },
  { id: 'integrations', label: 'Integrations', icon: 'globe', summary: 'Connectors, OAuth, webhooks' },
  { id: 'developer', label: 'Developer', icon: 'package', summary: 'API keys, OAuth apps, plugins, sandbox, logs' },
  { id: 'billing', label: 'Billing', icon: 'store', summary: 'Subscription, licenses, usage, invoices' },
  { id: 'system', label: 'System', icon: 'pulse', summary: 'Updates, backup, recovery, health, devices' },
  { id: 'capabilities', label: 'Capabilities', icon: 'analytics', summary: 'What is available, managed, or not yet built' },
];

/** A searchable, navigable setting. Every entry routes to a REAL production surface (section) or a domain. */
export interface SettingsSearchEntry {
  label: string;
  keywords: string[];
  domain: SettingsDomainId;
  state: Exclude<VisibilityState, 'unavailable'>; // unavailable items are not navigable; see inventory
  /** The real production section this setting manages/opens, if it lives in a dedicated center. */
  targetSection?: SectionId;
}

/**
 * The global search index. Natural-language queries ("enable claude", "change startup page", "audit
 * retention", "manage billing") match against label + keywords. Every result navigates to a real page.
 */
export const SETTINGS_SEARCH: SettingsSearchEntry[] = [
  { label: 'Profile', keywords: ['name', 'email', 'account', 'identity', 'who am i'], domain: 'identity', state: 'managed' },
  { label: 'Organizations & membership', keywords: ['org', 'organization', 'members', 'membership', 'invite', 'team'], domain: 'identity', state: 'editable', targetSection: 'organization' },
  { label: 'Roles & permissions', keywords: ['role', 'rbac', 'permission', 'access', 'admin'], domain: 'identity', state: 'editable', targetSection: 'enterprise' },
  { label: 'Connected accounts', keywords: ['connect', 'account', 'oauth', 'google', 'microsoft', 'github', 'slack', 'link'], domain: 'identity', state: 'editable', targetSection: 'connectors' },
  { label: 'Two-factor / MFA policy', keywords: ['2fa', 'mfa', 'two factor', 'multi factor', 'authenticator'], domain: 'security', state: 'managed', targetSection: 'cloud' },
  { label: 'Trusted devices', keywords: ['device', 'trusted', 'sessions', 'revoke device'], domain: 'security', state: 'editable' },
  { label: 'Recovery & safe mode', keywords: ['recovery', 'safe mode', 'repair', 'reset', 'restore'], domain: 'security', state: 'editable', targetSection: 'operations' },
  { label: 'Feature flags', keywords: ['flag', 'feature', 'toggle', 'rollout', 'policy'], domain: 'governance', state: 'editable' },
  { label: 'Approval policies', keywords: ['approval', 'chain', 'governance', 'policy', 'escalation', 'delegation'], domain: 'governance', state: 'editable', targetSection: 'enterprise' },
  { label: 'Compliance', keywords: ['compliance', 'soc2', 'gdpr', 'iso', 'framework', 'residency'], domain: 'governance', state: 'managed', targetSection: 'cloud' },
  { label: 'Audit trail', keywords: ['audit', 'log', 'history', 'who changed', 'trail'], domain: 'governance', state: 'managed', targetSection: 'enterprise' },
  { label: 'Telemetry & crash reports', keywords: ['telemetry', 'crash', 'diagnostics', 'opt in', 'privacy', 'analytics'], domain: 'privacy', state: 'editable' },
  { label: 'Memory data', keywords: ['memory', 'forget', 'remember', 'data', 'knowledge'], domain: 'privacy', state: 'editable', targetSection: 'memory' },
  { label: 'Data sharing', keywords: ['share', 'sharing', 'federation', 'cross org'], domain: 'privacy', state: 'editable', targetSection: 'federation' },
  { label: 'Data residency', keywords: ['residency', 'region', 'data location', 'sovereignty'], domain: 'privacy', state: 'managed', targetSection: 'cloud' },
  { label: 'AI provider & model', keywords: ['ai', 'claude', 'ollama', 'model', 'provider', 'llm', 'enable claude'], domain: 'ai', state: 'managed' },
  { label: 'Execution & approval policy', keywords: ['auto execution', 'automatic execution', 'auto exec', 'approval', 'autonomous'], domain: 'ai', state: 'managed', targetSection: 'auto-ops-center' },
  { label: 'Appearance', keywords: ['theme', 'dark', 'light', 'appearance', 'color'], domain: 'workspace', state: 'editable' },
  { label: 'Interface scale', keywords: ['scale', 'zoom', 'size', 'font', 'display'], domain: 'workspace', state: 'editable' },
  { label: 'Startup experience', keywords: ['startup', 'launch', 'default page', 'landing', 'home', 'open to', 'change startup page'], domain: 'workspace', state: 'editable' },
  { label: 'Departments, teams & people', keywords: ['department', 'team', 'employee', 'people', 'member', 'org chart'], domain: 'organization', state: 'editable', targetSection: 'enterprise' },
  { label: 'Digital workers', keywords: ['worker', 'ai worker', 'workforce', 'agent', 'roster'], domain: 'organization', state: 'managed', targetSection: 'workforce' },
  { label: 'Connectors', keywords: ['connector', 'integration', 'sync', 'github', 'slack', 'salesforce', 'notion'], domain: 'integrations', state: 'editable', targetSection: 'connectors' },
  { label: 'Webhooks', keywords: ['webhook', 'callback', 'event', 'egress'], domain: 'integrations', state: 'editable', targetSection: 'developer' },
  { label: 'API keys & OAuth apps', keywords: ['api key', 'oauth app', 'token', 'developer', 'sdk'], domain: 'developer', state: 'editable', targetSection: 'developer' },
  { label: 'Plugins & extensions', keywords: ['plugin', 'extension', 'addon'], domain: 'developer', state: 'editable', targetSection: 'developer' },
  { label: 'Sandbox', keywords: ['sandbox', 'test', 'validation', 'experiment'], domain: 'developer', state: 'editable', targetSection: 'sandbox' },
  { label: 'Subscription & plan', keywords: ['subscription', 'plan', 'upgrade', 'billing', 'pay', 'manage billing'], domain: 'billing', state: 'editable' },
  { label: 'Licenses', keywords: ['license', 'seat', 'entitlement'], domain: 'billing', state: 'managed' },
  { label: 'Usage & invoices', keywords: ['usage', 'invoice', 'metering', 'cost', 'consumption'], domain: 'billing', state: 'managed', targetSection: 'commercial-center' },
  { label: 'Updates & release channel', keywords: ['update', 'version', 'release', 'channel', 'upgrade app'], domain: 'system', state: 'editable' },
  { label: 'Backup & recovery', keywords: ['backup', 'restore', 'recovery', 'snapshot'], domain: 'system', state: 'editable', targetSection: 'operations' },
  { label: 'Runtime health', keywords: ['health', 'runtime', 'status', 'diagnostics', 'system'], domain: 'system', state: 'managed', targetSection: 'opscenter' },
  { label: 'Device management', keywords: ['device', 'manage devices', 'revoke'], domain: 'system', state: 'editable' },
];

/**
 * The capability inventory — the honesty ledger. MANAGED entries are real values governed elsewhere;
 * UNAVAILABLE entries have no production implementation and are therefore HIDDEN from the interactive UI.
 * This is what the Capabilities page renders, and what proves the Settings layer never fakes a control.
 */
export interface CapabilityEntry {
  domain: SettingsDomainId;
  capability: string;
  state: Exclude<VisibilityState, 'editable'>; // managed | unavailable
  /** For managed: where the value really comes from. For unavailable: why it is hidden. */
  reason: string;
}

/**
 * DERIVED from the single-source-of-truth Capability Registry — this file no longer defines capability
 * state. Every registry entry that is not a fully-editable production capability projects into the Settings
 * inventory: real-but-read-only entries (managed or read-only) show as "Managed"; everything not yet real
 * (needs-x, hidden, future) shows as "Unavailable". Correct by construction — if the registry changes, so
 * does this. (This is where the two former inaccuracies were fixed: infrastructure discovery is now Managed,
 * notification preferences are recorded as needs-ipc rather than "no store exists".)
 */
export const CAPABILITY_INVENTORY: CapabilityEntry[] = CAPABILITY_REGISTRY
  .filter((c) => c.state !== 'production-complete')
  .map((c) => ({
    domain: c.domain as SettingsDomainId,
    capability: c.label,
    state: c.state === 'managed' || c.state === 'read-only' ? 'managed' : 'unavailable',
    reason: c.note ?? 'Governed by the platform.',
  }));

/** Readiness summary over the whole constitution — how much is live vs. managed vs. not-yet-built. */
export interface SettingsReadiness {
  editable: number;
  managed: number;
  unavailable: number;
  total: number;
  /** Percent of surveyed capabilities that are real (editable + managed), rounded. */
  realPct: number;
}

export function computeReadiness(): SettingsReadiness {
  const editable = SETTINGS_SEARCH.filter((s) => s.state === 'editable').length;
  const managed = CAPABILITY_INVENTORY.filter((c) => c.state === 'managed').length;
  const unavailable = CAPABILITY_INVENTORY.filter((c) => c.state === 'unavailable').length;
  const total = editable + managed + unavailable;
  const realPct = total === 0 ? 0 : Math.round(((editable + managed) / total) * 100);
  return { editable, managed, unavailable, total, realPct };
}

/** Natural-language settings search. Matches label + keywords; returns navigable entries only. */
export function searchSettings(query: string): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  return SETTINGS_SEARCH.filter((e) => {
    const hay = `${e.label} ${e.keywords.join(' ')}`.toLowerCase();
    return tokens.every((t) => hay.includes(t)) || e.keywords.some((k) => q.includes(k));
  }).slice(0, 8);
}
