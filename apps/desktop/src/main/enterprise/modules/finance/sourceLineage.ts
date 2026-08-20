/**
 * NP-011 / FG-11 — THIN RE-EXPORT ONLY. The lineage rule lives in EXACTLY ONE
 * module: `packages/shared/src/business/sourceLineage.ts` (moved there under
 * the FG-11 gate so the renderer's Business tiles render the SAME rule the
 * finance generators stamp). This file exists solely to keep the import paths
 * of the three generators (AR aging, cash flow, tax reports) stable — it
 * carries NO implementation, and the one-rule invariant is pinned in
 * `sourceLineage.test.ts` so a second implementation cannot re-enter.
 */
export { deriveSourceLineage } from '@neuropause/shared';
export type { ImportedFileLineage, SourceLineage } from '@neuropause/shared';
