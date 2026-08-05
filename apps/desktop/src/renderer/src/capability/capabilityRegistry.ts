/**
 * Capability Completion & Platform Maturity v1.0 — the Capability Registry (single source of truth).
 *
 * This is the ONE canonical record of what NeuroPause can actually do. It does not implement anything and it
 * duplicates no runtime state — it is the design-time ledger every capability-aware surface reads (the
 * Settings capability inventory derives from it; the connector lifecycle and navigation visibility reconcile
 * to it). Every entry is classified into exactly one honest state, and read-but-not-settable / not-yet-built
 * capabilities are recorded truthfully rather than faked. New capabilities are added here first.
 *
 * States (exactly one per capability):
 *   production-complete — real backend + persistence + authz + audit; fully usable.
 *   managed            — real value governed elsewhere (org policy / another runtime / environment); read-only.
 *   read-only          — a real projection with no mutator by design.
 *   needs-ipc          — full backing EXISTS but is not surfaced (would require a new IPC channel).
 *   needs-adapter      — framework exists but the data adapter does not (e.g. a connector).
 *   needs-backend      — requires a backend route/store that does not exist.
 *   hidden             — no real production implementation; hidden from the UI.
 *   future-release / deprecated / removed — roadmap / lifecycle bookkeeping.
 */

export type CapabilityState =
  | 'production-complete'
  | 'managed'
  | 'read-only'
  | 'needs-ipc'
  | 'needs-adapter'
  | 'needs-backend'
  | 'hidden'
  | 'future-release'
  | 'deprecated'
  | 'removed';

/** States that represent a real, user-facing capability (surfaced today). */
export const REAL_STATES: CapabilityState[] = ['production-complete', 'managed', 'read-only'];
/** States that are intentionally NOT surfaced as interactive controls. */
export const HIDDEN_STATES: CapabilityState[] = ['needs-ipc', 'needs-adapter', 'needs-backend', 'hidden', 'future-release', 'deprecated', 'removed'];

export type CapabilityDomain =
  | 'identity' | 'security' | 'governance' | 'privacy' | 'ai' | 'workspace'
  | 'organization' | 'integrations' | 'developer' | 'billing' | 'system' | 'platform'
  | 'business';

export interface Capability {
  /** Canonical, dotted id — the key every subsystem references. */
  id: string;
  label: string;
  domain: CapabilityDomain;
  /** The real runtime/service that backs (or would back) this capability. */
  runtime: string;
  state: CapabilityState;
  /** RBAC permission gating the capability's mutation, if any. */
  permission?: string;
  /** True when the capability's write is recorded in a real audit trail. */
  audited?: boolean;
  /** True when a real automated test covers it. */
  tested?: boolean;
  /** Managed: the governing source. Not-real states: what is missing / why hidden. */
  note?: string;
}

/**
 * The registry. Grouped by domain for readability; order is not significant (surfaces sort/filter).
 * Keep this the ONLY place capability state is defined.
 */
