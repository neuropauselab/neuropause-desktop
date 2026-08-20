/**
 * NP-017 — TYPED-RELATIONSHIP FIELD DETERMINATION (ARCHITECTURE-SPEC §21).
 *
 * The slice was queued as "field completion": add valid_from / valid_to /
 * source_evidence / confidence per link. The determination step found a
 * different picture, and these pins record it.
 *
 * THE LOAD-BEARING FACT: exactly ONE consequential decision consumes a typed
 * link — a governed record delete is REFUSED while an incoming link exists —
 * and it consumes the link's EXISTENCE, never any per-link attribute. That
 * makes `valid_to` not a metadata field but a **governance change**: a link
 * that can expire is a refusal that can lapse. These pins hold the current
 * enforcement still so that change cannot happen by accident.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessDeleteAgainstLinks, type IncomingLink } from '../decisions/decisionService';
import { RELATIONSHIPS } from './relationshipModel';

const MAIN = join(__dirname, '..');
const read = (...p: string[]): string => readFileSync(join(...p), 'utf8');

/* ───────────── the §21 field reality, measured against the real row ───────────── */

describe('NP-017 · §21 — what the link row actually carries today', () => {
  const store = read(MAIN, 'dataPlane', 'relationshipStore.ts');

  it('source / relationship_type / target are real fields on the row', () => {
    for (const f of ['sourceModuleId', 'sourceRecordId', 'relationshipKey', 'targetModuleId', 'targetRecordId']) {
      expect(store, f).toMatch(new RegExp(`\\b${f}:\\s*string`));
    }
  });

  it('CONFIDENCE IS PER-LINK — a numeric field on every row (correcting the mapping\'s earlier claim)', () => {
    // ARCHITECTURE-MAPPING previously recorded "confidence at classification,
    // not per-link". The source says otherwise: it is stored on the row.
    expect(store).toMatch(/\bconfidence:\s*number/);
  });

  it('source_evidence exists as a DE-NORMALIZED CLUSTER, not one field', () => {
    for (const f of ['sourceField', 'sourceValue', 'method', 'decidedBy', 'correlationId', 'reason']) {
      expect(store, f).toMatch(new RegExp(`\\b${f}:`));
    }
    // …but it carries no provenance-record identity and no source-trust label.
    expect(store).not.toMatch(/\bprovenanceId:/);
    expect(store).not.toMatch(/\bsourceTrust:/);
  });

  it('valid_from / valid_to are BELOW FIELD — absent from the row in every spelling', () => {
    for (const f of ['validFrom', 'valid_from', 'validTo', 'valid_to', 'effectiveFrom', 'effectiveTo']) {
      expect(store, f).not.toContain(f);
    }
  });

  it('`at` is LAST-RESOLVED-AT, not a validity start — it is overwritten on every re-resolution', () => {
    // link() preserves the id explicitly and spreads the rest, so `at` (and
    // method/confidence/decidedBy/reason) take the latest pass's values.
    expect(store).toMatch(/id:\s*existing\?\.id\s*\?\?/);
    expect(store).toMatch(/\.\.\.input/);
  });
});

/* ───────────── the ONE decision, and what it does NOT read ───────────── */

