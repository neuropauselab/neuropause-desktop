/**
 * NP-010 §3 — the lineage rule's derivation pins (the UI truth rule: every
 * rendered claim derives from evidence, with a test asserting the derivation).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EnterpriseEntity } from '@neuropause/shared';
// Imported through the main-side path deliberately: these pins running
// UNCHANGED against the FG-11 re-export is the byte-equivalence proof that
// the shared move preserved the rule.
import { deriveSourceLineage } from './sourceLineage';

function record(metadata: Record<string, unknown>, tags: string[] = []): EnterpriseEntity {
  return {
    id: `r_${Math.abs(JSON.stringify(metadata).length)}_${tags.join('')}_${Math.random().toString(36).slice(2, 8)}`,
    title: 'x',
    fields: {},
    tags,
    metadata,
    status: 'active',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    createdBy: 'test',
    updatedBy: 'test',
  } as unknown as EnterpriseEntity;
}

describe('deriveSourceLineage (NP-010 §3)', () => {
  it('an empty register says so — nothing is computed, nothing is invented', () => {
    const l = deriveSourceLineage([], 'invoice(s)');
    expect(l.total).toBe(0);
    expect(l.sentence).toBe('No invoice(s) yet — nothing is computed.');
  });

  it('names each source with its count and the §2 trust label', () => {
    const l = deriveSourceLineage(
      [
        record({ importSourceFile: 'tally-export.csv', importSourceTrust: 'unverified-source' }),
        record({ importSourceFile: 'tally-export.csv', importSourceTrust: 'unverified-source' }),
        record({ importSourceFile: 'zoho.csv', importSourceTrust: 'unverified-source' }),
        record({}),
      ],
      'invoice(s)',
    );
    expect(l.total).toBe(4);
    expect(l.manual).toBe(1);
    expect(l.importedFiles).toEqual([
      { file: 'tally-export.csv', count: 2, trust: 'unverified-source' },
      { file: 'zoho.csv', count: 1, trust: 'unverified-source' },
    ]);
    expect(l.sentence).toBe(
      'Computed over 4 invoice(s) — 2 imported from tally-export.csv (unverified-source), 1 imported from zoho.csv (unverified-source), 1 entered in app.',
    );
  });

  it('a record with no stamp is "entered in app" — absence is never guessed into a source', () => {
    const l = deriveSourceLineage([record({}), record({})], 'record(s)');
    expect(l.manual).toBe(2);
    expect(l.importedFiles).toEqual([]);
    expect(l.sentence).toBe('Computed over 2 record(s) — 2 entered in app.');
  });

  it('connector-synced rows are counted as a source and stay unverified-source', () => {
    const l = deriveSourceLineage([record({ connectorId: 'github' }), record({}, ['synced'])], 'record(s)');
    expect(l.connector).toBe(2);
    expect(l.sentence).toContain('2 from connector sync (unverified-source)');
  });

  it('a pre-§2 import stamp without a trust label defaults to unverified-source, never verified', () => {
    const l = deriveSourceLineage([record({ importSourceFile: 'old-import.xlsx' })], 'record(s)');
    expect(l.importedFiles[0]!.trust).toBe('unverified-source');
  });
});

// FG-11 — ONE RULE, ZERO COPIES. The invariant that keeps a second
// implementation from re-entering: main's module is a thin re-export and
// carries none of the rule's machinery.
describe('FG-11 one-rule invariant', () => {
  it('main holds no implementation — only the re-export from @neuropause/shared', () => {
    const src = readFileSync(join(__dirname, 'sourceLineage.ts'), 'utf8');
    expect(src).toMatch(/export \{ deriveSourceLineage \} from '@neuropause\/shared'/);
    expect(src).not.toContain('Computed over'); // the sentence template lives only in shared
    expect(src).not.toContain('new Map'); // no derivation machinery here
    expect(src).not.toContain('for (const record'); // no record loop here
  });
});
