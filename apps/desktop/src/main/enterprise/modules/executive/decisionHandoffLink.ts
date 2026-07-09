/**
 * Decision → Execution handoff link — the ONE controlled step that turns a VERIFIED executive decision
 * into an inert Execution Proposal routed to the single responsible module. It is the executive layer's
 * only write into an operational domain, and it writes nothing operational: it authorizes the dedicated
 * `executive:execute` scope, asks the deterministic router which module owns the decision, creates an
 * INERT draft there (validated by that module's OWN descriptor/hook), and records a proposal that a
 * human must confirm. Nothing runs — the draft is a `void` movement / a `draft` request-or-routing / a
 * `scheduled`-but-unstarted schedule-or-work-order until the responsible team executes it through the
 * domain module that owns that authority. Pure orchestration over the framework; no store of its own.
 */
import type { ExecutiveDecisionRecord } from '@neuropause/shared';
import {
  EXECUTION_PROPOSALS_MODULE_ID,
  EXECUTIVE_EXECUTE,
  deriveRecordTitle,
  proposalDraftFields,
  proposalRecordFields,
  routeDecision,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';

/** The successful outcome of a handoff — the created proposal + the inert draft it governs. */
export interface HandoffOutcome {
  ok: true;
  proposalId: string;
  proposalNumber: string;
  targetModuleId: string;
  proposalType: string;
  draftId: string;
}

/** A handoff failure — a discriminated (`ok: false`) result assignable to a framework action result. */
export interface HandoffFailure {
  ok: false;
  message?: string;
  error?: string;
}

/**
 * Hand a verified decision off to execution: authorize `executive:execute`, route it to the responsible
 * module, create the inert draft there, and create the (pending-confirmation) proposal that governs it.
 * Returns the outcome on success, or a framework action-result failure. Creates ONLY proposal + draft
 * records; never mutates the Digital Twin, the Decision Engine, or the Approval report. Idempotency is
 * enforced by the caller (the decision is stamped `handedOff` so it cannot be handed off twice).
 */
export async function handoffToProposal(
  decision: ExecutiveDecisionRecord,
  ctx: EnterpriseModuleActionContext,
): Promise<HandoffOutcome | HandoffFailure> {
  // The single execution gate — only an executive user (executive:execute), only a verified decision.
  ctx.authorize(EXECUTIVE_EXECUTE);

  const route = routeDecision(decision);
  const targetModule = ctx.moduleFor(route.targetModuleId);
  if (!targetModule) {
    return { ok: false, message: `The responsible module "${route.targetModuleId}" is not available; nothing was created.` };
  }
  const proposals = ctx.moduleFor(EXECUTION_PROPOSALS_MODULE_ID);
  if (!proposals) {
    return { ok: false, message: 'The Execution Proposals module is not available; nothing was created.' };
  }
  await targetModule.store.load();
  await proposals.store.load();

  // 1) Create the INERT draft in the responsible module, validated by ITS own descriptor/hook. No
  //    domain scope is asserted here — the draft changes nothing; the domain scope gates the real run.
  const draftValidation = targetModule.hooks.validate({ fields: proposalDraftFields(route.proposalType, decision) });
  if (!draftValidation.ok) {
    return { ok: false, error: `Draft ${route.proposalType}: ${Object.values(draftValidation.errors)[0] ?? 'invalid input'}` };
  }
  const draft = targetModule.store.create({
    title: deriveRecordTitle(targetModule.descriptor, draftValidation.values),
    fields: draftValidation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(targetModule, 'created', draft);

  // 2) Create the proposal record (pending human confirmation) that governs that draft.
  const proposalValidation = proposals.hooks.validate({
    fields: proposalRecordFields(decision, route, draft.id, ctx.actor() ?? '', ctx.now()),
  });
  if (!proposalValidation.ok) {
    return { ok: false, error: `Proposal: ${Object.values(proposalValidation.errors)[0] ?? 'invalid input'}` };
  }
  const proposal = proposals.store.create({
    title: deriveRecordTitle(proposals.descriptor, proposalValidation.values),
    fields: proposalValidation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(proposals, 'created', proposal);

  return {
    ok: true,
    proposalId: proposal.id,
    proposalNumber: proposal.title,
    targetModuleId: route.targetModuleId,
    proposalType: route.proposalType,
    draftId: draft.id,
  };
}
