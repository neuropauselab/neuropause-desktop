/**
 * Phase 6 Stage 7 — Decision Lineage (7.3).
 *
 * Composes the fragments that ALREADY exist into one cited chain:
 *   origin        → decision.fromRecommendationId / history 'created'
 *   discussion    → conversation summaries + graph 'discussed_in' + memories referencing the decision
 *   evidence      → decision.evidence[]
 *   approval      → history 'accepted' event (+ timeline approval.granted when correlated)
 *   implementation→ execution history joined by declared token overlap
 *   verification  → history 'completed' event / insight.outcome_verified timeline events
 *   status        → the decision's current governed state
 *
 * A stage with no backing record is ABSENT (present: false), never invented;
 * heuristic joins declare a lower per-stage confidence. Pure; reads injected.
 */
import type {
  DecisionLineage,
  DecisionLineageStage,
  ExecutiveDecision,
  KnowledgeLifecycleState,
  LineageStageKey,
} from '@neuropause/shared';
import { topicOverlap, topicTokens } from './assetInventory';

export interface LineageInput {
  decision: ExecutiveDecision | null;
  conversations: { id: string; title: string; updatedAt: string }[] | null;
  /** Graph 'discussed_in' neighbors of the decision's node (sourceIds + labels). */
  discussedIn: { id: string; label: string; at: string | null }[] | null;
  /** Memories whose entityRefs/evidence cite the decision id. */
  citingMemories: { id: string; title: string; updatedAt: string }[] | null;
  /** Timeline approval.granted events (id, correlationId, at). */
  approvalEvents: { id: string; correlationId: string | null; at: string }[] | null;
  executions: { label: string; state: string; startedAt: string }[] | null;
  /** Timeline insight.outcome_verified events with their recommendationId metadata. */
  verifiedEvents: { id: string; recommendationId: string | null; at: string }[] | null;
}

const DECISION_LIFECYCLE: Record<string, KnowledgeLifecycleState> = {
  draft: 'draft',
  suggested: 'review',
  accepted: 'approved',
  in_progress: 'approved',
  blocked: 'approved',
  completed: 'approved',
  rejected: 'deprecated',
  archived: 'archived',
};

function absent(stage: LineageStageKey, summary: string): DecisionLineageStage {
  return { stage, present: false, summary, at: null, evidence: [], confidence: 0 };
}

