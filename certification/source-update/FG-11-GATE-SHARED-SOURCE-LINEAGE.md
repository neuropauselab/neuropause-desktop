# FG-11 GATE — `deriveSourceLineage` moves to `packages/shared` (frozen surface)
### Presented 2026-08-20 (NP-011 slice C). ⛔ NOTHING in this document is applied until the literal token is given.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

## Subject and why the gate exists

The Intelligence-tile law's lineage rule (`deriveSourceLineage`) lives in main
(`apps/desktop/src/main/enterprise/modules/finance/sourceLineage.ts`) and now stamps three generators (AR aging,
cash flow, tax reports). The Business dashboard tiles (renderer, `FamilyDashboard.tsx`) must render the SAME rule
over the records they already fetch — and the renderer cannot import from main. Two copies of one derivation rule
is the drift class this codebase forbids ("the direction two copies drift apart in is the direction that grants
capability nobody authorized"). The single-source placement is `packages/shared` — a FROZEN surface — hence this
gate. The alternative (a renderer copy) is rejected as a §50-class workaround.

## The exact frozen diff (verbatim — a diff that changes after the token requires a new token)

**File 1 — NEW: `packages/shared/src/business/sourceLineage.ts`** (entire file, additive):

```ts
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
```

**File 2 — `packages/shared/src/index.ts`, ONE additive line** (beside the existing business export):

```diff
 export * from './business/familyDashboardModel';
+export * from './business/sourceLineage';
```

(If the actual neighbor line differs, the export line is still the single addition — placed adjacent to the
existing `./business/` export. No other line of `index.ts` changes.)

## Coupled NON-frozen accompaniment (same slice, after the token)

1. `apps/desktop/src/main/enterprise/modules/finance/sourceLineage.ts` becomes a thin re-export
   (`export { deriveSourceLineage } from '@neuropause/shared';` + types) — import paths of the three generators
   unchanged, ZERO deletions, one rule total. Its derivation pins move/point to the shared rule.
2. Renderer: `FamilyDashboard.tsx` renders the lineage sentence under the family KPIs from the records it already
   fetches (no new IPC); ui test pins the derivation (imported+manual mix → the sentence; empty → the honest
   no-records line).

## Threat analysis — both directions

- **Added risk of the frozen change:** a new PURE module in shared (no I/O, no authority, no secrets, no IPC) +
  one export line. It grants nothing: it only DESCRIBES record metadata already visible to both sides. Worst
  case: a wrong sentence — a display-honesty bug, not an authority change. No existing shared type/contract is
  modified; the wire surface is untouched (no channel/response changes).
- **Risk of NOT making it:** either the tiles stay lineage-less (the tile law unmet on the dashboard) or a
  renderer copy is made — the drift-to-unauthorized-capability class, explicitly rejected.
- **Injection/content surface:** file names from user imports appear in the sentence; they are rendered as text
  by React (no HTML interpolation) and were already displayed elsewhere (import review UI).

## Verification plan (after the token)

Shared typecheck + the pins currently in `sourceLineage.test.ts` running against the SHARED implementation ·
new ui test for the tile line · full main + ui suites green · honesty scan 0 · freeze re-record with both INTACT
brackets per §2.2 choreography · evidence doc records the token verbatim.

## Read-only confirmations for the operator (run before issuing the token)

```bash
# 1. The rule exists in main today, is pure, and three generators consume it:
grep -n "deriveSourceLineage" apps/desktop/src/main/enterprise/modules/finance/*.ts | grep -v test
# 2. Nothing in packages/shared references sourceLineage yet (the addition is genuinely new):
grep -rn "sourceLineage" packages/shared/src || echo "absent — additive"
# 3. Freeze is INTACT before the bracket begins:
bash certification/verify-freeze.sh | tail -1
```

## The token

The gate opens ONLY on the literal line:

```
AUTHORIZED: FG-11 — packages/shared sourceLineage addition (move from main), per gate doc
```

Silence is not consent; enthusiasm is not consent. If the operator is mid-ceremony, this gate waits its turn.

**STATUS: ⛔ PRESENTED — awaiting the token. The renderer tile wiring is NOT built until then.**
