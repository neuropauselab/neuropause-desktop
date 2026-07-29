/**
 * Trust Model (NCEA 11.1, Phase 4). Trust is an EXPLAINABLE, heuristic indicator
 * computed from observable signals — never a fabricated probability. `assess()`
 * returns a score in [0,1] AND the full weighted breakdown that produced it AND
 * caveats for every signal that was weak or absent, so a reader always sees WHY.
 * Human approval and audit integrity are weighted above AI self-confidence by
 * design: the layer must not let a model's own certainty dominate trust.
 */
import type { Clock } from '@neuropause/cloud-core';
import { clamp01, weightedAverage } from './util';
import type { EvidenceRecord } from './evidence';
import type { KnowledgeGovernance } from './governance';

export interface TrustSignals {
  /** Reliability of the source type/channel, 0..1. */
  sourceReliability?: number;
  /** Timestamp of the underlying data — freshness decays with age. */
  freshnessAt?: number;
  verified?: boolean;
  humanApproved?: boolean;
  /** A source's self-reported confidence (e.g. an AI's), 0..1 — weighted low. */
  aiConfidence?: number;
  auditIntact?: boolean;
  /** Fraction of expected evidence/fields present, 0..1. */
  completeness?: number;
}

export interface TrustComponent {
  signal: string;
  value: number;
  weight: number;
  note: string;
}

export type TrustBand = 'low' | 'moderate' | 'high';

export interface TrustAssessment {
  score: number;
  band: TrustBand;
  components: TrustComponent[];
  caveats: string[];
}

/** Half-life for freshness decay: 30 days. value = 0.5 ^ (age / halfLife). */
const FRESHNESS_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

const WEIGHTS = {
  sourceReliability: 1.0,
  freshness: 0.8,
  verified: 1.2,
  humanApproved: 1.5, // human approval carries the most weight
  aiConfidence: 0.6, // AI self-confidence carries the least
  auditIntact: 1.2,
  completeness: 1.0,
} as const;

export class TrustModel {
  constructor(
    private readonly clock: Clock,
    private readonly governance?: KnowledgeGovernance,
  ) {}

  assess(signals: TrustSignals, options: { now?: number } = {}): TrustAssessment {
    const now = options.now ?? this.clock.now();
    const components: TrustComponent[] = [];
    const caveats: string[] = [];

    if (signals.sourceReliability !== undefined)
      components.push({ signal: 'sourceReliability', value: clamp01(signals.sourceReliability), weight: WEIGHTS.sourceReliability, note: 'reliability of the source channel' });
    else caveats.push('source reliability not provided');

    if (signals.freshnessAt !== undefined) {
      const ageMs = Math.max(0, now - signals.freshnessAt);
      const value = clamp01(Math.pow(0.5, ageMs / FRESHNESS_HALF_LIFE_MS));
      components.push({ signal: 'freshness', value, weight: WEIGHTS.freshness, note: `decays with age (half-life 30d); age ${Math.round(ageMs / 86_400_000)}d` });
      if (value <= 0.5) caveats.push('underlying data is stale');
    } else caveats.push('freshness unknown');

    if (signals.verified !== undefined) {
      components.push({ signal: 'verified', value: signals.verified ? 1 : 0, weight: WEIGHTS.verified, note: signals.verified ? 'verified' : 'not verified' });
      if (!signals.verified) caveats.push('not independently verified');
    } else caveats.push('verification status unknown');

    if (signals.humanApproved !== undefined) {
      components.push({ signal: 'humanApproved', value: signals.humanApproved ? 1 : 0, weight: WEIGHTS.humanApproved, note: signals.humanApproved ? 'human-approved' : 'no human approval' });
      if (!signals.humanApproved) caveats.push('no human approval on record');
    } else caveats.push('human approval unknown');

    if (signals.aiConfidence !== undefined)
      components.push({ signal: 'aiConfidence', value: clamp01(signals.aiConfidence), weight: WEIGHTS.aiConfidence, note: 'AI self-reported confidence (weighted low)' });

    if (signals.auditIntact !== undefined) {
      components.push({ signal: 'auditIntact', value: signals.auditIntact ? 1 : 0, weight: WEIGHTS.auditIntact, note: signals.auditIntact ? 'audit chain intact' : 'audit integrity NOT confirmed' });
      if (!signals.auditIntact) caveats.push('audit integrity not confirmed');
    } else caveats.push('audit integrity unknown');

    if (signals.completeness !== undefined) {
      const value = clamp01(signals.completeness);
      components.push({ signal: 'completeness', value, weight: WEIGHTS.completeness, note: 'fraction of expected evidence present' });
      if (value < 0.6) caveats.push('evidence is incomplete');
    } else caveats.push('completeness unknown');

    const score = weightedAverage(components.map((c) => ({ value: c.value, weight: c.weight })));
    // Honest framing: this is a heuristic indicator, not a probability of correctness.
    caveats.push('heuristic indicator — not a probability of correctness');

    return { score, band: band(score), components, caveats };
  }

  /** Derive trust signals from an evidence set and assess — ties trust to real evidence. */
  assessEvidence(evidence: EvidenceRecord[], extra: TrustSignals = {}, options: { now?: number } = {}): TrustAssessment {
    if (evidence.length === 0) {
      return this.assess({ completeness: 0, ...extra }, options);
    }
    const verifiedShare = evidence.filter((e) => e.verified).length / evidence.length;
    const newest = Math.max(...evidence.map((e) => e.at));
    const aiConfidences = evidence.filter((e) => e.sourceConfidence !== undefined).map((e) => e.sourceConfidence!);
    const avgAi = aiConfidences.length ? aiConfidences.reduce((a, b) => a + b, 0) / aiConfidences.length : undefined;
    const hasHuman = evidence.some((e) => e.type === 'human-input');
    return this.assess(
      {
        sourceReliability: verifiedShare,
        freshnessAt: newest,
        verified: verifiedShare > 0.5,
        humanApproved: hasHuman,
        ...(avgAi !== undefined ? { aiConfidence: avgAi } : {}),
        completeness: clamp01(evidence.length / 3), // ≥3 distinct pieces ≈ complete (heuristic)
        ...extra,
      },
      options,
    );
  }

  async recordAssessment(entityKey: string, assessment: TrustAssessment, evidenceIds: string[] = [], actor = 'system'): Promise<TrustAssessment> {
    if (this.governance) {
      await this.governance.record({
        domain: 'trust',
        action: `assess.${assessment.band}`,
        entity: entityKey,
        actor,
        ok: true,
        ...(evidenceIds.length ? { evidenceIds } : {}),
        meta: { score: Number(assessment.score.toFixed(4)), band: assessment.band, caveats: assessment.caveats.length },
      });
    }
    return assessment;
  }
}

function band(score: number): TrustBand {
  if (score < 0.4) return 'low';
  if (score < 0.7) return 'moderate';
  return 'high';
}
