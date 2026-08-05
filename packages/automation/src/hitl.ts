/**
 * Module 8 — Human-in-the-Loop AI. The constitutional gate: "Automation assists people.
 * Automation does NOT replace governance. No autonomous execution outside policy." AI may
 * recommend / draft / summarize / prioritize / detect-risk / suggest-action; AI may NOT
 * approve contracts, delete data, grant permissions, or execute high-risk operations
 * without EXPLICIT human approval. This gate classifies operations and enforces that rule,
 * and every AI recommendation must be evidence-backed.
 */
import { computeConfidence, type EvidenceRef } from '@neuropause/intelligence';
import { AI_ALLOWED_OPERATIONS, HUMAN_REQUIRED_OPERATIONS, type RiskTier } from './constants';

export interface OperationClass {
  operation: string;
  tier: RiskTier;
  aiAllowed: boolean;
}

export interface GuardResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export interface Recommendation {
  operation: string;
  rationale: string;
  evidence: EvidenceRef[];
  confidence: number;
}

const AI_ALLOWED = new Set<string>(AI_ALLOWED_OPERATIONS);
const HUMAN_REQUIRED = new Set<string>(HUMAN_REQUIRED_OPERATIONS);

export class HumanInTheLoopGate {
  private readonly catalog = new Map<string, OperationClass>();

  constructor(extra: OperationClass[] = []) {
    for (const op of AI_ALLOWED_OPERATIONS) this.catalog.set(op, { operation: op, tier: 'low', aiAllowed: true });
    for (const op of HUMAN_REQUIRED_OPERATIONS) this.catalog.set(op, { operation: op, tier: 'restricted', aiAllowed: false });
    for (const op of extra) this.catalog.set(op.operation, op);
  }

  classify(operation: string): OperationClass {
    const known = this.catalog.get(operation);
    if (known) return known;
    if (HUMAN_REQUIRED.has(operation)) return { operation, tier: 'restricted', aiAllowed: false };
    if (AI_ALLOWED.has(operation)) return { operation, tier: 'low', aiAllowed: true };
    // unknown operations default to medium risk, AI-disallowed (safe default)
    return { operation, tier: 'medium', aiAllowed: false };
  }

  /** Enforce the policy. AI-initiated restricted/high-risk operations need human approval. */
  guard(input: { operation: string; aiInitiated: boolean; humanApproved?: boolean }): GuardResult {
    const cls = this.classify(input.operation);
    const highRisk = cls.tier === 'high' || cls.tier === 'restricted';
    if (!input.aiInitiated) {
      if (highRisk && !input.humanApproved) return { allowed: false, requiresApproval: true, reason: `'${input.operation}' is ${cls.tier}-risk and requires explicit approval` };
      return { allowed: true, requiresApproval: highRisk, reason: 'human-initiated' };
    }
    if (cls.aiAllowed) return { allowed: true, requiresApproval: false, reason: `AI may '${input.operation}' (assistive)` };
    if (input.humanApproved) return { allowed: true, requiresApproval: true, reason: `human-approved AI '${input.operation}'` };
    return { allowed: false, requiresApproval: true, reason: `AI may not '${input.operation}' without explicit human approval` };
  }

  /** An AI recommendation MUST be evidence-backed. */
  recommend(operation: string, rationale: string, evidence: EvidenceRef[]): Recommendation {
    if (evidence.length === 0) throw new Error(`AI recommendation for '${operation}' requires evidence`);
    return { operation, rationale, evidence, confidence: computeConfidence(evidence).score };
  }
}
