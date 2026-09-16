/**
 * S117 — AI PROPOSAL METADATA + TOOL-ARGUMENT VALIDATION (advisory, pre-execution only).
 *
 * A thin, PURE module inside the canonical live AI architecture. It harvests only the pure,
 * side-effect-free semantics identified in the S116 census of packages/ai-runtime — token estimation
 * and Zod argument validation — and REUSES the existing authoritative pricing table (ai/pricing.ts,
 * `computeCostUsd`/`MODEL_PRICING`). It introduces NO second AI runtime, NO tool registry, NO agent
 * state, NO workflow engine, NO event system, NO memory system.
 *
 * WHAT IT DOES: given an AI proposal's model + text (+ optionally a proposed tool's OWN Zod schema and
 * the AI-supplied raw arguments), it (1) validates the arguments and returns STRUCTURED errors, and
 * (2) attaches an ESTIMATE of token/cost impact. It is ADVISORY and PRE-EXECUTION only.
 *
 * WHAT IT NEVER DOES — the safety boundary (each pinned in proposalValidation.test.ts):
 *   - it NEVER executes a tool (it only calls `schema.safeParse`);
 *   - it NEVER mutates any ERP/store/command-bus state (it imports only ./pricing + zod types);
 *   - it NEVER grants or carries authority — the metadata has NO roles/permissions/grants/tenant/
 *     confirmed fields; validity/cost are inert DATA that no authorization decision reads;
 *   - it NEVER selects a capability by name — the caller passes the TRUSTED tool's own schema; a tool
 *     name is a label only, never a lookup-to-execute;
 *   - it NEVER accepts a principal/tenant/authority argument, so an AI proposal cannot supply one;
 *   - it fails CLOSED — a missing/invalid schema, or unparseable args, yields ok=false, never ok=true;
 *   - cost is always `estimateOnly: true` and flagged `pricingKnown` — it is NEVER actual provider
 *     billing, and estimating requires NO network call and NO provider credential.
 *
 * Consequential execution stays on the existing governed path: AI proposal → governed tool → authn/
 * authz → business policy → approval → command → durable transaction → event/outbox → audit.
 */
import type { ZodType } from 'zod';
import { computeCostUsd, MODEL_PRICING } from './pricing';

/** Pure token ESTIMATE (~4 chars/token). Canonical home for the estimator (was a private copy in mockClient). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface AiCostEstimate {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD via the authoritative ai/pricing table. ESTIMATE ONLY — never actual provider billing. */
  costUsd: number;
  /** true iff the model exists in MODEL_PRICING; false ⇒ costUsd is 0 because pricing is unknown, not free. */
  pricingKnown: boolean;
  estimateOnly: true;
}

/** Estimate token/cost impact for a proposal. Reuses computeCostUsd — never a second pricing table. */
export function estimateProposalCost(model: string, promptTokens: number, completionTokens: number): AiCostEstimate {
  const p = Math.max(0, Math.floor(promptTokens) || 0);
  const c = Math.max(0, Math.floor(completionTokens) || 0);
  return {
    model,
    promptTokens: p,
    completionTokens: c,
    totalTokens: p + c,
    costUsd: computeCostUsd(model, p, c),
    pricingKnown: Object.prototype.hasOwnProperty.call(MODEL_PRICING, model),
    estimateOnly: true,
  };
}

export interface AiArgError {
  /** dotted path to the offending field ('' = root). */
  path: string;
  message: string;
  code: string;
}
export interface AiToolArgValidation {
  toolName: string;
  ok: boolean;
  errors: AiArgError[];
}

/** A Zod-like schema: anything exposing a safeParse. The caller supplies the TRUSTED tool's own schema. */
interface SafeParseable {
  safeParse: (v: unknown) => { success: true; data: unknown } | { success: false; error: { issues?: Array<{ path?: Array<string | number>; message?: string; code?: string }> } };
}
function isSafeParseable(s: unknown): s is SafeParseable {
  return !!s && typeof (s as { safeParse?: unknown }).safeParse === 'function';
}

/**
 * Validate AI-proposed tool arguments against the tool's OWN Zod schema. Pure; NEVER executes the tool.
 * Fail-closed: a missing/invalid schema returns ok=false. Returns structured, non-secret errors.
 */
export function validateToolArguments(toolName: string, schema: ZodType | undefined, rawArgs: unknown): AiToolArgValidation {
  if (!isSafeParseable(schema)) {
    return { toolName, ok: false, errors: [{ path: '', message: 'no schema available for this tool', code: 'no_schema' }] };
  }
  let result: ReturnType<SafeParseable['safeParse']>;
  try {
    result = schema.safeParse(rawArgs);
  } catch {
    // A schema that throws (e.g. a side-effecting refinement) fails CLOSED — never treated as valid.
    return { toolName, ok: false, errors: [{ path: '', message: 'schema evaluation failed', code: 'schema_error' }] };
  }
  if (result.success) return { toolName, ok: true, errors: [] };
  const errors: AiArgError[] = (result.error.issues ?? []).map((i) => ({
    path: (i.path ?? []).join('.'),
    message: i.message ?? 'invalid',
    code: i.code ?? 'invalid',
  }));
  return { toolName, ok: false, errors: errors.length > 0 ? errors : [{ path: '', message: 'invalid arguments', code: 'invalid' }] };
}

export interface AiProposalMetadata {
  estimate: AiCostEstimate;
  toolValidation?: AiToolArgValidation;
  /** marker: this object is advisory only and carries no authority. */
  advisory: true;
}

export interface ProposalMetadataInput {
  model: string;
  promptText: string;
  completionText?: string;
  /** the proposed tool: its name, its OWN trusted Zod schema, and the AI-supplied raw args. */
  tool?: { name: string; schema: ZodType | undefined; rawArgs: unknown };
}

/**
 * Build advisory pre-execution metadata for an AI proposal: an estimate plus (if a tool was proposed)
 * a structured argument validation. Attaching this to a proposal changes NO authorization decision —
 * it is inert data for the operator's review before the existing governance/confirmation step.
 */
export function buildProposalMetadata(input: ProposalMetadataInput): AiProposalMetadata {
  const estimate = estimateProposalCost(
    input.model,
    estimateTokens(input.promptText),
    input.completionText ? estimateTokens(input.completionText) : 0,
  );
  const meta: AiProposalMetadata = { estimate, advisory: true };
  if (input.tool) {
    meta.toolValidation = validateToolArguments(input.tool.name, input.tool.schema, input.tool.rawArgs);
  }
  return meta;
}