export function composeDecisionLineage(decisionId: string, input: LineageInput): DecisionLineage {
  const d = input.decision;
  if (!d) {
    return {
      decisionId,
      found: false,
      title: null,
      stages: [],
      currentStatus: null,
      lifecycle: null,
      overallConfidence: 0,
    };
  }

  const stages: DecisionLineageStage[] = [];
  const history = d.history ?? [];
  const decisionTopics = topicTokens(d.title);

  /* origin */
  const createdEv = history.find((h) => h.kind === 'created');
  stages.push({
    stage: 'origin',
    present: true,
    summary: d.fromRecommendationId
      ? `Created from recommendation ${d.fromRecommendationId}`
      : 'Created directly in the decision store',
    at: createdEv?.at ?? d.createdAt,
    evidence: [d.id, ...(d.fromRecommendationId ? [d.fromRecommendationId] : [])],
    confidence: 1,
  });

  /* discussion */
  const discussions: { id: string; label: string; at: string | null }[] = [];
  for (const g of input.discussedIn ?? []) discussions.push(g);
  for (const m of input.citingMemories ?? []) discussions.push({ id: m.id, label: m.title, at: m.updatedAt });
  const convMatches = (input.conversations ?? []).filter(
    (c) => topicOverlap(decisionTopics, topicTokens(c.title)) >= 0.34,
  );
  for (const c of convMatches) discussions.push({ id: c.id, label: c.title, at: c.updatedAt });
  if (discussions.length > 0) {
    const direct = (input.discussedIn?.length ?? 0) + (input.citingMemories?.length ?? 0);
    const ats = discussions.map((x) => x.at).filter((x): x is string => Boolean(x)).sort();
    stages.push({
      stage: 'discussion',
      present: true,
      summary: `${discussions.length} related discussion record(s): ${discussions
        .slice(0, 3)
        .map((x) => x.label)
        .join(' · ')}`,
      at: ats.length > 0 ? ats[ats.length - 1] : null,
      evidence: discussions.slice(0, 8).map((x) => x.id),
      confidence: direct > 0 ? 0.9 : 0.6, // title-overlap-only joins are a declared heuristic
    });
  } else {
    stages.push(absent('discussion', 'No recorded discussion references this decision'));
  }

  /* evidence */
  if (d.evidence.length > 0) {
    stages.push({
      stage: 'evidence',
      present: true,
      summary: `${d.evidence.length} evidence reference(s) recorded on the decision`,
      at: d.createdAt,
      evidence: d.evidence.slice(0, 8),
      confidence: 1,
    });
  } else {
    stages.push(absent('evidence', 'The decision carries no evidence references (a quality finding)'));
  }

  /* approval */
  const acceptedEv = history.find((h) => h.newState === 'accepted');
  if (acceptedEv) {
    const corr = (input.approvalEvents ?? []).filter((e) => e.correlationId && e.correlationId.includes(d.id));
    stages.push({
      stage: 'approval',
      present: true,
      summary: `Accepted by ${acceptedEv.actor}${corr.length > 0 ? ' (approval events correlated on the timeline)' : ''}`,
      at: acceptedEv.at,
      evidence: [`decision:${d.id}:history:accepted@${acceptedEv.at}`, ...corr.slice(0, 3).map((e) => e.id)],
      confidence: 1,
    });
  } else {
    stages.push(
      absent(
        'approval',
        d.status === 'draft' || d.status === 'suggested'
          ? 'Not yet approved (still in the pre-approval lifecycle)'
          : 'No acceptance event in the decision history',
      ),
    );
  }

  /* implementation — declared token-overlap join to execution history */
  const execMatches = (input.executions ?? []).filter(
    (e) => topicOverlap(decisionTopics, topicTokens(e.label)) >= 0.5,
  );
  if (execMatches.length > 0) {
    const done = execMatches.filter((e) => e.state === 'completed').length;
    stages.push({
      stage: 'implementation',
      present: true,
      summary: `${execMatches.length} execution(s) match the decision by label overlap (${done} completed)`,
      at: execMatches.map((e) => e.startedAt).sort().slice(-1)[0] ?? null,
      evidence: execMatches.slice(0, 5).map((e) => `execution:${e.label}@${e.startedAt}`),
      confidence: 0.6, // heuristic join, declared
    });
  } else if (d.status === 'in_progress' || d.status === 'completed') {
    stages.push({
      stage: 'implementation',
      present: true,
      summary: `Decision status '${d.status}' records implementation activity (no execution-history match)`,
      at: d.updatedAt,
      evidence: [d.id],
      confidence: 0.7,
    });
  } else {
    stages.push(absent('implementation', 'No execution or in-progress state backs implementation yet'));
  }

  /* verification */
  const completedEv = history.find((h) => h.newState === 'completed');
  const verified = (input.verifiedEvents ?? []).filter(
    (e) => e.recommendationId !== null && e.recommendationId === (d.fromRecommendationId ?? null),
  );
  if (verified.length > 0) {
    stages.push({
      stage: 'verification',
      present: true,
      summary: 'The originating recommendation was verified cleared by the intelligence layer',
      at: verified[0].at,
      evidence: verified.slice(0, 3).map((e) => e.id),
      confidence: 0.9,
    });
  } else if (completedEv) {
    stages.push({
      stage: 'verification',
      present: true,
      summary: `Marked completed by ${completedEv.actor} (operator verification)`,
      at: completedEv.at,
      evidence: [`decision:${d.id}:history:completed@${completedEv.at}`],
      confidence: 0.8,
    });
  } else {
    stages.push(absent('verification', 'No verification record exists yet'));
  }

  /* status */
  const lifecycle = DECISION_LIFECYCLE[d.status] ?? null;
  stages.push({
    stage: 'status',
    present: true,
    summary: `Current status: ${d.status}${d.blockedReason ? ` (blocked: ${d.blockedReason})` : ''}`,
    at: d.updatedAt,
    evidence: [d.id],
    confidence: 1,
  });

  const present = stages.filter((s) => s.present);
  const meanConfidence = present.length > 0 ? present.reduce((s, x) => s + x.confidence, 0) / present.length : 0;
  const coverage = present.length / stages.length;

  return {
    decisionId: d.id,
    found: true,
    title: d.title,
    stages,
    currentStatus: d.status,
    lifecycle,
    overallConfidence: Math.round(meanConfidence * coverage * 100) / 100,
  };
}
