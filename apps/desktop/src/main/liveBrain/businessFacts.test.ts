/**
 * NP-010 §5 pins — the Brain SEES business data and PROPOSES; it never reaches,
 * and evidence never becomes authority.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EnterpriseEntity } from '@neuropause/shared';
import { composeBusinessFacts, draftOverdueReminder, type OverdueInvoiceFact } from './businessFacts';

const NOW = '2026-08-20T00:00:00.000Z';

function invoiceRecord(
  number: string,
  over: Partial<Record<string, unknown>> = {},
  metadata: Record<string, unknown> = {},
): EnterpriseEntity {
  return {
    id: `rec_${number}`,
    title: number,
    fields: {
      number,
      customer: 'Acme Ltd',
      amount: 1000,
      taxRate: 0,
      amountPaid: 0,
      status: 'issued',
      issueDate: '2026-06-01',
      dueDate: '2026-07-01', // 50 days past due at NOW
      ...over,
    },
    tags: [],
    metadata,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 't',
    updatedBy: 't',
  } as unknown as EnterpriseEntity;
}

describe('composeBusinessFacts — the seeing', () => {
  it('an unreadable register is UNAVAILABLE — honest absence, never fake zero facts', () => {
    const out = composeBusinessFacts({ invoices: () => null, nowIso: NOW });
    expect(out.certainty).toBe('UNAVAILABLE');
    expect(out.facts).toEqual([]);
    expect(out.scanned).toBe(0);
  });

  it('derives overdue facts through the certified aging core, provenance carried verbatim', () => {
    const out = composeBusinessFacts({
      invoices: () => [
        invoiceRecord('INV-1', {}, { importSourceFile: 'tally-export.csv', importSourceTrust: 'unverified-source' }),
        invoiceRecord('INV-2', { dueDate: '2026-09-01' }), // not yet due
        invoiceRecord('INV-3', { amountPaid: 1000 }), // settled — no outstanding
      ],
      nowIso: NOW,
    });
    expect(out.certainty).toBe('KNOWN');
    expect(out.scanned).toBe(3);
    expect(out.facts).toHaveLength(1);
    const fact = out.facts[0]!;
    expect(fact.invoiceNumber).toBe('INV-1');
    expect(fact.party).toBe('Acme Ltd');
    expect(fact.daysOverdue).toBe(50);
    expect(fact.provenance.source).toBe('tally-export.csv');
    expect(fact.provenance.sourceTrust).toBe('unverified-source');
  });

  it('a fact is never more certain than its source — unverified records yield KNOWN, never VERIFIED', () => {
    const out = composeBusinessFacts({
      invoices: () => [invoiceRecord('INV-1', {}, { importSourceFile: 'f.csv', importSourceTrust: 'unverified-source' }), invoiceRecord('INV-9')],
      nowIso: NOW,
    });
    for (const f of out.facts) expect(f.certainty).toBe('KNOWN');
  });
});

describe('draftOverdueReminder — the proposing', () => {
  const fact = (): OverdueInvoiceFact =>
    composeBusinessFacts({
      invoices: () => [invoiceRecord('INV-7', { customer: 'billing@acme.example' })],
      nowIso: NOW,
    }).facts[0]!;

  it('REFUSES without an operator mandate — the party (even an email-shaped one) is evidence, never a recipient', () => {
    const out = draftOverdueReminder(fact(), { to: '' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('RECIPIENT_REQUIRES_OPERATOR_MANDATE');
    // The refusal is total: no candidate object exists that carries the
    // record's email-shaped party as `to`.
  });

  it('drafts deterministically from the operator mandate, with the fact as cited evidence', () => {
    const out = draftOverdueReminder(fact(), { to: 'neuropause033@gmail.com' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.capabilityId).toBe('mail.send');
      expect(out.params.to).toBe('neuropause033@gmail.com');
      expect(out.params.to).not.toBe('billing@acme.example');
      expect(out.params.subject).toBe('Payment reminder — invoice INV-7 (50 days past due)');
      expect(out.params.body).toContain('unverified-source');
      expect(out.params.body).toContain('nothing is sent without your confirmation');
      expect(out.evidence.recordId).toBe('rec_INV-7');
    }
  });
});

describe('§2#13 purity — the Brain never reaches', () => {
  it('ZERO-RUNTIME-IMPORT — no executor / CST / governedSend / confirmed in the business-facts module', () => {
    const src = readFileSync(join(__dirname, 'businessFacts.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/connectors\//);
    expect(src).not.toMatch(/from '\.\.\/cst\//);
    expect(src).not.toMatch(/governedSend/);
    expect(src).not.toMatch(/createM365Executor/);
    expect(src).not.toMatch(/confirmed:/);
  });
});
