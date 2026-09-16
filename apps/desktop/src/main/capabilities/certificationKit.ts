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

/* ══════════════════════════════════════════════════════════════════════════════
 * NP-016 — THE 16-FIELD CAPABILITY RECORD (ARCHITECTURE-SPEC §23)
 *
 * The kit above answers "were the seven artifacts produced?". This answers a
 * different question: "what does this system actually KNOW about this
 * capability, and from where?" — the spec's §23 record, field by field.
 *
 * Every field carries a STATE, never a bare value, because the honest answers
 * are not all of one kind:
 *   KNOWN            a real value, WITH the source that yielded it
 *   CONFLICTING      two sources disagree — surfaced, never silently resolved
 *   ABSENT           nothing in this system supplies it, and why
 *   SOURCE_REQUIRED  the SPEC itself defines no value space for this field
 *
 * A value with no source cannot enter the record: `known()` demands one. And
 * `risk_class` / `lifecycle_state` are typed `never`, so the compiler refuses
 * any attempt to populate them — the field exists, its taxonomy waits for the
 * source (operator ruling, NP-016). That is not a stub; it is the difference
 * between "we don't know" and "we made one up", enforced rather than asked for.
 *
 * PURITY (load-bearing, as above): still zero runtime imports. Every real
 * reading is INJECTED by the caller that read it — this module classifies, it
 * never reaches.
 * ═════════════════════════════════════════════════════════════════════════ */

/** One reading of one field, from one named place in the running system. */
export interface FieldReading {
  readonly value: string;
  /** Where it was read — module path + export. A reading without one is not evidence. */
  readonly source: string;
}

export type CapabilityFieldState<T> =
  | { readonly state: 'KNOWN'; readonly value: T; readonly source: string }
  | { readonly state: 'CONFLICTING'; readonly readings: readonly FieldReading[]; readonly note: string }
  | { readonly state: 'ABSENT'; readonly why: string }
  | { readonly state: 'SOURCE_REQUIRED'; readonly needs: string };

export const known = <T>(value: T, source: string): CapabilityFieldState<T> => ({ state: 'KNOWN', value, source });
export const absent = (why: string): CapabilityFieldState<never> => ({ state: 'ABSENT', why });
export const sourceRequired = (needs: string): CapabilityFieldState<never> => ({ state: 'SOURCE_REQUIRED', needs });

/**
 * Classify a field from everything that was read for it. The rule that makes
 * the record worth building: agreeing readings CORROBORATE (KNOWN, sources
 * joined), disagreeing readings CONFLICT — and a conflict is reported, not
 * resolved by preference. Nothing read → ABSENT with the caller's reason.
 */
export function fromReadings(readings: readonly FieldReading[], whyIfNone: string): CapabilityFieldState<string> {
  if (readings.length === 0) return absent(whyIfNone);
  const distinct = [...new Set(readings.map((r) => r.value))];
  if (distinct.length === 1) {
    return known(distinct[0], readings.map((r) => r.source).join(' + '));
  }
  return {
    state: 'CONFLICTING',
    readings,
    note: `${distinct.length} sources disagree: ${distinct.map((v) => `"${v}"`).join(' vs ')}`,
  };
}

/** The §23 record. Field names mirror the spec's list, in the spec's order. */
export interface CapabilityRecord {
  readonly capabilityId: CapabilityFieldState<string>;
  readonly connectorId: CapabilityFieldState<string>;
  readonly version: CapabilityFieldState<string>;
  readonly inputSchema: CapabilityFieldState<string>;
  readonly outputSchema: CapabilityFieldState<string>;
  readonly preconditions: CapabilityFieldState<readonly string[]>;
  readonly sideEffects: CapabilityFieldState<readonly string[]>;
  /** §23 names it; the spec defines NO value space → unpopulatable by type. */
  readonly riskClass: CapabilityFieldState<never>;
  readonly scopeRequirements: CapabilityFieldState<readonly string[]>;
  readonly authorityRequirements: CapabilityFieldState<AuthorityRequirement>;
  readonly reversibility: CapabilityFieldState<string>;
  readonly executor: CapabilityFieldState<string>;
  readonly verificationMethod: CapabilityFieldState<string>;
  readonly oracleId: CapabilityFieldState<string>;
  /** §23 names it; no value space in the spec AND no source here → unpopulatable. */
  readonly lifecycleState: CapabilityFieldState<never>;
  readonly certificationState: CapabilityFieldState<string>;
}

