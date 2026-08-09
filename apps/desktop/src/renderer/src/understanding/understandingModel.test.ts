/**
 * The Understand screen's model — the rules that keep the profile honest.
 *
 * The property that matters most: an INFERENCE never becomes a fact by
 * accident. It can only be promoted by a person, and the promotion has to stay
 * visible afterwards. Everything else on the screen is presentation; this is
 * the part that would let the product quietly start lying about the user.
 */
import { describe, expect, it } from 'vitest';
import type { UnderstandingAttribute } from '@neuropause/shared';
import { groupUnderstanding, understandingCoverage } from '@neuropause/shared';
import {
  confirmationPatch,
  correctionPatch,
  deriveSystemAttributes,
  isEditable,
  manualAttribute,
} from './understandingModel';

const AT = '2026-08-09T12:00:00.000Z';

const inferred: UnderstandingAttribute = {
  key: 'domain',
  label: 'You work on',
  value: 'Manufacturing',
  status: 'inferred',
  source: 'Inferred from your description: “we make parts”',
  updatedAt: AT,
};

describe('deriveSystemAttributes', () => {
  it('says nothing when there is nothing real to say', () => {
    expect(deriveSystemAttributes({ populatedModules: [], connectedAccounts: [] }, AT)).toEqual([]);
  });

  it('empty modules do not count as data', () => {
    const out = deriveSystemAttributes(
      { populatedModules: [{ moduleId: 'a', title: 'Customers', recordCount: 0 }], connectedAccounts: [] },
      AT,
    );
    expect(out).toEqual([]);
  });

  it('counts real records and names where they are', () => {
    const out = deriveSystemAttributes(
      {
        populatedModules: [
          { moduleId: 'a', title: 'Customers', recordCount: 12 },
          { moduleId: 'b', title: 'Invoices', recordCount: 40 },
        ],
        connectedAccounts: [],
      },
      AT,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe('system_derived');
    expect(out[0]!.value).toBe('52 records across 2 areas');
    // Largest first — the evidence line has to be checkable.
    expect(out[0]!.source).toContain('Largest: Invoices (40)');
  });

  it('does not claim a "largest" when every area holds the same count', () => {
    // Seen on a real install: "Largest: Finance (1), CRM (1), Quotes (1)".
    // With the counts tied there is no largest, and naming one implies a
    // ranking the data does not support.
    const out = deriveSystemAttributes(
      {
        populatedModules: [
          { moduleId: 'a', title: 'Finance', recordCount: 1 },
          { moduleId: 'b', title: 'CRM', recordCount: 1 },
          { moduleId: 'c', title: 'Quotes', recordCount: 1 },
        ],
        connectedAccounts: [],
      },
      AT,
    );
    expect(out[0]!.source).toContain('Across: ');
    expect(out[0]!.source).not.toContain('Largest');
  });

  it('a single record reads as a record, not "1 records"', () => {
    const out = deriveSystemAttributes(
      { populatedModules: [{ moduleId: 'a', title: 'Finance', recordCount: 1 }], connectedAccounts: [] },
      AT,
    );
    expect(out[0]!.value).toBe('1 record across 1 area');
  });

  it('says how many areas were left out rather than silently truncating', () => {
    const out = deriveSystemAttributes(
      {
        populatedModules: Array.from({ length: 6 }, (_, i) => ({
          moduleId: `m${i}`,
          title: `Area ${i}`,
          recordCount: 10 - i,
        })),
        connectedAccounts: [],
      },
      AT,
    );
    expect(out[0]!.source).toContain('and 3 more');
  });

  it('reports connections as `connected`, with the account count as evidence', () => {
    const out = deriveSystemAttributes(
      { populatedModules: [], connectedAccounts: [{ provider: 'Slack' }, { provider: 'Slack' }] },
      AT,
    );
    expect(out[0]!.status).toBe('connected');
    expect(out[0]!.value).toBe('Slack');
    expect(out[0]!.source).toContain('2 authenticated accounts');
  });
});

describe('correction and confirmation', () => {
  it('a correction is stamped `corrected` and remembers what was wrong', () => {
    const out = correctionPatch(inferred, 'Medical devices', AT);
    expect(out.status).toBe('corrected');
    expect(out.value).toBe('Medical devices');
    expect(out.source).toContain('Manufacturing');
  });

  it('an empty correction keeps the old value rather than blanking a belief', () => {
    expect(correctionPatch(inferred, '   ', AT).value).toBe('Manufacturing');
  });

  it('confirming is the ONE promotion to fact, and it stays auditable', () => {
    const out = confirmationPatch(inferred, AT);
    expect(out.status).toBe('stated');
    expect(out.source).toContain('You confirmed this');
    expect(out.source).toContain('Inferred from your description');
  });

  it('a hand-added attribute is `stated` with a stable, slugged key', () => {
    const out = manualAttribute('  Main Market ', ' Germany ', AT);
    expect(out.key).toBe('user.main-market');
    expect(out.label).toBe('Main Market');
    expect(out.value).toBe('Germany');
    expect(out.status).toBe('stated');
  });

  it('derived facts are not editable — they follow the data, not a text box', () => {
    expect(isEditable(inferred)).toBe(true);
    expect(isEditable({ ...inferred, status: 'system_derived' })).toBe(false);
    expect(isEditable({ ...inferred, status: 'connected' })).toBe(false);
  });
});

describe('grouping keeps inference visually separate from fact', () => {
  const attributes: UnderstandingAttribute[] = [
    { ...inferred, key: 'a', status: 'stated' },
    { ...inferred, key: 'b', status: 'inferred' },
    { ...inferred, key: 'c', status: 'system_derived' },
    { ...inferred, key: 'd', status: 'corrected' },
  ];

  it('orders confirmed → inferred → derived and drops empty groups', () => {
    expect(groupUnderstanding(attributes).map((g) => g.id)).toEqual([
      'confirmed',
      'needs_confirmation',
      'derived',
    ]);
    expect(groupUnderstanding([attributes[1]!]).map((g) => g.id)).toEqual(['needs_confirmation']);
  });

  it('counts confirmations honestly — an inference is not a confirmation', () => {
    expect(understandingCoverage(attributes)).toEqual({
      total: 4,
      confirmed: 2,
      awaitingConfirmation: 1,
    });
  });

  it('a confirmed inference moves group — the promotion is visible', () => {
    const promoted = confirmationPatch(attributes[1]!, AT);
    const groups = groupUnderstanding([promoted]);
    expect(groups[0]!.id).toBe('confirmed');
  });
});
