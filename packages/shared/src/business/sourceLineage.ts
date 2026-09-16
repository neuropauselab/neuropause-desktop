/**
 * NP-011 — the Intelligence-tile law's lineage rule: no financial total renders
 * without naming what it was computed over. ONE pure rule, shared by the main
 * finance generators (AR aging, cash flow, tax reports) and the renderer's
 * Business dashboard tiles, so the sentence can never drift between them.
 * Reads only what the substrate records (the §2 import stamps and connector
 * stamps); absence is "entered in app", never guessed. Pure data — no I/O.
 */
import type { EnterpriseEntity } from '../types/enterpriseModule';

export interface ImportedFileLineage {
  file: string;
  count: number;
  /** The NP-010 §2 honesty label carried by the records from this file. */
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