export const CAPABILITY_REGISTRY: Capability[] = [
  // ── Identity ──
  { id: 'identity.profile', label: 'Profile (name, email)', domain: 'identity', runtime: 'auth session / IdP', state: 'managed', note: 'Sourced from your authenticated account; edited at the identity provider.' },
  { id: 'identity.organizations', label: 'Organizations & membership', domain: 'identity', runtime: 'enterprise org (cloud)', state: 'production-complete', permission: 'org:manage', audited: true, tested: true },
  { id: 'identity.roles', label: 'Roles & permissions', domain: 'identity', runtime: 'enterprise governance', state: 'production-complete', permission: 'governance:manage', audited: true, tested: true },
  { id: 'identity.connected-accounts', label: 'Connected accounts', domain: 'identity', runtime: 'connector service', state: 'production-complete', permission: 'connectors:manage', audited: true, tested: true },
  { id: 'identity.neuroid', label: 'NeuroID / digital identity', domain: 'identity', runtime: '—', state: 'hidden', note: 'No such subsystem exists in production.' },

  // ── Security ──
  { id: 'security.mfa-policy', label: 'Two-factor (MFA) policy', domain: 'security', runtime: 'cloud identity', state: 'managed', permission: 'cloud:manage', audited: true, note: 'Organization-wide tenant policy, not personal enrollment.' },
  { id: 'security.devices', label: 'Trusted devices', domain: 'security', runtime: 'devices service (backend)', state: 'production-complete', permission: 'org:manage', tested: true },
  { id: 'security.recovery', label: 'Recovery & safe mode', domain: 'security', runtime: 'release-ops recovery', state: 'production-complete', permission: 'org:manage', audited: true, tested: true },
  { id: 'security.password-change', label: 'In-app password change', domain: 'security', runtime: 'backend auth', state: 'needs-backend', note: 'Only email/token reset exists; no authenticated change-password route.' },
  { id: 'security.passkeys', label: 'Passkeys / WebAuthn', domain: 'security', runtime: '—', state: 'needs-backend', note: 'No enrollment ceremony or credential store.' },
  { id: 'security.sessions', label: 'Session list & revoke', domain: 'security', runtime: 'backend auth', state: 'needs-backend', note: 'Only self sign-out; no list/revoke API.' },
  { id: 'security.login-history', label: 'Login history / security events', domain: 'security', runtime: '—', state: 'hidden', note: 'No real per-user event source.' },

  // ── Governance ──
  { id: 'governance.approval-chains', label: 'Approval chains', domain: 'governance', runtime: 'enterprise governance', state: 'production-complete', permission: 'governance:manage', audited: true, tested: true, note: 'Enable/disable (no create/delete).' },
  { id: 'governance.compliance-rules', label: 'Compliance rules', domain: 'governance', runtime: 'enterprise governance', state: 'production-complete', permission: 'governance:manage', audited: true, tested: true },
  { id: 'governance.feature-flags', label: 'Feature flags', domain: 'governance', runtime: 'feature-flag service', state: 'production-complete', permission: 'governance:manage', audited: true, tested: true },
  { id: 'governance.federation-policies', label: 'Federation policies & delegated approvals', domain: 'governance', runtime: 'federation governance', state: 'production-complete', permission: 'federation:manage', audited: true, tested: true },
  { id: 'governance.audit-trail', label: 'Audit trail', domain: 'governance', runtime: 'governance audit', state: 'read-only', permission: 'governance:read', note: 'Append-only by design.' },
  { id: 'governance.compliance-frameworks', label: 'Compliance frameworks (SOC 2 / GDPR / ISO)', domain: 'governance', runtime: 'cloud admin', state: 'read-only', permission: 'cloud:read', note: 'Computed scorecard.' },
  { id: 'governance.risk-thresholds', label: 'Risk thresholds / audit retention / escalation', domain: 'governance', runtime: '—', state: 'hidden', note: 'Code constants / fixed caps; no configuration surface.' },

  // ── Privacy ──
  { id: 'privacy.telemetry', label: 'Telemetry & crash reports', domain: 'privacy', runtime: 'release-ops crash reporter', state: 'production-complete', audited: true, tested: true },
  { id: 'privacy.memory-data', label: 'Memory data (review & forget)', domain: 'privacy', runtime: 'memory runtime', state: 'production-complete', permission: 'operations:manage', tested: true },
  { id: 'privacy.data-sharing', label: 'Data sharing (federation)', domain: 'privacy', runtime: 'federation runtime', state: 'production-complete', permission: 'federation:manage', audited: true },
  { id: 'privacy.residency', label: 'Data residency', domain: 'privacy', runtime: 'cloud tenancy', state: 'managed', permission: 'cloud:read', note: 'Set at tenant provisioning; read-only.' },
  { id: 'privacy.consent-retention', label: 'Consent, retention & account deletion', domain: 'privacy', runtime: '—', state: 'hidden', note: 'No production data-governance mutators exist.' },
  { id: 'privacy.memory-scopes', label: 'Memory / knowledge permission scopes', domain: 'privacy', runtime: '—', state: 'hidden', note: 'No user-facing scope model; scopes are install-time worker fields.' },

  // ── AI ──
  { id: 'ai.provider-model', label: 'AI provider, model, routing, reasoning, token limits', domain: 'ai', runtime: 'AI runtime (environment)', state: 'managed', note: 'Environment/code-defined; no settable config surface.' },
  { id: 'ai.auto-execution', label: 'Automatic execution policy', domain: 'ai', runtime: 'governance approvals', state: 'managed', note: 'Derived from federation governance allow-policies.' },
  { id: 'ai.execution', label: 'Execution (run / cancel / history)', domain: 'ai', runtime: 'execute engine', state: 'production-complete', permission: 'workforce:operate', tested: true },
  { id: 'ai.cost-controls', label: 'Cost & token controls', domain: 'ai', runtime: '—', state: 'hidden', note: 'Usage tracked in-memory only; no persisted budget/config.' },

  // ── Workspace ──
  { id: 'workspace.theme', label: 'Appearance / theme', domain: 'workspace', runtime: 'theme provider (nativeTheme)', state: 'production-complete', tested: false },
  { id: 'workspace.scale', label: 'Interface scale', domain: 'workspace', runtime: 'scale provider (pref)', state: 'production-complete' },
  { id: 'workspace.startup', label: 'Startup experience', domain: 'workspace', runtime: 'shell startup policy (pref)', state: 'production-complete', tested: true },
  // Phase 6 Stage 2 — the landing dashboard, wired to live IPC feeds with per-tile failure isolation.
  { id: 'workspace.mission-control', label: 'Mission Control (landing dashboard)', domain: 'workspace', runtime: 'renderer feed over existing IPC projections', state: 'production-complete', tested: true, note: 'Each tile loads independently and degrades to an explicit unavailable state; no mocked data.' },
  // Phase 6 Stage 3 — universal search over the EXISTING indexes (federated engine, UDM, memory+semantic, timeline, records, ERP modules). No new index, no new IPC.
  { id: 'platform.universal-search', label: 'Universal search (all indexes)', domain: 'platform', runtime: 'renderer pipeline over existing search IPC', state: 'production-complete', tested: true, note: 'Deterministic query planner + scope selector + explainable ranking; every source degrades honestly (per-source unavailable reasons).' },
  // Phase 6 Stage 4 — the Workspace Assistant: conversation → context → retrieval → reasoning → planning → approval → execution → verification, composed over the EXISTING AI engine, context builder, and ExecuteEngine.
  { id: 'platform.workspace-assistant', label: 'Workspace Assistant (conversational runtime)', domain: 'platform', runtime: 'main assistant service over existing engines (assistant:* IPC)', state: 'production-complete', tested: true, note: 'Five deterministic modes over one pipeline; side-effecting steps always park for approval and run only through the ExecuteEngine; one correlation id threads retrieval, AI audit, approvals, executions, and timeline events; every response carries the explainability envelope + Session Inspector trace.' },
  // Phase 6 Stage 5 — the Work Hub: Today + My Work + Executive tabs composed from existing feeds (briefing, recommendations, inbox, workforce, assistant, UDM, executive snapshot).
  { id: 'workspace.work-hub', label: 'Work Hub (personal workday)', domain: 'workspace', runtime: 'renderer composition over existing IPC feeds', state: 'production-complete', tested: true, note: 'Per-tile isolation with explicit unavailable reasons; includes the Productivity Timeline (chronological composition of existing records) and the descriptive daily Work Summary (aggregation, never a score).' },
  // Phase 6 Stage 5 (D-8) — the notification inbox: the delivery engine's previously typed-only notification-center channel, made real (durable store + notifications:* IPC + bell/view).
  { id: 'intelligence.insight-center', label: 'Enterprise Intelligence Layer', domain: 'ai', runtime: 'main insight composition over the existing P7 engines (signal projection; read-only insight:* IPC)', state: 'production-complete', permission: 'intelligence:read', tested: true, note: 'Signal registry with freshness/completeness/trust; eight-domain health framework; deterministic predictions; dependency-graph explanations; confidence breakdowns; outcome lifecycle; Intelligence Center dashboard + Hub tile. Recoveries run only as approval-gated assistant plan steps.' },
  { id: 'knowledge.asset-platform', label: 'Enterprise Knowledge Platform', domain: 'ai', runtime: 'main knowledgeAssets composition over the existing stores (read-only kb:* IPC)', state: 'production-complete', permission: 'knowledge:read', tested: true, note: 'Knowledge Asset Inventory (criticality/retention/review-owner/provenance); runtime-computed relationship matrix + impact analysis; decision lineage; deterministic authority precedence; 9-dimension quality; 8-domain standards + coverage map; Knowledge Platform tab. Lifecycle transitions stay behind the existing governed writes — this surface mutates nothing.' },
  // Phase 6 Stage 8 — the Enterprise Automation Platform: catalog/playbooks/policy/monitor composed over the existing engines (read-only ap:* IPC); the schedule tick rides the existing taskScheduler; execution stays on the existing spine.
  { id: 'automation.platform', label: 'Enterprise Automation Platform', domain: 'ai', runtime: 'main automationPlatform composition over the existing runner/orchestrator/governance (read-only ap:* IPC)', state: 'production-complete', permission: 'autonomousops:read', tested: true, note: 'Computed automation catalog (never stored); versioned playbooks compiled to the EXISTING WorkflowSpec with an approval checkpoint before every side-effecting step; policy resolution where governance chains always win (P19 computeAutoExecutable reused); honest rollback (external effects declared not-undoable); execution monitor + automation-watch delivery source; the schedule trigger fires for the first time via a 1-min tick on the existing taskScheduler. Zero mutation IPC — execution remains Assistant → Approval → ExecuteEngine → Workforce → Connectors.' },
  // Phase 6 Stage 9 — the Enterprise Operations Platform: service catalog/SLA/readiness/incidents/continuity composed over the existing measurements (read-only eops:* IPC); no incident store, no SLA persistence, no execution surface.
  { id: 'operations.platform', label: 'Enterprise Operations Platform', domain: 'ai', runtime: 'main operationsPlatform composition over the existing intelligence/governance/DR/validation layers (read-only eops:* IPC)', state: 'production-complete', permission: 'autonomousops:read', tested: true, note: 'Computed service catalog with resolved org-unit owners and honest gaps; SLA targets measured only by existing aggregates (unmeasurable declared); seven-dimension readiness with honest unknown; transient incident lifecycle with decision-conversion pointer (no ticket store); continuity with honest zeros and validation-observed RPO; Principle-C seven-field recommendations; operations-watch delivery source; Operations Center Platform tab. Zero mutation IPC — execution remains Assistant → Approval → ExecuteEngine → Workforce → Connectors.' },
  // Phase 6 Stage 10 — the Enterprise Strategy Platform: objectives/portfolio/value/planning/capability-map/risks/board-report composed over Stages 1–9 + P14 (read-only estrat:* IPC); no strategy store, no dates invented, no execution surface.
  { id: 'strategy.enterprise-platform', label: 'Enterprise Strategy Platform', domain: 'ai', runtime: 'main strategyPlatform composition over the S6–S9 platforms + P14 strategy (read-only estrat:* IPC under the existing strategy:read scope)', state: 'production-complete', permission: 'strategy:read', tested: true, note: 'Company/department objectives measured ONLY by existing aggregates (KPI bands, S9 SLA statuses, S6 domain bands) with department rollup; initiative portfolio over existing records (UDM projects, S8 playbooks, S9 services, governed decisions, mined processes) whose milestones are observable conditions — never dates; decision→outcome business value computed from the S6 outcome loop + measured 90-day health deltas (no currency exists and none is invented); relative-horizon executive planning whose every focus item is the Stage 9 Principle-C recommendation; the Enterprise Capability Map (twelve BUSINESS capabilities threaded through objectives, initiatives, KPIs, risks, and decision categories); strategy health composing S6+S7+S8+S9+P14 (P14 as ONE injected input); strategic risks substantiated only by live signals; board report; strategy-watch delivery source; Strategy Center Enterprise tab. Zero mutation IPC — execution remains Assistant → Approval → ExecuteEngine → Workforce → Connectors.' },
  // Phase 6 Stage 11 — the Enterprise Federation Platform: partners/trust-evidence/exchange/shared-layers/dashboard/report composed over the P9-S2 federation stores + P18 + Stages 7–10 (read-only efed:* IPC); no federation runtime duplicated, no wire protocol, no execution surface.
  { id: 'federation.enterprise-platform', label: 'Enterprise Federation Platform', domain: 'ai', runtime: 'main enterpriseFederation composition over the P9-S2 federation stores + P10 projection + P18 network + S7–S10 platforms (read-only efed:* IPC under the existing federation:read scope)', state: 'production-complete', permission: 'federation:read', tested: true, note: 'Partners × declared trust × recorded shares × signed artifacts; trust EVIDENCE computed from recorded signals BESIDE the declared level (computed never replaces declared; divergence reported, never resolved); the organization exchange joined to REAL local records with honest linkage states (name equality is a stated heuristic — the platform records no artifact↔record link); shared S7 knowledge / S8 automation / S9 partner-facing operations / S10 joint-initiative layers; Principle-C recommendations pointing only at existing governed fed:* surfaces; federation-watch delivery source; Federation Center Enterprise tab. Everything cross-org is a RECORD in local stores — no live connectivity exists and none is claimed. Zero mutation IPC.' },
  // Phase 6 Stage 12 — the Enterprise Analytics Platform: unified KPI catalog / recorded-window trends / forecast-capability inventory / decision intelligence / cross-domain dashboard + report composed over the existing producers (read-only eana:* IPC); no analytics engine, no metrics store, no forecasting math, no execution surface.
  { id: 'analytics.enterprise-platform', label: 'Enterprise Analytics Platform', domain: 'ai', runtime: 'main analyticsPlatform composition over the existing KPI/trend/prediction/decision producers (read-only eana:* IPC under the existing intelligence:read scope)', state: 'production-complete', permission: 'intelligence:read', tested: true, note: 'Every reachable KPI feed (executive snapshot incl. specialist KPIs, Process Explorer, P14 strategic, P18 network) source-attributed into ONE catalog — producers authoritative, bands composed verbatim, nothing recomputed, unregistered keys flagged never guessed; deterministic trends over RECORDED windows only (90-day health history + Stage 10 decision windows; point-in-time series declared untrendable; no extrapolation anywhere); the forecast inventory REGISTERS existing predictive capability (seven Stage 6 heuristics joined to firing instances, P14 scenario projection, capacity pressure registered as predicting nothing) with what each CAN and CANNOT predict — zero forecasting added; decision intelligence composing the decision store × Stage 6 outcome loop × Stage 10 value verdicts verbatim × sync S10/S11 recommendation inventories; cross-domain executive dashboard + report from PRE-COMPOSED S8–S11 slices with P18 benchmarks as ONE input; analytics-watch delivery source; Analytics tab in the EXISTING Insight Center. Zero mutation IPC.' },
  // Phase 6 Stage 13 — the Enterprise Digital Twin Platform: runtime/execution twin / Stage 6–12 platform twins / enterprise state-coverage map / simulation inventory / recorded-history view / dashboard + report composed over the P15 Enterprise Digital Twin (read-only etwin:* IPC); P15 stays authoritative and untouched; no twin engine, no simulation runner, no execution surface.
  { id: 'twin.enterprise-platform', label: 'Enterprise Digital Twin Platform', domain: 'ai', runtime: 'main digitalTwinPlatform composition over the P15 twin + Execute Engine + Runtime Supervisor + the S6–S12 platforms (read-only etwin:* IPC under the EXISTING twin:read scope — no new permission is minted)', state: 'production-complete', permission: 'twin:read', tested: true, note: 'Composed, registered and reachable: runtimeCore.ts binds all seven etwin:* handlers and supplies the assistant twinAnswer port, so a caller gets data back and a twin question is answered. The shared types; the seven channel constants, all seven listed in RUNTIME_INVOKABLE_CHANNELS (the secure-bridge allowlist); the runtime/execution twin over the Execute Engine and Runtime Supervisor under the partial-engine rule (any one failed engine read makes execution null and is reported unreadable, never half-composed); the nine P15 domains beside the Stage 6–12 platform twins; the 22-state enterprise coverage map carrying the search evidence behind every not-modelled row; the four registered simulation capabilities, each reported registered-never-invoked because invoked is structurally false in this stage; recorded-history composed over Stage 12 trends with point-in-time series declared untrendable; dashboard + sectioned report; the renderer ipc client and the Platform tab inside the EXISTING Twin Center; the twin-watch delivery source. All seven SecureHandlerDefs self-carry requireAuth and permission twin:read (proven by index.stage13.test.ts) and the etwin: namespace row is in the runtime completeness lock runtimeAuthz.test.ts. This entry read needs-ipc until the wiring landed, on the premise that runtimeCore.ts and runtimeAuthz.test.ts were absent from the checkout and the three supplying lines could not be written (task #1429); that premise was false — both files existed and always had, and the belief came from auditing a stale partial copy. The retraction is kept in full in docs/desktop/twin/TWIN-PLATFORM.md FINDING #9 rather than dropped, because an unwritable-file claim can license exactly the wrong repair. The honest degradation the earlier state relied on is unchanged and still locked: if a read fails the tab reports the panel absent under Declared unavailability, an unsupplied port still returns the explicit port-not-wired unavailable, and no failure is ever rendered as a zero. Zero mutation IPC — P15 is composed, never modified.' },
  { id: 'workspace.notification-inbox', label: 'Notification inbox (in-app)', domain: 'workspace', runtime: 'inbox store as the delivery engine notification-center channel (notifications:* IPC)', state: 'production-complete', audited: false, tested: true, note: 'Every delivered item lands in-app; bus events (approvals, work complete/failed, connector issues, risk signals, meeting reminders) pass the SAME gates as scheduled intelligence.' },
  { id: 'workspace.a11y-i18n', label: 'Language, reduced-motion, high-contrast & density', domain: 'workspace', runtime: '—', state: 'hidden', note: 'No i18n system or these preference stores exist yet.' },
  { id: 'workspace.notification-prefs', label: 'Notification delivery preferences', domain: 'workspace', runtime: 'executive delivery store (notifications:prefs.* IPC)', state: 'production-complete', audited: true, tested: true, note: 'Phase 6 Stage 5 (D-8): the EXISTING preference store surfaced through the documented notifications:* cluster — enable, DND, minimum priority, brief times, weekly day, per-source mutes; prefs.set is bridge-audited and cadence sources re-register live.' },

  // ── Organization ──
  { id: 'org.structure', label: 'Departments, teams & people', domain: 'organization', runtime: 'enterprise org', state: 'production-complete', permission: 'org:manage', audited: true, tested: true },
  { id: 'org.workers', label: 'Digital-worker roster', domain: 'organization', runtime: 'workforce registry', state: 'managed', permission: 'workforce:read', note: 'Fixed built-in registry; lifecycle via install/enable.' },
  { id: 'org.groups', label: 'Groups', domain: 'organization', runtime: '—', state: 'hidden', note: 'No group entity distinct from units/teams/roles.' },

  // ── Integrations (connectors — see CONNECTOR_LIFECYCLE for per-connector state) ──
  { id: 'integrations.connectors', label: 'Connectors (13 production adapters)', domain: 'integrations', runtime: 'connector service + sync adapters', state: 'production-complete', permission: 'connectors:manage', audited: true, tested: true },
  { id: 'integrations.webhooks', label: 'Webhooks', domain: 'integrations', runtime: 'webhook service', state: 'production-complete', permission: 'governance:manage', audited: true },
  { id: 'integrations.preview-connectors', label: 'Preview connectors (no adapter yet)', domain: 'integrations', runtime: 'connector manifests', state: 'needs-adapter', note: '9 connectors (ChatGPT/Claude/Gemini/Perplexity/Cursor/Canva/Figma/Linear/Zapier) have no data adapter; shown as Preview, not connectable.' },

  // ── Developer ──
  { id: 'developer.api-keys', label: 'API keys & OAuth apps', domain: 'developer', runtime: 'developer platform', state: 'production-complete', permission: 'developer:manage', audited: true, tested: true },
  { id: 'developer.plugins', label: 'Plugins & extensions', domain: 'developer', runtime: 'plugin store', state: 'production-complete', permission: 'marketplace:manage', audited: true },
  { id: 'developer.sandbox', label: 'Sandbox', domain: 'developer', runtime: 'sandbox subsystem', state: 'production-complete', permission: 'sandbox:manage', audited: true, tested: true },

  // ── Billing ──
  { id: 'billing.subscription', label: 'Subscription & plan', domain: 'billing', runtime: 'commercial + Razorpay', state: 'production-complete', permission: 'org:manage' },
  { id: 'billing.licenses', label: 'Licenses', domain: 'billing', runtime: 'license runtime', state: 'managed', note: 'Read-only; changes via checkout.' },
  { id: 'billing.usage-invoices', label: 'Usage & invoices', domain: 'billing', runtime: 'commercial projection', state: 'read-only', permission: 'commercial:read' },
  { id: 'billing.payment-methods', label: 'Payment methods & credits', domain: 'billing', runtime: '—', state: 'hidden', note: 'Checkout is an external redirect; no in-app payment-method/credit store.' },

  // ── System ──
  { id: 'system.updates', label: 'Updates & release channel', domain: 'system', runtime: 'updater', state: 'production-complete', audited: true },
  { id: 'system.backup-recovery', label: 'Backup & recovery', domain: 'system', runtime: 'release-ops', state: 'production-complete', permission: 'org:manage', audited: true, tested: true },
  { id: 'system.health', label: 'Runtime health & diagnostics', domain: 'system', runtime: 'neurocore / supervisor', state: 'read-only', note: 'Live telemetry projections.' },
  { id: 'system.devices', label: 'Device management', domain: 'system', runtime: 'devices service', state: 'production-complete', permission: 'org:manage' },
  { id: 'system.infrastructure', label: 'Infrastructure discovery', domain: 'system', runtime: 'infrastructure adapters', state: 'managed', note: 'Real cloud discovery adapters (AWS SigV4 + fetch), credential-gated; surfaced in the Infrastructure section.' },
  { id: 'system.storage-metering', label: 'Storage usage metering', domain: 'system', runtime: 'support-bundle dirSize', state: 'needs-ipc', note: 'A real directory-size reader EXISTS but is not wired to a live disk figure or an IPC channel (deferred).' },

  // ── Business (Enterprise Business Suite — the Business Workspace groups these real, registered modules) ──
  // Each family is production-complete: real records on the enterprise module framework, RBAC-gated in the
  // main process, audited via the lifecycle bus, searchable, and rendered by the generic module screen.
  { id: 'business.finance', label: 'Finance (invoices, payments)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'operations:manage', audited: true, tested: true, note: 'Finance enforces the operations:* scope, not finance:* — recorded as enforced.' },
  { id: 'business.sales', label: 'Sales (quotes, orders)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'sales:manage', audited: true, tested: true },
  { id: 'business.crm', label: 'CRM (contacts, leads, customers)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'crm:manage', audited: true, tested: true },
  { id: 'business.procurement', label: 'Procurement (suppliers, requests, POs, receipts)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'procurement:manage', audited: true, tested: true },
  { id: 'business.inventory', label: 'Inventory (products, warehouses, movements)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'inventory:manage', audited: true, tested: true },
  { id: 'business.warehouse', label: 'Warehouse (zones, bins, picking, packing, shipping)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'warehouse:manage', audited: true, tested: true },
  { id: 'business.manufacturing', label: 'Manufacturing (BOMs, orders, scheduling, execution)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'manufacturing:manage', audited: true, tested: true },
  { id: 'business.maintenance', label: 'Maintenance (assets, work orders, preventive plans)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'maintenance:manage', audited: true, tested: true },
  { id: 'business.executive', label: 'Executive (decisions, execution proposals)', domain: 'business', runtime: 'enterprise module framework', state: 'production-complete', permission: 'executive:approve', audited: true, tested: true, note: 'Writes split across executive:approve / executive:execute scopes.' },
  // Roadmap families the Business Workspace nav intentionally does NOT show as empty rooms — no modules yet.
  { id: 'business.quality', label: 'Quality management', domain: 'business', runtime: 'enterprise module framework', state: 'future-release', note: 'Exists today only as the Manufacturing "Quality Inspection" module; a standalone Quality family has no dedicated modules yet.' },
  { id: 'business.hr', label: 'Human Resources', domain: 'business', runtime: 'enterprise module framework', state: 'future-release', note: 'No HR modules are registered yet; planned for a future release.' },
  { id: 'business.projects', label: 'Projects & portfolio', domain: 'business', runtime: 'enterprise module framework', state: 'future-release', note: 'No Projects modules are registered yet; planned for a future release.' },
];

/* ── Derived views (surfaces read these; never redefine capability state elsewhere) ── */

export function capabilitiesByState(state: CapabilityState): Capability[] {
  return CAPABILITY_REGISTRY.filter((c) => c.state === state);
}

export function isReal(c: Capability): boolean {
  return REAL_STATES.includes(c.state);
}

export interface CapabilityMaturity {
  total: number;
  real: number;          // production-complete + managed + read-only
  productionComplete: number;
  managed: number;
  hidden: number;        // everything not real
  /** % of surveyed capabilities that are real (surfaced). */
  maturityPct: number;
  /** % that are fully production-complete (the strictest bar). */
  completionPct: number;
}

export function computeMaturity(): CapabilityMaturity {
  const total = CAPABILITY_REGISTRY.length;
  const productionComplete = capabilitiesByState('production-complete').length;
  const managed = capabilitiesByState('managed').length;
  const readOnly = capabilitiesByState('read-only').length;
  const real = productionComplete + managed + readOnly;
  const hidden = total - real;
  return {
    total,
    real,
    productionComplete,
    managed,
    hidden,
    maturityPct: total === 0 ? 0 : Math.round((real / total) * 100),
    completionPct: total === 0 ? 0 : Math.round((productionComplete / total) * 100),
  };
}
