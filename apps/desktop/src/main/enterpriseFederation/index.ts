/**
 * Phase 6 Stage 11 — the Enterprise Federation Platform composition root.
 *
 * ONE new subsystem that COMPOSES what already exists — it owns no runtime, no
 * store, no scheduler, no executor, and no mutation surface:
 *
 *   - partners (P9-S2 peer records × trust × shares × artifacts × the DECLARED
 *     exposure map),
 *   - trust EVIDENCE beside the declared level (computed never replaces
 *     declared; divergence reported, never resolved),
 *   - the organization exchange joined to REAL local records (name equality is
 *     a stated heuristic; no structural link is invented),
 *   - the four shared enterprise layers (S7 knowledge · S8 automation · S9
 *     partner-facing operations · S10 joint initiatives + capability
 *     federation),
 *   - the executive federation dashboard + board report — computed per read
 *     (3 s TTL),
 *   - SIX read-only `efed:*` IPC channels (RBAC `federation:read` — the
 *     existing P10 read scope; fail-closed; zero mutation),
 *   - ONE `federation-watch` delivery source (governed recommendation ITEMS —
 *     never actions),
 *   - the assistant's ten federation questions (in-process port; answers ride
 *     the existing 'intelligence' report kind).
 *
 * STRUCTURAL HONESTY: everything cross-org is a RECORD in the local federation
 * stores; there is no wire protocol and none is simulated. Electron-free by
 * construction: every read is an injected port; a failing port becomes an
 * explicit unavailable entry, never a fabricated value.
 */
