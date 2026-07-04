/**
 * Organization Intelligence source (V2.3).
 *
 * Continuously (on the delivery engine's schedule) reads organization-level
 * signals that ALREADY EXIST, computes the Organization Health model, and emits
 * governance-complete findings when health drops or specific risks appear. It:
 *   - reuses connectorStore, licenseValidator, orgStore, workspaceStore, timeline
 *   - reuses the V2.3 computeOrgHealth model (pure scoring)
 *   - registers as ONE IntelligenceSource on the EXISTING delivery engine
 * No new org service, no new scheduler, no new notifier, nothing fabricated.
 */
import {
  computeOrgHealth,
  orgHealthBand,
  type IntelligenceItem,
  type IntelligencePriority,
  type OrgHealthInputs,
  type OrgHealthScores,
  type IntelligenceSource,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { connectorStore } from '../connectors/connectorStore';
import { licenseValidator } from '../license/licenseInstance';
import { orgStore } from './org/orgInstance';
import { workspaceStore } from './workspace/workspaceInstance';
import { getEnterpriseTimeline } from '../timeline';

const log = createLogger('org-intelligence');

/** Read real org signals into health-model inputs. Everything here is observed. */
export function collectOrgHealthInputs(nowMs: number): OrgHealthInputs {
  // Connectors — health snapshot from the existing store.
  const accounts = connectorStore.all();
  const connectorsTotal = accounts.length;
  const connectorsHealthy = accounts.filter((a) => a.health === 'healthy').length;
  const connectorsError = accounts.filter(
    (a) => a.health === 'down' || a.status === 'error',
  ).length;

  // License — re-evaluated status from the existing validator.
  let licenseDaysToExpiry: number | null = null;
  let licenseValid: boolean | undefined;
  try {
    const org = orgStore.defaultOrg();
    const status = licenseValidator.getStatus(org.id);
    const ev = status.evaluation;
    if (ev) {
      licenseValid = ev.state === 'valid' || ev.state === 'grace';
      if (ev.expiresAt) {
        licenseDaysToExpiry = Math.floor((new Date(ev.expiresAt).getTime() - nowMs) / 86_400_000);
      }
    }
  } catch {
    /* license unknown → inputs stay null, model uses neutral score */
  }

  // Org size + workspaces.
  let memberCount = 0;
  let workspaceCount = 0;
  try {
    const org = orgStore.defaultOrg();
    memberCount = orgStore.usersFor(org.id).length;
    workspaceCount = workspaceStore.list().length;
  } catch {
    /* org read unavailable */
  }

  // Recent activity from the enterprise timeline (trailing 7 days).
  const tl = getEnterpriseTimeline();
  const weekAgo = nowMs - 7 * 86_400_000;
  const recentEntries = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const recent = recentEntries.filter((e) => {
    const t = new Date((e as { at?: string }).at ?? 0).getTime();
    return t >= weekAgo;
  });
  const recentEventCount = recent.length;
  const aiSourcesUsed = new Set(
    recent
      .map(
        (e) =>
          (e as { connectorId?: string; source?: string }).connectorId ??
          (e as { source?: string }).source,
      )
      .filter(Boolean),
  ).size;
  const executiveActiveRecently = recentEventCount > 0;

  return {
    connectorsTotal,
    connectorsHealthy,
    connectorsError,
    licenseDaysToExpiry,
    licenseValid,
    memberCount,
    activeMemberCount: executiveActiveRecently ? Math.max(1, Math.min(memberCount, 1)) : 0,
    workspaceCount,
    recentEventCount,
    aiSourcesUsed,
    syncFailures: connectorsError, // reuse connector errors as the sync-failure proxy
    executiveActiveRecently,
  };
}

type Finding = {
  id: string;
  title: string;
  body: string;
  priority: IntelligencePriority;
  impactUrgency: number;
  evidence: string[];
  sourceSystems: string[];
  confidence: number;
  reasoning: string;
  recommendedAction: string;
};

/** Derive governance-complete findings from the computed scores + raw inputs. */
export function deriveOrgFindings(scores: OrgHealthScores, inputs: OrgHealthInputs): Finding[] {
  const findings: Finding[] = [];

  // Overall band — surface only when not healthy.
  const band = orgHealthBand(scores.overall);
  if (band !== 'healthy') {
    findings.push({
      id: `org:health:${band}`,
      title: `Organization health is ${band} (${scores.overall}/100)`,
      body: `Activity ${scores.activity}, adoption ${scores.adoption}, engineering ${scores.engineering}, reliability ${scores.reliability}.`,
      priority: band === 'critical' ? 'critical' : band === 'at-risk' ? 'high' : 'normal',
      impactUrgency: band === 'critical' ? 0.9 : band === 'at-risk' ? 0.7 : 0.5,
      evidence: [
        `overall=${scores.overall}`,
        `activity=${scores.activity}`,
        `reliability=${scores.reliability}`,
      ],
      sourceSystems: ['organization', 'timeline', 'connectors'],
      confidence: 0.8,
      reasoning: 'The weighted organization health score fell below the healthy threshold.',
      recommendedAction: 'Review the lowest sub-scores and address the weakest area first.',
    });
  }

  // License expiring soon (≤14 days) or expired.
  const d = inputs.licenseDaysToExpiry;
  if (inputs.licenseValid === false) {
    findings.push({
      id: 'org:license:invalid',
      title: 'License is invalid or expired',
      body: 'The organization license did not validate.',
      priority: 'critical',
      impactUrgency: 1,
      evidence: ['license.valid=false'],
      sourceSystems: ['licensing'],
      confidence: 0.95,
      reasoning: 'An invalid license can disable paid capabilities and blocks compliance.',
      recommendedAction: 'Renew or re-activate the license immediately.',
    });
  } else if (d != null && d >= 0 && d <= 14) {
    findings.push({
      id: 'org:license:expiring',
      title: `License expires in ${d} day${d === 1 ? '' : 's'}`,
      body: 'Renew before expiry to avoid interruption.',
      priority: d <= 3 ? 'critical' : 'high',
      impactUrgency: d <= 3 ? 0.9 : 0.7,
      evidence: [`license.daysToExpiry=${d}`],
      sourceSystems: ['licensing'],
      confidence: 0.95,
      reasoning: 'License runway is short; expiry would interrupt service.',
      recommendedAction: 'Start the renewal now.',
    });
  }

  // Critical connector disconnected / errored.
  if ((inputs.connectorsError ?? 0) > 0) {
    findings.push({
      id: 'org:connector:error',
      title: `${inputs.connectorsError} connector${inputs.connectorsError === 1 ? '' : 's'} in error`,
      body: 'A connected source is down; its data will stop flowing.',
      priority: 'high',
      impactUrgency: 0.75,
      evidence: [
        `connectors.error=${inputs.connectorsError}`,
        `connectors.total=${inputs.connectorsTotal}`,
      ],
      sourceSystems: ['connectors'],
      confidence: 0.9,
      reasoning: 'A failed connector silently stops intelligence from that source.',
      recommendedAction: 'Reconnect the affected connector.',
    });
  }

  // Low AI adoption.
  if (scores.adoption < 40 && (inputs.memberCount ?? 0) > 0) {
    findings.push({
      id: 'org:adoption:low',
      title: `Low adoption (${scores.adoption}/100)`,
      body: 'Few members are actively using the workspace.',
      priority: 'normal',
      impactUrgency: 0.5,
      evidence: [
        `adoption=${scores.adoption}`,
        `members=${inputs.memberCount}`,
        `active=${inputs.activeMemberCount ?? 0}`,
      ],
      sourceSystems: ['organization', 'timeline'],
      confidence: 0.7,
      reasoning: 'Low active-member ratio signals weak adoption and churn risk.',
      recommendedAction: 'Encourage connector setup and share a quick-start with the team.',
    });
  }

  // Inactivity — no recent activity at all.
  if ((inputs.recentEventCount ?? 0) === 0) {
    findings.push({
      id: 'org:inactive',
      title: 'No organization activity this week',
      body: 'No tracked events in the last 7 days.',
      priority: 'high',
      impactUrgency: 0.7,
      evidence: ['recentEventCount=0'],
      sourceSystems: ['timeline'],
      confidence: 0.85,
      reasoning: 'A dormant organization is a strong churn indicator.',
      recommendedAction: 'Re-engage: connect a source or generate a brief.',
    });
  }

  // Declining engineering health.
  if (scores.engineering < 50 && inputs.engineeringHealth01 != null) {
    findings.push({
      id: 'org:engineering:declining',
      title: `Engineering health low (${scores.engineering}/100)`,
      body: 'Release/CI/PR signals indicate delivery risk.',
      priority: 'high',
      impactUrgency: 0.8,
      evidence: [`engineering=${scores.engineering}`],
      sourceSystems: ['engineering', 'timeline'],
      confidence: 0.75,
      reasoning: 'Falling engineering health raises the risk of missed delivery.',
      recommendedAction: 'Triage the engineering risks in the Mission Brief.',
    });
  }

  return findings;
}

/** Map findings to governance-complete IntelligenceItems (STEP 6). */
function toItems(findings: Finding[], nowIso: string): IntelligenceItem[] {
  return findings.map((f) => ({
    id: `org-intelligence:${f.id}`,
    title: `Organization — ${f.title}`,
    body: f.body,
    priority: f.priority,
    impact: {
      business: 0.6,
      customer: 0.4,
      urgency: f.impactUrgency,
      confidence: f.confidence,
    },
    deepLink: 'enterprise/organization',
    producedAt: nowIso,
    governance: {
      evidence: f.evidence,
      sourceSystems: f.sourceSystems,
      confidence: f.confidence,
      reasoning: f.reasoning,
      recommendedAction: f.recommendedAction,
    },
  }));
}

/** Build org-intelligence items now (also usable by an on-demand IPC later). */
export function buildOrgIntelligenceItems(): IntelligenceItem[] {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const inputs = collectOrgHealthInputs(nowMs);
  const scores = computeOrgHealth(inputs);
  const findings = deriveOrgFindings(scores, inputs);
  log.info('Org intelligence computed', { overall: scores.overall, findings: findings.length });
  return toItems(findings, nowIso);
}

/** The Organization Intelligence source, ready to register on the delivery engine. */
export function orgIntelligenceSource(atMinutes: number): IntelligenceSource {
  return {
    key: 'organization-intelligence',
    label: 'Organization Intelligence',
    cadence: { kind: 'daily', atMinutes },
    produce: () => buildOrgIntelligenceItems(),
  };
}
