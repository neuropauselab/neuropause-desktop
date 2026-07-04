/**
 * Founder AI — Proactive Intelligence source (V2.2).
 *
 * Turns Founder AI from reactive (answers when asked) into proactive (surfaces
 * evidence-backed recommendations on a schedule) — WITHOUT any new AI, notifier,
 * or scheduler. It:
 *   1. builds the briefing exactly as V2.1 / initDailyIntelligence does,
 *   2. extracts deterministic, evidence-bearing findings via the EXISTING
 *      `founderFindingsFromBriefing`,
 *   3. maps each finding to a governance-complete IntelligenceItem, and
 *   4. registers as an IntelligenceSource on the EXISTING delivery engine.
 *
 * Reuses: generateBriefing, founderFindingsFromBriefing, unifiedStore, timeline,
 * the delivery engine. Invents nothing — every item references real evidence.
 */
import {
  type IntelligenceImpact,
  type IntelligenceItem,
  type IntelligencePriority,
  type IntelligenceSource,
} from '@neuropause/shared';
import type { BriefingSectionId, FounderFinding } from '@neuropause/shared';
import { createLogger } from '../logger';
import { unifiedStore } from '../unified/storeInstance';
import { getEnterpriseTimeline } from '../timeline';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { founderFindingsFromBriefing } from './founderAI';

const log = createLogger('founder-proactive');

/**
 * Section → impact/priority mapping (STEP 3). Engineering-risk and attention items
 * are the highest-urgency; release/CI/PR health carry engineering + operational
 * weight; business-facing sections carry business/customer weight. Confidence is
 * scaled by how much evidence backs the finding.
 */
const SECTION_IMPACT: Partial<
  Record<
    BriefingSectionId,
    { priority: IntelligencePriority; impact: IntelligenceImpact; why: string; action: string }
  >
> = {
  engineering_risk: {
    priority: 'critical',
    impact: { engineering: 0.9, urgency: 0.9, business: 0.5 },
    why: 'An engineering risk can block delivery if unaddressed.',
    action: 'Review the flagged risk and assign an owner.',
  },
  attention: {
    priority: 'high',
    impact: { urgency: 0.8, business: 0.5, customer: 0.4 },
    why: 'This item was flagged as needing your attention.',
    action: 'Open the item and decide the next step.',
  },
  release_health: {
    priority: 'high',
    impact: { engineering: 0.7, business: 0.6, urgency: 0.6 },
    why: 'Release health affects your ship date.',
    action: 'Check the release blockers before the next cut.',
  },
  ci_health: {
    priority: 'high',
    impact: { engineering: 0.7, urgency: 0.6 },
    why: 'A failing pipeline stops shipping.',
    action: 'Investigate the failing CI run.',
  },
  pr_health: {
    priority: 'normal',
    impact: { engineering: 0.5, urgency: 0.4 },
    why: 'Stale PRs slow the team down.',
    action: 'Nudge reviewers or merge ready PRs.',
  },
  upcoming: {
    priority: 'high',
    impact: { urgency: 0.7, business: 0.4 },
    why: 'An upcoming deadline is approaching.',
    action: 'Confirm you are on track for the deadline.',
  },
  meetings: {
    priority: 'normal',
    impact: { urgency: 0.5 },
    why: 'A meeting on your calendar may need prep.',
    action: 'Prepare or confirm attendance.',
  },
};

const DEFAULT_MAP = {
  priority: 'normal' as IntelligencePriority,
  impact: { business: 0.3 } as IntelligenceImpact,
  why: 'Surfaced from your recent activity.',
  action: 'Review when you have a moment.',
};

/** Evidence kind → source system label, for governance. */
function sourceSystemFor(finding: FounderFinding): string[] {
  const systems = new Set<string>();
  if (finding.connectorId) systems.add(finding.connectorId);
  for (const e of finding.evidence) systems.add(e.kind);
  if (systems.size === 0) systems.add('timeline');
  return [...systems];
}

/** Confidence grows with evidence count, capped — 1 piece = 0.6, 3+ = 0.9. */
function confidenceFor(finding: FounderFinding): number {
  const n = finding.evidence.length;
  if (n <= 0) return 0.4;
  if (n === 1) return 0.6;
  if (n === 2) return 0.75;
  return 0.9;
}

/**
 * Build today's findings and map them to governance-complete items. `period`
 * controls the brief window; 'morning' for the daily proactive feed.
 */
export function buildFounderProactiveItems(
  period: 'morning' | 'evening' = 'morning',
): IntelligenceItem[] {
  const now = new Date().toISOString();
  const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const tl = getEnterpriseTimeline();
  const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const briefing = generateBriefing(period, { entities, events, now });

  // Reuse the existing deterministic finding extractor. 'business-risk' intent
  // surfaces the broad executive set (engineering + business), not engineering-only.
  const findings = founderFindingsFromBriefing(briefing, 'business-risk', 12);
  if (findings.length === 0) return []; // silent no-op — nothing worth surfacing

  // Map section title back to a section id where possible, for impact lookup.
  const sectionIdByTitle = new Map<string, BriefingSectionId>();
  for (const s of briefing.sections) sectionIdByTitle.set(s.title, s.id);

  const items: IntelligenceItem[] = [];
  for (const f of findings) {
    const sectionId = sectionIdByTitle.get(f.label);
    const map = (sectionId && SECTION_IMPACT[sectionId]) || DEFAULT_MAP;
    const confidence = confidenceFor(f);
    const evidenceRefs = f.evidence.map((e) => `${e.kind}:${e.id}`);
    items.push({
      id: `founder-proactive:${sectionId ?? 'general'}:${f.at ?? f.text.slice(0, 24)}`,
      title: `Founder AI — ${f.label}`,
      body: f.text,
      priority: map.priority,
      impact: { ...map.impact, confidence },
      deepLink: 'ai-workforce/founder',
      producedAt: now,
      governance: {
        evidence: evidenceRefs.length > 0 ? evidenceRefs : ['derived from timeline'],
        sourceSystems: sourceSystemFor(f),
        confidence,
        reasoning: map.why,
        recommendedAction: map.action,
      },
    });
  }
  return items;
}

/** The Founder AI proactive source, ready to register on the delivery engine. */
export function founderProactiveSource(atMinutes: number): IntelligenceSource {
  return {
    key: 'founder-ai-proactive',
    label: 'Founder AI — Proactive Recommendations',
    cadence: { kind: 'daily', atMinutes },
    produce: () => {
      const items = buildFounderProactiveItems('morning');
      log.info('Founder AI proactive produced', { count: items.length });
      return items;
    },
  };
}
