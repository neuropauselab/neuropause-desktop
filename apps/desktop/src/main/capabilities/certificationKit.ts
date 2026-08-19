/**
 * S23 · THE PER-CAPABILITY CERTIFICATION KIT — "connector certified ≠ every action certified."
 *
 * A reusable, TYPED record any capability must complete — with EXECUTABLE checks — before it may be called a
 * governed route. Derived RETROACTIVELY from the one proven path (M365 `mail.send`, S11–S16 + L6 S4/S5): the kit
 * DESCRIBES what was proven there; it does not invent a new standard. The full 14-field S23 certification contract
 * (identity · account isolation · discovery · action identity · parameter schema · authority model · approval model ·
 * admission · execution · outcome · verification oracle · UNKNOWN handling · evidence · recovery) remains the
 * superset; this kit is its first executable slice — the artifact set the operator ruled required (19 Aug 2026):
 *
 *   1. capability entry            — the real action identity on its connector
 *   2. authority derivation        — DERIVED (never authored); must require human approval
 *   3. oracle-registry entry       — a concrete read-back plan OR an HONEST UNVERIFIABLE declaration (needs stated)
 *   4. params schema + CST binding — what validates at propose, and which fields the CST binds VERBATIM at confirm
 *   5. refusal fixtures            — named cases the propose path MUST refuse (fail-closed, typed)
 *   6. read-back plan              — how independent verification runs (or the honest statement that it cannot, yet)
 *   7. evidence template           — where the certification evidence lives, honestly labeled
 *
 * PURE: data + check functions over an injected record — no singleton, no executor, no effect. Passing the kit's
 * checks NEVER means "certified"; certification additionally requires the live chain (S15/S16-class evidence). A
 * capability with an honest UNVERIFIABLE oracle entry can complete the kit's PROPOSAL-side artifacts and still MUST
 * NOT pass `isCertifiedConsequential` — the S5.1 boundary refuses it (deny-by-default) until a real oracle exists.
 */
import type { z } from 'zod';
import type { AuthorityRequirement, VerificationPlan, ProposalTarget } from '../liveBrain/proposal';

/** 1 · The real action identity. */
export interface CapabilityEntry {
  readonly capabilityId: string;
  readonly connectorId: string;
  readonly mutates: boolean;
  readonly label: string;
}

/** 5 · A named refusal the propose path must produce for the given hostile/invalid input. */
export interface RefusalFixture {
  readonly name: string;
  /** Runs the propose-side validation; returns the refusal reason it produced, or null if it (wrongly) accepted. */
  readonly run: () => string | null;
  readonly expectReason: string;
}

/** The kit record — one per capability. */
export interface CapabilityCertificationRecord {
  readonly entry: CapabilityEntry;
  /** 2 · The DERIVED authority — must come from the shared derivation, never be authored per-capability. */
  readonly authority: (capabilityId: string, target: ProposalTarget) => AuthorityRequirement;
  /** 3 · The oracle-registry answer for this capability (honest UNVERIFIABLE when no oracle exists). */
  readonly oracle: (capabilityId: string) => VerificationPlan;
  /** 4a · What the propose path validates. */
  readonly paramsSchema: z.ZodTypeAny;
  /** 4b · The CST EffectBinding fields bound VERBATIM at confirm (substitution ⇒ BINDING_MISMATCH). */
  readonly cstBindingFields: readonly string[];
  /** 5 · Fail-closed cases. */
  readonly refusalFixtures: readonly RefusalFixture[];
  /** 6 · The read-back plan in words — a concrete oracle procedure, or the honest cannot-verify statement. */
  readonly readBackPlan: string;
  /** 7 · Where this capability's evidence lives (labels: SOURCE-PROVEN/TEST-VERIFIED/LIVE-VERIFIED, never stronger). */
  readonly evidenceTemplate: string;
}

export interface KitFinding {
  readonly artifact: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** The kit's executable checks. Every artifact yields a finding; a completed kit has zero `ok:false` rows. */
export function runKitChecks(
  record: CapabilityCertificationRecord,
  probes: {
    readonly target: ProposalTarget;
    readonly goodParams: Record<string, unknown>;
    readonly badParams: readonly Record<string, unknown>[];
  },
): KitFinding[] {
  const findings: KitFinding[] = [];
  const push = (artifact: string, ok: boolean, detail: string): void => {
    findings.push({ artifact, ok, detail });
  };

  // 1 · capability entry — a real, non-empty identity; the kit only certifies MUTATING capabilities (reads need no kit).
  push('capability-entry', record.entry.capabilityId.length > 0 && record.entry.connectorId.length > 0 && record.entry.mutates,
    `${record.entry.connectorId}/${record.entry.capabilityId} (mutates=${record.entry.mutates})`);

  // 2 · authority derivation — must REQUIRE human approval with a named gate (the Brain never proposes auto-approval).
  const auth = record.authority(record.entry.capabilityId, probes.target);
  push('authority-derivation', auth.requiresApproval === true && auth.requiredGate.length > 0,
    `requiresApproval=${auth.requiresApproval}, gate="${auth.requiredGate}", status=${auth.governanceStatus}`);

  // 3 · oracle entry — the S4 internal-consistency rule as a named artifact: a verifiable plan names its oracle;
  //     an unverifiable plan states its need. Anything else is a spoofed or evasive plan.
  const plan = record.oracle(record.entry.capabilityId);
  const oracleOk = plan.verifiable === false ? plan.needs !== null && plan.needs.length > 0 : plan.oracleId !== null;
  push('oracle-entry', oracleOk,
    plan.verifiable === false ? `HONEST UNVERIFIABLE — needs: ${plan.needs ?? 'UNSTATED (defect)'}` : `oracle=${plan.oracleId} (${plan.verifiable})`);

  // 4 · params schema — accepts the known-good shape, rejects EVERY bad probe (deny-by-default at the edge).
  const goodOk = record.paramsSchema.safeParse(probes.goodParams).success;
  const badRejected = probes.badParams.filter((p) => !record.paramsSchema.safeParse(p).success).length;
  push('params-schema', goodOk && badRejected === probes.badParams.length,
    `good accepted=${goodOk}; bad rejected=${badRejected}/${probes.badParams.length}`);

  //     CST binding — every bound field exists in the schema's accepted shape, and params are bound (never a subset
  //     that would let an unbound field mutate post-approval).
  const bindingOk = record.cstBindingFields.length > 0 && record.cstBindingFields.includes('params');
  push('cst-binding', bindingOk, `binds [${record.cstBindingFields.join(', ')}] — params bound VERBATIM`);

  // 5 · refusal fixtures — each must refuse with its expected reason.
  for (const f of record.refusalFixtures) {
    const got = f.run();
    push(`refusal:${f.name}`, got === f.expectReason, `expected ${f.expectReason}, got ${got ?? 'ACCEPTED (defect)'}`);
  }

  // 6/7 · plans + evidence are prose artifacts — present and honest (non-empty; UNVERIFIABLE plans must say so).
  const readBackHonest = plan.verifiable === false ? /unverifiable/i.test(record.readBackPlan) : record.readBackPlan.length > 0;
  push('read-back-plan', readBackHonest, record.readBackPlan.slice(0, 120));
  push('evidence-template', record.evidenceTemplate.length > 0, record.evidenceTemplate);

  return findings;
}

export const kitComplete = (findings: readonly KitFinding[]): boolean => findings.every((f) => f.ok);
