/**
 * AI → structured M365 action proposal (Slice 8). Turns a VALIDATED capability selection + an authoritative human
 * principal + BOUNDED, UNTRUSTED AI-proposed parameters into a concrete, reviewable proposal for `M365WritePanel`.
 *
 * Constitutional boundary — the two field groups never mix:
 *   AUTHORITATIVE (from the validated selection + the trusted-runtime principal; the AI can NEVER set these):
 *     actionId (=capabilityId), connectorId, accountId, executor, principal (subject/tenant/workspace),
 *     requiresApproval, governanceStatus.
 *   AI-PROPOSED, UNTRUSTED DATA (validated + normalized here; never interpreted as instructions):
 *     purpose, and the mail.send review fields to / subject / body.
 *
 * This module is a PRODUCER of DATA. It performs NO effect. It never calls the M365 executor, m365Execute,
 * governedSend/governedAction, CST, admission, IPC, or any connector write; it never sets `confirmed`. The human
 * reviews the concrete fields in `M365WritePanel` and confirms — only then does the existing certified path run.
 * It composes on the Slice-6B `bindPrincipalToProposal` (no second proposal architecture) and fails closed: a
 * non-SELECTED capability, an unresolved principal, an unsupported action, or invalid params all yield NO proposal.
 *
 * First vertical slice: ONLY `mail.send`, and only its reviewable {to, subject, body} — the exact fields the
 * existing `M365WritePanel` renders. Nothing else (cc/bcc/html/attachments/other actions) is emitted.
 */
import type { ExecutorKind } from '@neuropause/shared';
import type { CapabilityExecutionAssurance, CapabilitySelectionOutcome } from './capabilityDiscoveryService';
import type { Principal, PrincipalResolution } from './capabilityPrincipal';
import { bindPrincipalToProposal } from './capabilityProposal';

const MAIL_SEND_ACTION = 'mail.send';
const MAX_RECIPIENTS = 50;
const MAX_SUBJECT = 255;
const MAX_BODY = 100_000;
/** Minimal syntactic shape — Microsoft Graph remains the authority; this only rejects obvious garbage. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The reviewable mail.send fields — AI-proposed, validated, normalized. */
export interface MailSendReview {
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
}

export interface M365ActionProposal {
  // ── AUTHORITATIVE (from the validated selection + principal; not from the AI) ──
  readonly actionId: string;
  readonly capabilityId: string; // === actionId — the same identity the executor resolves
  readonly connectorId: string;
  readonly accountId: string;
  readonly executor: ExecutorKind;
  readonly principal: Principal;
  readonly requiresApproval: boolean;
  readonly governanceStatus: CapabilityExecutionAssurance;
  // ── AI-PROPOSED, VALIDATED DATA ──
  readonly purpose: string | null;
  readonly review: MailSendReview;
  readonly provenance: 'ai-proposed';
}

export type M365ActionProposalReason =
  | 'PRINCIPAL_UNRESOLVED'
  | 'CAPABILITY_NOT_SELECTED'
  | 'UNSUPPORTED_ACTION'
  | 'INVALID_PARAMS';

export type M365ActionProposalResult =
  | { readonly ok: true; readonly proposal: M365ActionProposal }
  | { readonly ok: false; readonly reason: M365ActionProposalReason; readonly detail: string };

/**
 * Strip control characters so AI-proposed text is inert display data and cannot inject structure. Subject is
 * single-line (newlines dropped); body keeps \t (0x09), \n (0x0A), \r (0x0D). Uses a code-point filter — no
 * control characters appear in this source.
 */
function clean(text: string, keepNewlines: boolean): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f;
    const isKeptNewline = keepNewlines && (code === 0x09 || code === 0x0a || code === 0x0d);
    if (isControl && !isKeptNewline) continue;
    out += ch;
  }
  return out;
}

