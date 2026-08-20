/**
 * NP-010 §3 — the Intelligence-tile law for financial numbers: no total renders
 * without its evidence lineage ("computed over N invoices from source X").
 *
 * ONE pure rule, used wherever a financial artifact states what it was computed
 * over. It reads only what the substrate already records: the NP-010 §2 import
 * stamps (`importSourceFile`, `importSourceTrust`), the connector-sync stamps,
 * and — by their absence — keyboard entry. It never invents a source: a record
 * with no stamp is "entered in app", not guessed.
 */
import type { EnterpriseEntity } from '@neuropause/shared';

export interface ImportedFileLineage {
  file: string;
  count: number;
  /** The §2 honesty label carried by the records from this file. */
  trust: string;
}

export interface SourceLineage {
  total: number;
  /** Records with no import/connector stamp — created in the app by a person. */
  manual: number;
  /** Records adopted or created from a connector sync. */
  connector: number;
  importedFiles: ImportedFileLineage[];
  /** The human sentence the tile law requires. */
  sentence: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function deriveSourceLineage(records: readonly EnterpriseEntity[], noun: string): SourceLineage {
  const files = new Map<string, { count: number; trust: string }>();
  let manual = 0;
  let connector = 0;
  for (const record of records) {
    const meta = record.metadata ?? {};
    const file = str(meta.importSourceFile);
    if (file) {
      const trust = str(meta.importSourceTrust) || 'unverified-source';
      const entry = files.get(file) ?? { count: 0, trust };
      entry.count += 1;
      files.set(file, entry);
    } else if (str(meta.connectorId) || str(meta.syncExternalId) || record.tags?.includes('synced')) {
      connector += 1;
    } else {
      manual += 1;
    }
  }
  const importedFiles = [...files.entries()]
    .map(([file, v]) => ({ file, count: v.count, trust: v.trust }))
    .sort((a, b) => b.count - a.count);

  const total = records.length;
  let sentence: string;
  if (total === 0) {
    sentence = `No ${noun} yet — nothing is computed.`;
  } else {
    const parts: string[] = [];
    for (const f of importedFiles) parts.push(`${f.count} imported from ${f.file} (${f.trust})`);
    if (connector > 0) parts.push(`${connector} from connector sync (unverified-source)`);
    if (manual > 0) parts.push(`${manual} entered in app`);
    sentence = `Computed over ${total} ${noun} — ${parts.join(', ')}.`;
  }
  return { total, manual, connector, importedFiles, sentence };
}