import {
  EmptyRequest,
  IpcChannel,
  type AssistantStructuredReport,
  type EfedBoardReport,
  type EfedDashboard,
  type EfedExchangeReport,
  type EfedPartnersReport,
  type EfedSharingReport,
  type EfedTrustReport,
  type IntelligenceItem,
  type IntelligenceSource,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { composeFederationBoardReport, composeFederationDashboard, type EfedDashboardInputs } from './federationDashboard';
import { answerFederationQuestion, resolveFederationQuestion, type FederationQuestionContext } from './federationModel';
import { buildExchangeReport, buildPartnersReport } from './partnerExchange';
import { buildSharedAutomation } from './sharedAutomation';
import { buildSharedKnowledge } from './sharedKnowledge';
import { buildSharedOperations } from './sharedOperations';
import { buildSharedStrategy } from './sharedStrategy';
import { buildTrustReport } from './trustModel';
import { TenantMemo } from '../tenancy/tenantMemo';
import type { TenantScope } from '@neuropause/shared';

const log = createLogger('enterprise-federation');

const BUILD_TTL_MS = 3_000;

/* ── deps (every read injected; all sync — Stage 11 composes, never fetches) ─ */

export interface EnterpriseFederationDeps {
  /**
   * P13C ROUND 3 — the tenant boundary for this subsystem's composed cache.
   *
   * INJECTED, not imported. `enterprise/index` reaches `app.getPath`, so
   * importing `activeTenantScope` here would drag Electron into a pure-model
   * node test — a trap this program has now fallen into three times. The
   * composition root passes the same resolver every store reads.
   *
   * Required, so a root that forgets it fails to compile.
   */
  scope: () => TenantScope | null;
  /** P9-S2 federation runtime records. */
  fedHome: () => { id: string; name: string; regionId: string } | null;
  fedPeers: () => {
    id: string;
    name: string;
    role: string;
    status: string;
    regionId: string;
    trustLevel: string;
    joinedAt: string;
    sharedOut: number;
    sharedIn: number;
  }[];
  fedInvitations: () => { toOrg: string; fromOrg: string; direction: string; status: string }[];
  fedTrusts: () => {
    peerOrg: string;
    peerOrgName: string;
    trustLevel: string;
    delegatedApproval: boolean;
    canShareWorkers: boolean;
    canShareData: boolean;
  }[];
  fedShares: () => { kind: string; name: string; peerOrg: string; peerOrgName: string; direction: string; access: string }[];
  fedSummary: () => {
    orgs: number;
    peers: number;
    activePeers: number;
    pendingInvites: number;
    trustedPeers: number;
    sharedOut: number;
    sharedIn: number;
  };
  /** The signed exchange (flattened: signature completeness per artifact). */
  artifacts: () => {
    id: string;
    kind: string;
    name: string;
    publisherOrg: string;
    publisherOrgName: string;
    scope: string;
    verification: string;
    installs: number;
    signaturesEd25519: boolean;
  }[];
  /** The EXISTING federation governance (globalGovStore slices). */
  govPolicies: () => { id: string; name: string; action: string; enabled: boolean }[];
  govApprovals: () => { status: string }[];
  govAudit: () => { peerOrg: string | null }[];
  /** P18 — the sanitized intelligence network, composed as ONE input. */
  p18Summary: () => { shareableIntelligence: number; publishedInsights: number; healthBand: string } | null;
  /** LOCAL records (the shareable candidates). */
  knowledgeAssets: () => { id: string; title: string; topics: string[] }[] | null;
  playbooks: () => { id: string; name: string; version: number }[];
  apFindings: () => { severity: string }[] | null;
  connectors: () => { id: string; name: string }[];
  workers: () => { id: string; name: string }[];
  /** Stage 9 slices (partner-facing exposure context). */
  s9Services: () => { serviceId: string; state: string }[];
  slaStatuses: () => { targetId: string; serviceId: string; status: string }[];
  readiness: () => { state: string }[];
  capacityPressure: () => string;
  /** Stage 10 slices. */
  strategyInitiatives: () => { id: string; label: string; state: string; capabilityKeys: string[] }[];
  strategyCapabilities: () => { key: string; label: string; condition: string }[];
  /** The six live executive KPI producers. */
  executiveKpis: () => { key: string; label: string; display: string; band?: string }[];
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface EnterpriseFederationSubsystem {
  handlers: SecureHandlerDef[];
  partners: () => EfedPartnersReport;
  trust: () => EfedTrustReport;
  exchange: () => EfedExchangeReport;
  sharing: () => EfedSharingReport;
  dashboard: () => EfedDashboard;
  boardReport: () => EfedBoardReport;
  /** Assistant port: answer one of the ten federation questions, or null. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  nowIso: string;
  partners: EfedPartnersReport;
  trust: EfedTrustReport;
  exchange: EfedExchangeReport;
  sharing: EfedSharingReport;
  dashboard: EfedDashboard;
  board: EfedBoardReport;
}

function safeRead<T>(system: string, fn: () => T, failures: Record<string, string>): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** The subset of recorded failures relevant to one view (the dashboard dedups). */
function pick(failures: Record<string, string>, systems: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systems) {
    const v = failures[s];
    if (v !== undefined) out[s] = v;
  }
  return out;
}

export function initEnterpriseFederation(deps: EnterpriseFederationDeps): EnterpriseFederationSubsystem {
  const now = deps.now ?? ((): number => Date.now());
  /**
   * P13C ROUND 3 — found by the sweep, in the ONE subsystem of eight that was
   * missed.
   *
   * This was `let cache: BuildArtifacts | null` behind a 3s TTL, cleared only in
   * `dispose()`. Seven sibling subsystems with the identical shape all register
   * an `onWorkspaceSwitch` flush; this one never did, so a composed model of
   * peers, trusts, shares, exchange artifacts, governance audit, knowledge
   * assets, connectors, workers and executive KPIs survived an organization
   * switch — and the renderer's reload after a switch lands inside 3s.
   *
   * Keyed rather than given the missing listener, because the listener is what
   * the other seven have and it does not cover the background fan-out. A key
   * covers both.
   */
  const memo = new TenantMemo<BuildArtifacts>('enterprise-federation-model', {
    ttlMs: BUILD_TTL_MS,
    now,
  }).bindScope(deps.scope);

  const build = (): BuildArtifacts => memo.state(compose);

  const compose = (): BuildArtifacts => {
    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};

    const home = safeRead('fed-runtime', deps.fedHome, failures);
    const peers = safeRead('fed-peers', deps.fedPeers, failures);
    const invitations = safeRead('fed-invitations', deps.fedInvitations, failures);
    const trusts = safeRead('fed-trust', deps.fedTrusts, failures);
    const shares = safeRead('fed-shares', deps.fedShares, failures);
    const summary = safeRead('fed-summary', deps.fedSummary, failures);
    const artifacts = safeRead('fed-exchange', deps.artifacts, failures);
    const govPolicies = safeRead('fed-governance', deps.govPolicies, failures);
    const govApprovals = safeRead('fed-approvals', deps.govApprovals, failures);
    const govAudit = safeRead('fed-audit', deps.govAudit, failures);
    const p18 = safeRead('intelligence-network', () => deps.p18Summary(), failures);
    const knowledgeAssets = safeRead('knowledge-assets', () => deps.knowledgeAssets(), failures);
    const playbooks = safeRead('automation-playbooks', deps.playbooks, failures);
    const apFindings = safeRead('automation-monitor', () => deps.apFindings(), failures);
    const connectors = safeRead('connectors', deps.connectors, failures);
    const workers = safeRead('workforce', deps.workers, failures);
    const s9Services = safeRead('service-catalog', deps.s9Services, failures);
    const slaStatuses = safeRead('sla-framework', deps.slaStatuses, failures);
    const readiness = safeRead('readiness', deps.readiness, failures);
    const capacityPressure = safeRead('capacity', deps.capacityPressure, failures);
    const initiatives = safeRead('strategy-portfolio', deps.strategyInitiatives, failures);
    const capabilities = safeRead('strategy-capabilities', deps.strategyCapabilities, failures);
    const kpisRaw = safeRead('executive-kpis', deps.executiveKpis, failures);

    const trust = buildTrustReport({
      nowIso,
      signals: {
        peers,
        trusts,
        invitations,
        artifacts: artifacts ? artifacts.map((a) => ({ publisherOrg: a.publisherOrg, signaturesEd25519: a.signaturesEd25519 })) : null,
        audit: govAudit,
        policies: govPolicies ? govPolicies.map((p) => ({ action: p.action, enabled: p.enabled })) : null,
      },
      failures: pick(failures, ['fed-peers', 'fed-trust', 'fed-invitations', 'fed-exchange', 'fed-audit', 'fed-governance']),
    });

    const partners = buildPartnersReport({
      nowIso,
      records: { home, peers, invitations, shares, summary, artifacts },
      trust,
      failures: pick(failures, ['fed-runtime', 'fed-peers', 'fed-invitations', 'fed-shares', 'fed-summary', 'fed-exchange']),
    });

    const exchange = buildExchangeReport({
      nowIso,
      artifacts,
      locals: {
        playbooks,
        knowledgeAssets,
        governancePolicies: govPolicies ? govPolicies.map((p) => ({ id: p.id, name: p.name })) : null,
        connectors,
        workers,
      },
      failures: pick(failures, ['fed-exchange', 'automation-playbooks', 'knowledge-assets', 'fed-governance', 'connectors', 'workforce']),
    });

    const knowledge = buildSharedKnowledge({
      artifacts,
      shares,
      knowledgeAssets,
      failures: pick(failures, ['fed-exchange', 'fed-shares', 'knowledge-assets']),
    });
    const automation = buildSharedAutomation({
      artifacts,
      playbooks,
      apFindings,
      failures: pick(failures, ['fed-exchange', 'automation-playbooks', 'automation-monitor']),
    });
    const operations = buildSharedOperations({
      shares,
      s9Services,
      slaStatuses,
      readiness,
      capacityPressure,
      failures: pick(failures, ['fed-shares', 'service-catalog', 'sla-framework', 'readiness', 'capacity']),
    });
    const strategy = buildSharedStrategy({
      initiatives,
      capabilities,
      shares,
      artifacts,
      failures: pick(failures, ['strategy-portfolio', 'strategy-capabilities', 'fed-shares', 'fed-exchange']),
    });
    const sharingUnavailable = [...knowledge.unavailable, ...automation.unavailable, ...operations.unavailable, ...strategy.unavailable].filter(
      (u, i, arr) => arr.findIndex((x) => x.system === u.system) === i,
    );
    const sharing: EfedSharingReport = { generatedAt: nowIso, knowledge, automation, operations, strategy, unavailable: sharingUnavailable };

    const governance =
      govPolicies === null && govApprovals === null && govAudit === null
        ? null
        : {
            policies: govPolicies?.length ?? 0,
            activePolicies: (govPolicies ?? []).filter((p) => p.enabled).length,
            pendingApprovals: (govApprovals ?? []).filter((a) => a.status === 'pending').length,
            auditEntries: govAudit?.length ?? 0,
          };
    const kpiCards = kpisRaw ? kpisRaw.map((k) => ({ key: k.key, label: k.label, display: k.display, band: k.band ?? null })) : [];

    const dashInputs: EfedDashboardInputs = { nowIso, partners, trust, exchange, sharing, governance, network: p18, kpis: kpiCards };
    const dashboard = composeFederationDashboard(dashInputs);
    // Root-level reads that no component view picks (P18, approvals, KPIs)
    // still declare their misses on the dashboard — nothing fails silently.
    for (const [system, reason] of Object.entries(pick(failures, ['intelligence-network', 'fed-approvals', 'executive-kpis']))) {
      if (!dashboard.unavailable.some((u) => u.system === system)) dashboard.unavailable.push({ system, reason });
    }
    const board = composeFederationBoardReport(dashInputs);

    return { at: nowMs, nowIso, partners, trust, exchange, sharing, dashboard, board };
  };

  /* ── the assistant port (ten questions; sync; same composed pass) ────────── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveFederationQuestion(text);
    if (!key) return null;
    const b = build();
    const ctx: FederationQuestionContext = {
      partners: b.partners,
      trust: b.trust,
      exchange: b.exchange,
      sharing: b.sharing,
      dashboard: b.dashboard,
      board: b.board,
      nowIso,
    };
    return answerFederationQuestion(key, ctx);
  };

  /* ── monitoring: ONE governed watch source (items only, never actions) ──── */
  /**
   * P13C ROUND 5 — F8. DELIVERED-WATCH STATE, PER TENANT AND BOUNDED.
   *
   * One global `Set<string>` of recommendation ids, and `produce()` runs once
   * per tenant under the delivery fan-out. Recommendation ids are
   * tenant-independent constants (`efedrec:governance:pending-approvals` and
   * friends), so the FIRST tenant in the fan-out claimed each id and every other
   * tenant's identical item was suppressed — permanently, since nothing ever
   * cleared it.
   *
   * No content crossed: each body is built from that tenant's own scoped
   * `build()`. What crossed was the DECISION not to deliver. Cross-tenant
   * suppression is quieter than cross-tenant disclosure and just as wrong — one
   * customer stops receiving critical federation alerts because another
   * customer received the same category first.
   *
   * Bounded on two axes, because a fix that leaks memory is not a fix: entries
   * expire after a day (the source's own cadence, so re-delivery resumes the
   * next cycle rather than never), and the whole structure is capped so a
   * pathological tenant count cannot grow it without limit.
   */
  const WATCH_TTL_MS = 24 * 60 * 60 * 1000;
  const WATCH_MAX_ENTRIES = 5_000;
  const deliveredWatch = new Map<string, number>();
  const watchKey = (tenantId: string, recId: string): string => JSON.stringify([tenantId, recId]);
  const watchPrune = (nowMs: number): void => {
    for (const [k, at] of deliveredWatch) if (nowMs - at >= WATCH_TTL_MS) deliveredWatch.delete(k);
    while (deliveredWatch.size > WATCH_MAX_ENTRIES) {
      const oldest = deliveredWatch.keys().next().value;
      if (oldest === undefined) break;
      deliveredWatch.delete(oldest);
    }
  };
  const watchSource: IntelligenceSource = {
    key: 'federation-watch',
    label: 'Federation Watch',
    cadence: { kind: 'daily', atMinutes: 9 * 60 + 15 },
    produce: async (): Promise<IntelligenceItem[]> => {
      const b = build();
      const items: IntelligenceItem[] = [];
      /**
       * The tenant this pass is FOR. Under the delivery fan-out this is the
       * running principal's organization, not whatever the UI has open.
       */
      const tenantId = deps.scope()?.tenantId ?? null;
      if (tenantId === null) return items;
      const nowMs = now();
      watchPrune(nowMs);
      for (const r of b.dashboard.recommendations) {
        if (r.priority !== 'critical' && r.priority !== 'high') continue;
        const key = watchKey(tenantId, r.id);
        if (deliveredWatch.has(key)) continue;
        deliveredWatch.set(key, nowMs);
        items.push({
          id: `efed:${r.id}`,
          title: r.title,
          body: `${r.detail} Suggested: ${r.suggestedAction}`,
          priority: r.priority === 'critical' ? 'critical' : 'high',
          impact: { business: 0.6, urgency: r.priority === 'critical' ? 0.8 : 0.6, confidence: r.confidence },
          deepLink: 'federation',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: r.evidence.slice(0, 8),
            sourceSystems: r.affectedSystems.length > 0 ? r.affectedSystems : ['enterprise-federation'],
            confidence: r.confidence,
            reasoning: r.reasoning,
            recommendedAction: r.suggestedAction,
          },
        });
      }
      return items;
    },
  };
  deps.registerSource(watchSource);

  /* ── the six read-only IPC channels (D-9; federation:read, fail-closed) ──── */
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.EfedPartners,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'federation:read',
      handler: () => build().partners,
    },
    {
      channel: IpcChannel.EfedTrust,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'federation:read',
      handler: () => build().trust,
    },
    {
      channel: IpcChannel.EfedExchange,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'federation:read',
      handler: () => build().exchange,
    },
    {
      channel: IpcChannel.EfedSharing,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'federation:read',
      handler: () => build().sharing,
    },
    {
      channel: IpcChannel.EfedDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'federation:read',
      handler: () => build().dashboard,
    },
    {
      channel: IpcChannel.EfedReport,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'federation:read',
      handler: () => build().board,
    },
  ];

  log.info('Enterprise Federation Platform ready', { channels: handlers.length, sources: 1 });

  return {
    handlers,
    partners: () => build().partners,
    trust: () => build().trust,
    exchange: () => build().exchange,
    sharing: () => build().sharing,
    dashboard: () => build().dashboard,
    boardReport: () => build().board,
    answerQuestion,
    dispose: () => {
      memo.invalidate();
    },
  };
}
