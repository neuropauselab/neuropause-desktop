/**
 * S108 harvest (H2) — Multi-Signal Explainable Trust Model (ADVISORY).
 *
 * HARVESTED (adapted, not imported) from `packages/ckdl/src/trust.ts`. The source package is
 * unwired and sits on the parallel `@neuropause/*` infrastructure spine, so importing it would
 * drag in a second runtime (S106/S107 Rule 3). Only the explainable heuristic is harvested here,
 * re-implemented pure and dependency-light (no Clock, no governance, no ckdl import).
 *
 * TRUST IS ADVISORY. A trust score is an explainable heuristic indicator of EVIDENCE QUALITY —
 * never authority, permission, business approval, or authentication. This module has NO import
 * path to cst/, the execution gate, the command bus, RBAC/tenancy, or any ERP mutation; a trust
 * score can never admit, refuse, approve, or alter any governed decision. It is a pure function
 * over the signals its caller supplies.
 *
 * Semantics are harvested VERBATIM from the source (weights, freshness half-life, band
 * thresholds, caveats). Human approval and audit integrity are weighted ABOVE AI self-confidence
 * by design: a model's own certainty must not dominate trust.
 */

export interface TrustSignals {
  /** Reliability of the source type/channel, 0..1. */
  sourceReliability?: number;
  /** Timestamp (ms) of the underlying data — freshness decays with age. */
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

/** A single evidence item, minimally shaped for `assessEvidenceTrust` (no ckdl import). */
export interface TrustEvidenceItem {
  /** timestamp (ms). */
  at: number;
  verified: boolean;
  /** the source's self-reported confidence, 0..1 (e.g. an AI's). */
  sourceConfidence?: number;
  /** evidence type; 'human-input' contributes the human-approval signal. */
  type: string;
}

/** Half-life for freshness decay: 30 days. value = 0.5 ^ (age / halfLife). */
export const FRESHNESS_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** Weights harvested verbatim from ckdl/trust.ts — human > verified/audit > source/completeness > freshness > AI. */
export const TRUST_WEIGHTS = {
  sourceReliability: 1.0,
  freshness: 0.8,
  verified: 1.2,
  humanApproved: 1.5, // human approval carries the most weight
  aiConfidence: 0.6, // AI self-confidence carries the least
  auditIntact: 1.2,
  completeness: 1.0,
} as const;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function weightedAverage(parts: Array<{ value: number; weight: number }>): number {
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return 0;
  return parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
}

function band(score: number): TrustBand {
  if (score < 0.4) return 'low';
  if (score < 0.7) return 'moderate';
  return 'high';
}

/** Uppercase display label for a band — no new threshold invented, purely a render helper. */
export function trustBandLabel(b: TrustBand): 'LOW' | 'MODERATE' | 'HIGH' {
  return b === 'low' ? 'LOW' : b === 'moderate' ? 'MODERATE' : 'HIGH';
}

/**
 * Assess trust from explicit signals. Pure and total. `now` defaults to Date.now() but callers
 * should pass it for determinism. Returns the score AND the full weighted breakdown AND a caveat
 * for every weak/absent signal, so a reader always sees WHY.
 */
export function assessTrust(signals: TrustSignals, options: { now?: number } = {}): TrustAssessment {
  const now = options.now ?? Date.now();
  const components: TrustComponent[] = [];
  const caveats: string[] = [];

  if (signals.sourceReliability !== undefined)
    components.push({ signal: 'sourceReliability', value: clamp01(signals.sourceReliability), weight: TRUST_WEIGHTS.sourceReliability, note: 'reliability of the source channel' });
  else caveats.push('source reliability not provided');

  if (signals.freshnessAt !== undefined) {
    const ageMs = Math.max(0, now - signals.freshnessAt);
    const value = clamp01(Math.pow(0.5, ageMs / FRESHNESS_HALF_LIFE_MS));
    components.push({ signal: 'freshness', value, weight: TRUST_WEIGHTS.freshness, note: `decays with age (half-life 30d); age ${Math.round(ageMs / 86_400_000)}d` });
    if (value <= 0.5) caveats.push('underlying data is stale');
  } else caveats.push('freshness unknown');

  if (signals.verified !== undefined) {
    components.push({ signal: 'verified', value: signals.verified ? 1 : 0, weight: TRUST_WEIGHTS.verified, note: signals.verified ? 'verified' : 'not verified' });
    if (!signals.verified) caveats.push('not independently verified');
  } else caveats.push('verification status unknown');

  if (signals.humanApproved !== undefined) {
    components.push({ signal: 'humanApproved', value: signals.humanApproved ? 1 : 0, weight: TRUST_WEIGHTS.humanApproved, note: signals.humanApproved ? 'human-approved' : 'no human approval' });
    if (!signals.humanApproved) caveats.push('no human approval on record');
  } else caveats.push('human approval unknown');

  if (signals.aiConfidence !== undefined)
    components.push({ signal: 'aiConfidence', value: clamp01(signals.aiConfidence), weight: TRUST_WEIGHTS.aiConfidence, note: 'AI self-reported confidence (weighted low)' });

  if (signals.auditIntact !== undefined) {
    components.push({ signal: 'auditIntact', value: signals.auditIntact ? 1 : 0, weight: TRUST_WEIGHTS.auditIntact, note: signals.auditIntact ? 'audit chain intact' : 'audit integrity NOT confirmed' });
    if (!signals.auditIntact) caveats.push('audit integrity not confirmed');
  } else caveats.push('audit integrity unknown');

  if (signals.completeness !== undefined) {
    const value = clamp01(signals.completeness);
    components.push({ signal: 'completeness', value, weight: TRUST_WEIGHTS.completeness, note: 'fraction of expected evidence present' });
    if (value < 0.6) caveats.push('evidence is incomplete');
  } else caveats.push('completeness unknown');

  const score = weightedAverage(components.map((c) => ({ value: c.value, weight: c.weight })));
  // Honest framing: this is a heuristic indicator, not a probability of correctness.
  caveats.push('heuristic indicator — not a probability of correctness');

  return { score, band: band(score), components, caveats };
}

/**
 * Derive trust signals from an evidence set and assess — ties trust to real evidence.
 * Mirrors ckdl `assessEvidence` semantics exactly.
 */
export function assessEvidenceTrust(
  evidence: TrustEvidenceItem[],
  extra: TrustSignals = {},
  options: { now?: number } = {},
): TrustAssessment {
  if (evidence.length === 0) {
    return assessTrust({ completeness: 0, ...extra }, options);
  }
  const verifiedShare = evidence.filter((e) => e.verified).length / evidence.length;
  const newest = Math.max(...evidence.map((e) => e.at));
  const aiConfidences = evidence.filter((e) => e.sourceConfidence !== undefined).map((e) => e.sourceConfidence!);
  const avgAi = aiConfidences.length ? aiConfidences.reduce((a, b) => a + b, 0) / aiConfidences.length : undefined;
  const hasHuman = evidence.some((e) => e.type === 'human-input');
  return assessTrust(
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