/** What the CALLER read from the running system, each reading carrying its source. */
export interface CapabilityObservations {
  readonly kit: CapabilityCertificationRecord;
  readonly target: ProposalTarget;
  readonly version: readonly FieldReading[];
  readonly inputSchema: readonly FieldReading[];
  readonly outputSchema: readonly FieldReading[];
  readonly preconditions: readonly FieldReading[];
  readonly sideEffects: readonly FieldReading[];
  readonly scopeRequirements: readonly FieldReading[];
  readonly reversibility: readonly FieldReading[];
  readonly executor: readonly FieldReading[];
  readonly oracleId: readonly FieldReading[];
  readonly certificationState: readonly FieldReading[];
}

/**
 * Compose the §23 record from real readings. Authority and verification method
 * are taken from the kit's own DERIVATION FUNCTIONS (never authored per
 * capability — artifact 2's rule), so this record can never claim an authority
 * the runtime would not derive.
 */
export function composeCapabilityRecord(o: CapabilityObservations): CapabilityRecord {
  const plan = o.kit.oracle(o.kit.entry.capabilityId);
  const list = (readings: readonly FieldReading[], whyIfNone: string): CapabilityFieldState<readonly string[]> => {
    if (readings.length === 0) return absent(whyIfNone);
    return known(readings.map((r) => r.value), readings.map((r) => r.source).join(' + '));
  };
  return {
    capabilityId: known(o.kit.entry.capabilityId, 'certificationKit.entry (the connector\'s own action id)'),
    connectorId: known(o.kit.entry.connectorId, 'certificationKit.entry (the registered connector id)'),
    version: fromReadings(o.version, 'no per-capability version is modeled; the connector manifest version is NOT this capability\'s version and is not borrowed'),
    inputSchema: fromReadings(o.inputSchema, 'no input contract is declared for this capability'),
    outputSchema: fromReadings(o.outputSchema, 'no per-capability output schema is declared'),
    preconditions: list(o.preconditions, 'preconditions are enforced in code but nowhere enumerable'),
    sideEffects: list(o.sideEffects, 'no structured side-effect declaration exists beyond the mutates bit'),
    riskClass: sourceRequired('ARCHITECTURE-SPEC §23 names risk_class but defines no value space; the taxonomy must be sourced before the field can be specified (Part C)'),
    scopeRequirements: list(o.scopeRequirements, 'the action declares no scopes'),
    authorityRequirements: known(o.kit.authority(o.kit.entry.capabilityId, o.target), 'certificationKit.authority → the SHARED derivation (never authored)'),
    reversibility: fromReadings(o.reversibility, 'reversibility is not declared for this capability'),
    executor: fromReadings(o.executor, 'no executor is registered for this capability'),
    verificationMethod: plan.verifiable === false
      ? absent(`no verification method exists; the oracle registry states what is needed: ${plan.needs ?? 'UNSTATED (defect)'}`)
      : known(String(plan.verifiable), 'certificationKit.oracle → the shared oracle-registry derivation'),
    oracleId: fromReadings(o.oracleId, plan.verifiable === false
      ? `no oracle exists for this capability; needs: ${plan.needs ?? 'UNSTATED (defect)'}`
      : 'the oracle registry names no id (defect — a verifiable plan must name its oracle)'),
    lifecycleState: sourceRequired('ARCHITECTURE-SPEC §23 names lifecycle_state but defines no value space, and no capability lifecycle is modeled here (connector status and capability availability are per-account, not per-capability)'),
    certificationState: fromReadings(o.certificationState, 'nothing states whether this capability is certified'),
  };
}

/** Every field of the §23 record, as kit findings. */
export function capabilityRecordFindings(record: CapabilityRecord): KitFinding[] {
  return Object.entries(record).map(([field, st]) => {
    const s = st as CapabilityFieldState<unknown>;
    switch (s.state) {
      case 'KNOWN':
        return { artifact: `field:${field}`, ok: true, detail: `KNOWN — ${JSON.stringify(s.value)} (source: ${s.source})` };
      case 'CONFLICTING':
        // A conflict is a DEFECT, not a pass: two parts of the system disagree
        // about what this capability is, and a record that picked a winner
        // would hide exactly what it exists to reveal.
        return { artifact: `field:${field}`, ok: false, detail: `CONFLICTING — ${s.note}; readings: ${s.readings.map((r) => `${r.value} @ ${r.source}`).join(' | ')}` };
      case 'SOURCE_REQUIRED':
        return { artifact: `field:${field}`, ok: true, detail: `SOURCE_REQUIRED — ${s.needs}` };
      default:
        // An ABSENCE is honest only when it says why; a bare blank is not.
        return { artifact: `field:${field}`, ok: s.why.length > 0, detail: `ABSENT — ${s.why}` };
    }
  });
}

/** Fields whose readings disagree — the record's own defect list. */
export const conflictingFields = (record: CapabilityRecord): string[] =>
  Object.entries(record).filter(([, s]) => (s as CapabilityFieldState<unknown>).state === 'CONFLICTING').map(([f]) => f);