describe('NP-017 · the single consequential consumer — existence, never attributes', () => {
  const incoming = (over: Partial<IncomingLink> = {}): IncomingLink => ({
    relationshipKey: 'payment.invoice',
    label: 'Invoice',
    sourceModuleId: 'finance-payments',
    sourceModuleTitle: 'Payments',
    ...over,
  });

  it('THE DECISION LAYER CANNOT SEE a per-link attribute — the mapper hands it four descriptive fields', () => {
    // This is the structural fact behind everything else in this file: the
    // assessor is typed over IncomingLink, which carries relationshipKey,
    // label, sourceModuleId and sourceModuleTitle — and nothing else. There is
    // no confidence, no method, no decidedBy, no timestamp to branch on, so no
    // per-link attribute CAN change a delete verdict today.
    const svc = read(MAIN, 'decisions', 'decisionService.ts');
    const iface = svc.slice(svc.indexOf('export interface IncomingLink'), svc.indexOf('}', svc.indexOf('export interface IncomingLink')));
    for (const absent of ['confidence', 'method', 'decidedBy', 'at', 'validFrom', 'validTo', 'sourceValue']) {
      expect(iface, absent).not.toMatch(new RegExp(`\\b${absent}\\b`));
    }
    // …and the mapper that builds it drops them at the boundary.
    const core = read(MAIN, 'runtimeCore.ts');
    const callAt = core.indexOf('bindIncomingLinkReader((');   // the CALL, not the import
    expect(callAt).toBeGreaterThan(0);
    const mapper = core.slice(callAt, callAt + 700);
    expect(mapper).toMatch(/relationshipKey/);
    expect(mapper).not.toMatch(/confidence/);
    expect(mapper).not.toMatch(/\bmethod\b/);
  });

  it('ANY incoming link refuses the delete — one is enough, and a weaker one refuses exactly as hard', () => {
    const one = assessDeleteAgainstLinks('INV-1', [incoming()]);
    const other = assessDeleteAgainstLinks('INV-1', [incoming({ label: 'Shipment', sourceModuleId: 'ops-shipments' })]);
    expect(one?.risk).toBe('high_risk');
    expect(other?.risk).toBe('high_risk');
  });

  it('NO incoming link → no assessment — the refusal turns on EXISTENCE alone', () => {
    expect(assessDeleteAgainstLinks('INV-1', [])).toBeNull();
  });

  it('the assessor reads no temporal field — so no link can be "expired" past this gate today', () => {
    const src = read(MAIN, 'decisions', 'decisionService.ts');
    expect(src).not.toMatch(/\bvalidFrom|\bvalidTo|\bisExpired/);
    expect(src).not.toMatch(/\.confidence\s*[<>=]/);
  });
});

/* ───────────── the guard this slice exists to install ───────────── */

/**
 * THE VALIDITY GUARD. `valid_to` is not a metadata field here: the delete
 * refusal consumes link EXISTENCE, so "this link is no longer valid" is
 * semantically "this refusal no longer applies". Adding validity without
 * ruling how the assessor treats an expired link would WEAKEN a governed
 * refusal as a side effect of a data-model change.
 *
 * If you are here because this failed, you have added temporal validity to
 * links. That is a GOVERNANCE change and needs its own ruling and a presented
 * gate — do not delete this test to make it pass.
 */
describe('NP-017 · VALIDITY GUARD — a link cannot silently acquire an expiry', () => {
  it('nothing in the relationship path filters links by time', () => {
    for (const f of ['dataPlane/relationshipStore.ts', 'dataPlane/relationshipEngine.ts', 'crossDomain/relatedRecords.ts', 'decisions/decisionService.ts']) {
      const src = read(MAIN, ...f.split('/'));
      expect(src, f).not.toMatch(/validFrom|validTo|expiresAt|isExpired/);
    }
  });

  it('the delete assessor consumes the link ARRAY, so an expiring link would change a governed refusal', () => {
    // Recorded as the reason validity is a governance question: this is the
    // exact call whose input would shrink if links could expire.
    const src = read(MAIN, 'decisions', 'decisionService.ts');
    expect(src).toMatch(/incoming/);
    expect(src).toMatch(/high_risk/);
  });
});

/* ───────────── recorded findings (observations, not fixes) ───────────── */

describe('NP-017 · recorded findings', () => {
  it('F-N17-1: RelationshipDef.mandatory is declared and read by NOTHING — no ingestion decision depends on a link', () => {
    const model = read(MAIN, 'dataPlane', 'relationshipModel.ts');
    expect(model).toMatch(/mandatory\?:\s*boolean/);
    // Declared on the type, set by no entry, and read nowhere in the data plane.
    for (const f of ['dataPlane/relationshipEngine.ts', 'dataPlane/relationshipResolver.ts', 'dataPlane/importer.ts']) {
      expect(read(MAIN, ...f.split('/')), f).not.toMatch(/\.mandatory\b/);
    }
  });

  it('F-N17-2: the safety property lives UPSTREAM in the resolver, not in a downstream confidence threshold', () => {
    const resolver = read(MAIN, 'dataPlane', 'relationshipResolver.ts');
    // A weak match never becomes a link at all — which is why no consumer needs
    // to threshold confidence, and why adding one would be redundant, not safer.
    expect(resolver).toMatch(/ambiguous/);
  });

  it('the declared relationship set is real and non-trivial (the substrate these fields would describe)', () => {
    expect(RELATIONSHIPS.length).toBeGreaterThan(30);
    expect(new Set(RELATIONSHIPS.map((r) => r.key)).size).toBe(RELATIONSHIPS.length); // keys unique
  });
});
