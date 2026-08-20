/**
 * NP-010 §5 — THE BRAIN OVER BUSINESS DATA: the SEEING and the PROPOSING,
 * never the reaching.
 *
 * `composeBusinessFacts` turns the invoice register into provenanced facts with
 * the Live Brain's five-valued certainty — reusing the CERTIFIED pure aging
 * core (`deriveArAging`) rather than inventing a second overdue engine. A fact
 * is never more certain than its source: records ingested from an
 * unverified-source file yield KNOWN facts (the register says this), NEVER
 * VERIFIED (nothing corroborated them). A missing store is UNAVAILABLE — the
 * Brain sees honest absence, not fake zeros (§2#9).
 *
 * `draftOverdueReminder` builds the mail.send PROPOSAL CANDIDATE for one fact —
 * deterministic, zero-model, data only. The recipient comes ONLY from the
 * operator's mandate: the fact's party name is EVIDENCE, and evidence never
 * becomes authority (§2#6/#15) — the builder REFUSES to auto-fill `to` from
 * record data, pinned below.
 *
 * PRODUCTION TRIGGER — EXPLICIT GATE (§4 no-orphan rule): these composers gain
 * their production caller only AFTER the S5.4 ceremony (NP-000), when the
 * proposal class may ride the certified mail.send path through the EXISTING
 * lane (proposal → ASK → confirm → CST → FG-10 → guard). Wiring them into
 * `brainProposeLane`/`capabilityProposeIpc` is that entry gate — recorded in
 * WORK_QUEUE NP-010 §5, not silently skipped.
 *
 * ZERO AUTHORITY (§2#13): types + two pure shared cores only; no executor
 * value, no kernel value, no send-transition value, no confirmation flag —
 * source-pinned in businessFacts.test.ts.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import { deriveArAging, invoiceFromRecord } from '@neuropause/shared';
import type { Certainty } from './liveBrainState';

export interface BusinessFactProvenance {
  readonly moduleId: 'finance';
  readonly recordId: string;
  /** The NP-010 §2 honesty label carried by the record ('unverified-source' today). */
  readonly sourceTrust: string;
  /** Where the record came from: the import file, 'connector sync', or 'entered in app'. */
  readonly source: string;
}

export interface OverdueInvoiceFact {
  readonly kind: 'overdue_invoice';
  readonly invoiceNumber: string;
  readonly party: string;
  readonly outstanding: number;
  readonly daysOverdue: number;
  readonly dueDate: string;
  readonly certainty: Certainty;
  readonly provenance: BusinessFactProvenance;
}

export interface BusinessFacts {
  /** UNAVAILABLE when the register cannot be read; KNOWN otherwise. */
  readonly certainty: Extract<Certainty, 'KNOWN' | 'UNAVAILABLE'>;
  readonly facts: readonly OverdueInvoiceFact[];
  /** How many register records the pass looked at — the lineage the tile law requires. */
  readonly scanned: number;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function provenanceOf(record: EnterpriseEntity): BusinessFactProvenance {
  const meta = record.metadata ?? {};
  const file = str(meta.importSourceFile);
  const source = file
    ? file
    : str(meta.connectorId) || record.tags?.includes('synced')
      ? 'connector sync'
      : 'entered in app';
  return {
    moduleId: 'finance',
    recordId: record.id,
    sourceTrust: str(meta.importSourceTrust) || 'unverified-source',
    source,
  };
}

/**
 * The seeing. Pure; reuses the certified aging derivation for what "overdue"
 * means, then joins each overdue row back to its record for provenance.
 */
export function composeBusinessFacts(deps: {
  invoices: () => readonly EnterpriseEntity[] | null;
  nowIso: string;
}): BusinessFacts {
  const records = deps.invoices();
  if (records === null) return { certainty: 'UNAVAILABLE', facts: [], scanned: 0 };

  const nowMs = Date.parse(deps.nowIso);
  const aging = deriveArAging(records.map(invoiceFromRecord), nowMs);
  const byNumber = new Map(records.map((r) => [str(r.fields.number), r] as const));

  const facts: OverdueInvoiceFact[] = [];
  for (const row of aging.rows) {
    if (row.bucket === 'current') continue; // not overdue — not a fact of this kind
    const record = byNumber.get(row.invoiceNumber);
    if (!record) continue; // row without a record cannot carry provenance — no provenance, no fact
    const provenance = provenanceOf(record);
    facts.push({
      kind: 'overdue_invoice',
      invoiceNumber: row.invoiceNumber,
      party: row.customer,
      outstanding: row.outstanding,
      daysOverdue: row.daysOverdue,
      dueDate: row.dueDate,
      // A fact is never more certain than its source: 'verified' records would
      // yield VERIFIED facts — no path produces them today (§2 pin), so every
      // fact is honestly KNOWN.
      certainty: provenance.sourceTrust === 'verified' ? 'VERIFIED' : 'KNOWN',
      provenance,
    });
  }
  facts.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { certainty: 'KNOWN', facts, scanned: records.length };
}

/* ── The proposing ─────────────────────────────────────────────────────────── */

export interface ReminderCandidate {
  readonly ok: true;
  readonly capabilityId: 'mail.send';
  readonly params: { readonly to: string; readonly subject: string; readonly body: string };
  readonly purpose: string;
  readonly evidence: BusinessFactProvenance;
}

export interface ReminderRefusal {
  readonly ok: false;
  readonly reason: 'RECIPIENT_REQUIRES_OPERATOR_MANDATE';
  readonly detail: string;
}

/**
 * The proposing. Deterministic, zero-model. `mandate.to` is the OPERATOR'S
 * word — this builder never derives a recipient from the fact, the party, or
 * any record content, because evidence is not authority.
 */
export function draftOverdueReminder(
  fact: OverdueInvoiceFact,
  mandate: { to: string },
): ReminderCandidate | ReminderRefusal {
  const to = mandate.to.trim();
  if (!to) {
    return {
      ok: false,
      reason: 'RECIPIENT_REQUIRES_OPERATOR_MANDATE',
      detail:
        'A reminder recipient comes only from the operator — record data (including the party name) is evidence, never a recipient.',
    };
  }
  const amount = fact.outstanding.toLocaleString('en-US');
  return {
    ok: true,
    capabilityId: 'mail.send',
    params: {
      to,
      subject: `Payment reminder — invoice ${fact.invoiceNumber} (${fact.daysOverdue} days past due)`,
      body:
        `Invoice ${fact.invoiceNumber} to ${fact.party} has ${amount} outstanding and was due on ${fact.dueDate} ` +
        `(${fact.daysOverdue} days past due).\n\n` +
        `This draft was derived from the invoice register (record source: ${fact.provenance.source}, ` +
        `${fact.provenance.sourceTrust}). Please review before approving — nothing is sent without your confirmation.`,
    },
    purpose: `Collections follow-up on overdue invoice ${fact.invoiceNumber}`,
    evidence: fact.provenance,
  };
}