function normalizeRecipients(raw: unknown): { ok: true; value: string[] } | { ok: false; detail: string } {
  let list: unknown[];
  // In a STRING, a comma is the separator between addresses (split here). In an ARRAY, each element is ONE address,
  // so a comma inside an element is not a separator — it is a malformed address. We reject it (see the loop below):
  // `toWritePanelProposal` re-serializes recipients as a comma-joined string, so a comma buried in one address would
  // silently split into two on any downstream re-parse. Fail closed (S12 hardening; prerequisite for S13's AI `to`).
  let fromArray = false;
  if (typeof raw === 'string') list = raw.split(',');
  else if (Array.isArray(raw)) { list = raw; fromArray = true; }
  else return { ok: false, detail: 'to must be a string or an array of strings' };
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') return { ok: false, detail: 'to contains a non-string recipient' };
    const addr = clean(item, false).trim();
    if (addr.length === 0) continue;
    if (fromArray && addr.includes(',')) {
      return { ok: false, detail: `recipient must not contain a comma: ${addr.slice(0, 60)}` };
    }
    if (!EMAIL_RE.test(addr)) return { ok: false, detail: `invalid recipient: ${addr.slice(0, 60)}` };
    out.push(addr);
  }
  if (out.length === 0) return { ok: false, detail: 'at least one recipient is required' };
  if (out.length > MAX_RECIPIENTS) return { ok: false, detail: `too many recipients (>${MAX_RECIPIENTS})` };
  return { ok: true, value: out };
}

function normalizeText(
  raw: unknown,
  max: number,
  keepNewlines: boolean,
  field: string,
): { ok: true; value: string } | { ok: false; detail: string } {
  if (raw === undefined || raw === null) return { ok: true, value: '' }; // subject/body optional per canonical action
  if (typeof raw !== 'string') return { ok: false, detail: `${field} must be a string` };
  if (raw.length > max) return { ok: false, detail: `${field} exceeds ${max} characters` };
  return { ok: true, value: clean(raw, keepNewlines) };
}

function validateMailSendParams(
  params: Record<string, unknown>,
): { ok: true; value: MailSendReview } | { ok: false; detail: string } {
  for (const key of Object.keys(params)) {
    if (key !== 'to' && key !== 'subject' && key !== 'body') {
      return { ok: false, detail: `unsupported parameter: ${key}` };
    }
  }
  const to = normalizeRecipients(params.to);
  if (!to.ok) return to;
  const subject = normalizeText(params.subject, MAX_SUBJECT, false, 'subject');
  if (!subject.ok) return subject;
  const body = normalizeText(params.body, MAX_BODY, true, 'body');
  if (!body.ok) return body;
  return { ok: true, value: { to: to.value, subject: subject.value, body: body.value } };
}

/**
 * Build a structured, reviewable mail.send proposal. Fails closed on every non-SELECTED / unresolved-principal /
 * unsupported-action / invalid-params case. The AI's params (`params`) are UNTRUSTED and only ever populate the
 * review fields; the authoritative identity comes from `selection` + `principal`, never from `params`.
 */
export function buildM365ActionProposal(input: {
  readonly selection: CapabilitySelectionOutcome;
  readonly principal: PrincipalResolution;
  readonly params: Record<string, unknown>;
}): M365ActionProposalResult {
  const bound = bindPrincipalToProposal({ principal: input.principal, selection: input.selection });
  if (!bound.ok) return { ok: false, reason: bound.reason, detail: bound.detail };

  const { principal, binding, purpose } = bound.proposal;
  // First vertical slice: only the certified, reviewable mail.send surface.
  if (binding.executor !== 'm365' || binding.actionId !== MAIL_SEND_ACTION) {
    return { ok: false, reason: 'UNSUPPORTED_ACTION', detail: `${binding.executor}:${binding.actionId}` };
  }

  const review = validateMailSendParams(input.params);
  if (!review.ok) return { ok: false, reason: 'INVALID_PARAMS', detail: review.detail };

  return {
    ok: true,
    proposal: {
      actionId: binding.actionId,
      capabilityId: binding.actionId,
      connectorId: binding.connectorId,
      accountId: binding.accountId,
      executor: binding.executor,
      principal,
      requiresApproval: binding.requiresApproval,
      governanceStatus: binding.governanceStatus,
      purpose,
      review: review.value,
      provenance: 'ai-proposed',
    },
  };
}

/** Project the proposal onto the exact shape `M365WritePanel.proposal` accepts (review fields only). */
export function toWritePanelProposal(proposal: M365ActionProposal): { to: string; subject: string; body: string } {
  return { to: proposal.review.to.join(', '), subject: proposal.review.subject, body: proposal.review.body };
}
