/**
 * Data Command Center — view-model tests.
 *
 * The renderer test environment is Node-only, so the view is a thin projection
 * and EVERY decision that could mislead a user is made here, where it is tested:
 * empty-vs-zero, "needs review" vs "matched", hold reasons, and the rule that a
 * run with failures can never read as a success.
 */
import { describe, expect, it } from 'vitest';
import type {
  DataPlaneColumnMapping,
  DataPlanePlanSummary,
  DataPlanePreview,
  DataPlanePreviewRow,
  DataPlaneRowAction,
  DataPlaneProvenance,
  DataPlaneRunResult,
  DataPlaneSavedMapping,
  DataPlaneTableResult,
} from '@neuropause/shared';
import {
  IMPORT_STAGE_LABEL,
  MAX_UPLOAD_BYTES,
  applyDecisions,
  approvalDefaults,
  buildPreview,
  mergeApprovals,
  rowChoices,
  setRowDecision,
  toRowActions,
  undecidedRows,
  type PlanEffect,
  buildInspection,
  buildMappingRows,
  buildOverview,
  buildPlan,
  buildProvenance,
  buildQualityIssues,
  buildExportRows,
  buildGraph,
  buildRelationshipQueue,
  buildRelationshipSummary,
  buildResult,
  bytesToBase64,
  describeExport,
  describeRetryPass,
  formatBytes,
  friendlyError,
  importReadiness,
  isBusyStage,
  mappingsNeedingReview,
  needsApprovalReason,
  toApprovals,
  tooLargeMessage,
  type ImportStage,
} from './dataCommandCenterModel';

// ── fixtures ───────────────────────────────────────────────────────────────

function tableResult(over: Partial<DataPlaneTableResult> = {}): DataPlaneTableResult {
  return {
    tableName: 'Sheet1',
    entityId: 'customer',
    moduleId: 'crm-customers',
    status: 'imported',
    imported: 10,
    skipped: 0,
    failed: 0,
    duplicates: 0,
    needsReview: 0,
    createdRecordIds: [],
    errors: [],
    rolledBack: false,
    note: null,
    ...over,
  };
}

function run(over: Partial<DataPlaneRunResult> = {}): DataPlaneRunResult {
  const tables = over.tables ?? [tableResult()];
  return {
    planId: 'plan_1',
    sourceFile: 'customers.xlsx',
    importedAt: '2026-08-08T10:00:00.000Z',
    actor: 'user_1',
    status: 'imported',
    tables,
    totals: over.totals ?? {
      imported: tables.reduce((n, t) => n + t.imported, 0),
      skipped: tables.reduce((n, t) => n + t.skipped, 0),
      failed: tables.reduce((n, t) => n + t.failed, 0),
      duplicates: tables.reduce((n, t) => n + t.duplicates, 0),
      needsReview: tables.reduce((n, t) => n + t.needsReview, 0),
    },
    ...over,
  };
}

function mapping(over: Partial<DataPlaneColumnMapping> = {}): DataPlaneColumnMapping {
  return {
    columnIndex: 0,
    header: 'Customer Name',
    fieldKey: 'name',
    fieldLabel: 'Name',
    confidence: 0.94,
    band: 'high',
    reasons: ['Header matches the canonical field name.'],
    observedShape: 'text',
    fillRate: 1,
    ...over,
  };
}

function plannedTable(over: Partial<DataPlanePlanSummary['tables'][number]> = {}): DataPlanePlanSummary['tables'][number] {
  return {
    signature: 'sig_customers',
    tableName: 'Customers',
    entityId: 'customer',
    entityLabel: 'Customer',
    detectedEntityId: 'customer',
    detectedConfidence: 0.94,
    classificationMethod: 'detected',
    override: null,
    domain: 'crm',
    moduleId: 'crm-customers',
    confidence: 0.91,
    band: 'high',
    reasons: ['5 of 6 columns matched the Customer shape.'],
    mappings: [mapping()],
    missingRequired: [],
    report: {
      totalRows: 20,
      valid: 18,
      invalid: 1,
      incomplete: 1,
      duplicates: 0,
      transformed: 3,
      topIssues: [],
      unmappedColumns: [],
    },
    duplicates: [],
    risk: 'low',
    requiresApproval: false,
    importableRows: 18,
    blockedReason: null,
    ...over,
  };
}

function plan(over: Partial<DataPlanePlanSummary> = {}): DataPlanePlanSummary {
  const tables = over.tables ?? [plannedTable()];
  return {
    planId: 'plan_1',
    sourceFile: 'customers.xlsx',
    format: 'xlsx',
    createdAt: '2026-08-08T10:00:00.000Z',
    tables,
    unclassified: [],
    text: null,
    totals: over.totals ?? {
      tables: tables.length,
      rows: tables.reduce((n, t) => n + t.report.totalRows, 0),
      importable: tables.reduce((n, t) => n + t.importableRows, 0),
      invalid: tables.reduce((n, t) => n + t.report.invalid, 0),
      incomplete: tables.reduce((n, t) => n + t.report.incomplete, 0),
      duplicates: tables.reduce((n, t) => n + t.report.duplicates, 0),
      approvalRequired: tables.filter((t) => t.requiresApproval).length,
    },
    requiresApproval: tables.some((t) => t.requiresApproval),
    warnings: [],
    unsupportedReason: null,
    ...over,
  };
}

// ── overview ───────────────────────────────────────────────────────────────

describe('buildOverview', () => {
  it('a fresh install is EMPTY, not a dashboard of zeroes', () => {
    const model = buildOverview([]);
    expect(model.empty).toBe(true);
    expect(model.metrics).toEqual([]);
    expect(model.recent).toEqual([]);
    // The headline invites, it does not report a fabricated measurement.
    expect(model.headline).toBe('No enterprise data imported yet.');
    expect(model.headline).not.toMatch(/\b0\b/);
  });

  it('aggregates real totals across every run', () => {
    const model = buildOverview([
      run({ planId: 'a', totals: { imported: 10, skipped: 1, failed: 2, duplicates: 3, needsReview: 4 } }),
      run({ planId: 'b', totals: { imported: 5, skipped: 0, failed: 1, duplicates: 0, needsReview: 1 } }),
    ]);
    expect(model.empty).toBe(false);
    const by = (k: string): number => model.metrics.find((m) => m.key === k)?.value ?? -1;
    expect(by('imported')).toBe(15);
    expect(by('failed')).toBe(3);
    expect(by('review')).toBe(5);
    expect(by('duplicates')).toBe(3);
    expect(by('imports')).toBe(2);
  });

  it('counts tables held for approval as awaiting', () => {
    const model = buildOverview([
      run({
        status: 'nothing_imported',
        tables: [tableResult({ status: 'awaiting_approval', imported: 0 }), tableResult()],
      }),
    ]);
    expect(model.metrics.find((m) => m.key === 'awaiting')?.value).toBe(1);
  });

  it('says nothing needs attention only when nothing actually does', () => {
    const clean = buildOverview([run()]);
    expect(clean.headline).toContain('Nothing needs your attention');

    const dirty = buildOverview([
      run({ totals: { imported: 10, skipped: 0, failed: 2, duplicates: 0, needsReview: 0 } }),
    ]);
    expect(dirty.headline).not.toContain('Nothing needs your attention');
    expect(dirty.headline).toContain('2');
  });

  it('shows at most eight recent runs, each with its real status', () => {
    const history = Array.from({ length: 12 }, (_, i) => run({ planId: `p${i}`, status: 'partial' }));
    const model = buildOverview(history);
    expect(model.recent).toHaveLength(8);
    expect(model.recent[0]?.statusLabel).toBe('Partly imported');
    expect(model.recent[0]?.tone).toBe('warn');
  });

  it('never labels a failed run with a success tone', () => {
    const model = buildOverview([run({ status: 'failed' })]);
    expect(model.recent[0]?.tone).toBe('bad');
    expect(model.recent[0]?.statusLabel).toBe('Failed');
  });
});

// ── inspection ─────────────────────────────────────────────────────────────

describe('buildInspection', () => {
  it('carries the honest unsupported reason through verbatim', () => {
    const model = buildInspection({
      filename: 'scan.pdf',
      format: 'pdf',
      bytes: 2048,
      supported: false,
      unsupportedReason: 'PDF text extraction is not implemented in this build.',
      tableNames: [],
      totalRows: 0,
    });
    expect(model.supported).toBe(false);
    expect(model.reason).toBe('PDF text extraction is not implemented in this build.');
    expect(model.format).toBe('PDF');
    expect(model.sizeLabel).toBe('2.0 KB');
  });

  it('reports sheets and rows for a readable file', () => {
    const model = buildInspection({
      filename: 'book.xlsx',
      format: 'xlsx',
      bytes: 500,
      supported: true,
      unsupportedReason: null,
      tableNames: ['Customers', 'Invoices'],
      totalRows: 340,
    });
    expect(model.sheets).toEqual(['Customers', 'Invoices']);
    expect(model.rows).toBe(340);
    expect(model.reason).toBeNull();
  });
});

describe('formatBytes', () => {
  it('scales honestly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

// ── mapping review ─────────────────────────────────────────────────────────

describe('buildMappingRows', () => {
  it('only a high-confidence mapping reads as Matched', () => {
    const rows = buildMappingRows([
      mapping({ columnIndex: 0, band: 'high', confidence: 0.94 }),
      mapping({ columnIndex: 1, header: 'Terms', band: 'medium', confidence: 0.62 }),
      mapping({ columnIndex: 2, header: 'Notes', band: 'low', confidence: 0.2 }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(['Matched', 'Needs review', 'Needs review']);
    expect(rows[0]?.confidencePct).toBe(94);
  });

  it('an unmapped column is Not mapped with an explanation, never a silent blank', () => {
    const rows = buildMappingRows([
      mapping({ header: 'Internal Ref', fieldKey: null, fieldLabel: null, confidence: 0, band: 'low', reasons: [] }),
    ]);
    expect(rows[0]?.status).toBe('Not mapped');
    expect(rows[0]?.targetLabel).toBe('Not mapped');
    expect(rows[0]?.reason).toBe('No canonical field matched this column.');
  });

  it('surfaces the engine reasoning so a reviewer can audit it', () => {
    const rows = buildMappingRows([mapping({ reasons: ['Header matches the canonical field name.'] })]);
    expect(rows[0]?.reason).toBe('Header matches the canonical field name.');
  });

  it('marks a column as remembered when this tenant already confirmed it', () => {
    const saved: DataPlaneSavedMapping = {
      signature: 'sig',
      entityId: 'customer',
      columns: [{ header: 'customer name', fieldKey: 'name' }],
      tenantId: 't1',
      version: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      updatedBy: 'user_1',
      useCount: 3,
    };
    const rows = buildMappingRows([mapping({ header: 'Customer Name' }), mapping({ columnIndex: 1, header: 'City' })], saved);
    expect(rows[0]?.remembered).toBe(true);
    expect(rows[1]?.remembered).toBe(false);
  });

  it('mappingsNeedingReview returns everything a human still has to look at', () => {
    const rows = buildMappingRows([
      mapping({ columnIndex: 0 }),
      mapping({ columnIndex: 1, header: 'Terms', band: 'medium' }),
      mapping({ columnIndex: 2, header: 'X', fieldKey: null, fieldLabel: null, band: 'low' }),
    ]);
    expect(mappingsNeedingReview(rows).map((r) => r.source)).toEqual(['Terms', 'X']);
  });
});

// ── plan ───────────────────────────────────────────────────────────────────

describe('buildPlan', () => {
  it('a ready table has no hold reason', () => {
    const model = buildPlan(plan());
    expect(model.tables[0]?.holdReason).toBeNull();
    expect(model.tables[0]?.blocked).toBe(false);
    expect(model.tables[0]?.destination).toBe('Crm · Customer');
    expect(model.nothingToImport).toBe(false);
  });

  it('a blocked table shows the engine reason verbatim, not a paraphrase', () => {
    const model = buildPlan(
      plan({ tables: [plannedTable({ blockedReason: 'Required field "email" is missing from every row.' })] }),
    );
    expect(model.tables[0]?.blocked).toBe(true);
    expect(model.tables[0]?.holdReason).toBe('Required field "email" is missing from every row.');
  });

  it('explains a high-risk hold in terms of what the data IS', () => {
    const model = buildPlan(
      plan({ tables: [plannedTable({ risk: 'high', requiresApproval: true })] }),
    );
    expect(model.tables[0]?.holdReason).toContain('money, payroll or master data');
    expect(model.requiresApproval).toBe(true);
  });

  it('explains a low-confidence hold as a confidence problem', () => {
    const model = buildPlan(
      plan({ tables: [plannedTable({ risk: 'low', requiresApproval: true, band: 'medium', confidence: 0.66 })] }),
    );
    expect(model.tables[0]?.holdReason).toContain('below the automatic threshold');
  });

  it('knows when there is genuinely nothing to import', () => {
    expect(buildPlan(plan({ tables: [] })).nothingToImport).toBe(true);
    expect(buildPlan(plan({ tables: [plannedTable({ importableRows: 0 })] })).nothingToImport).toBe(true);
  });

  it('keeps unclassified tables visible with their reason', () => {
    const model = buildPlan(
      plan({
        unclassified: [
          { tableName: 'Sheet3', rowCount: 12, reason: 'No canonical entity scored above the threshold.', bestGuess: 'product', bestGuessConfidence: 0.31 },
        ],
      }),
    );
    expect(model.unclassified).toEqual([
      { tableName: 'Sheet3', rowCount: 12, reason: 'No canonical entity scored above the threshold.' },
    ]);
  });

  it('carries the unsupported reason to the top of the plan', () => {
    const model = buildPlan(plan({ tables: [], unsupportedReason: 'OCR is not configured (external dependency).' }));
    expect(model.unsupported).toBe('OCR is not configured (external dependency).');
  });
});

// ── result ─────────────────────────────────────────────────────────────────

describe('buildResult', () => {
  it('a fully successful run reads as success', () => {
    const model = buildResult(run({ status: 'imported' }));
    expect(model.tone).toBe('good');
    expect(model.summary).toBe('10 records imported.');
  });

  it('a partial run NEVER reads as success', () => {
    const model = buildResult(
      run({ status: 'partial', totals: { imported: 8, skipped: 0, failed: 2, duplicates: 0, needsReview: 0 } }),
    );
    expect(model.tone).toBe('warn');
    expect(model.summary).toContain('not fully successful');
    expect(model.summary).toContain('2');
  });

  it('a failed run says nothing was imported', () => {
    const model = buildResult(
      run({ status: 'failed', totals: { imported: 0, skipped: 0, failed: 7, duplicates: 0, needsReview: 0 } }),
    );
    expect(model.tone).toBe('bad');
    expect(model.summary).toContain('Nothing was imported');
    expect(model.summary).toContain('7');
  });

  it('explains a nothing-imported run that is waiting on approval', () => {
    const model = buildResult(
      run({
        status: 'nothing_imported',
        tables: [tableResult({ status: 'awaiting_approval', imported: 0 })],
        totals: { imported: 0, skipped: 0, failed: 0, duplicates: 0, needsReview: 0 },
      }),
    );
    expect(model.summary).toContain('waiting for approval');
    expect(model.tables[0]?.statusLabel).toBe('Awaiting approval');
    expect(model.tables[0]?.tone).toBe('warn');
  });

  it('shows a rollback rather than hiding it', () => {
    const model = buildResult(
      run({
        status: 'failed',
        tables: [tableResult({ status: 'failed', imported: 0, rolledBack: true, note: 'Rolled back — high-risk table imported all-or-nothing.' })],
        totals: { imported: 0, skipped: 0, failed: 4, duplicates: 0, needsReview: 0 },
      }),
    );
    expect(model.tables[0]?.rolledBack).toBe(true);
    expect(model.tables[0]?.note).toContain('Rolled back');
  });

  it('caps the error list so one bad file cannot flood the view', () => {
    const errors = Array.from({ length: 120 }, (_, i) => ({ sourceRow: i, message: 'Invalid date' }));
    const model = buildResult(run({ tables: [tableResult({ errors })] }));
    expect(model.errors).toHaveLength(50);
  });
});

// ── provenance ─────────────────────────────────────────────────────────────

describe('buildProvenance', () => {
  it('states exactly where a record came from', () => {
    const p: DataPlaneProvenance = {
      recordId: 'rec_1',
      moduleId: 'finance-invoices',
      planId: 'plan_1',
      sourceFile: 'finance.xlsx',
      sourceTable: 'Invoices',
      sourceRow: 1847,
      confidence: 0.93,
      approvedBy: 'user_2',
      importedAt: '2026-08-08T10:00:00.000Z',
      fields: [
        { field: 'total', column: 'Amount', original: '₹1,20,000.00', transformation: 'parsed as money' },
        { field: 'name', column: 'Customer', original: 'Acme Pvt. Ltd.', transformation: null },
      ],
    };
    const model = buildProvenance(p);
    expect(model.location).toBe('finance.xlsx · Invoices · row 1847');
    expect(model.confidencePct).toBe(93);
    expect(model.approvedBy).toBe('user_2');
    expect(model.fields[0]?.original).toBe('₹1,20,000.00');
    expect(model.fields[1]?.transformation).toBeNull();
  });
});

// ── data quality ───────────────────────────────────────────────────────────

describe('buildQualityIssues', () => {
  it('reports nothing when nothing went wrong', () => {
    expect(buildQualityIssues([run()])).toEqual([]);
  });

  it('reports only what actually happened, highest severity first', () => {
    const issues = buildQualityIssues([
      run({
        tables: [tableResult({ status: 'awaiting_approval', rolledBack: true })],
        totals: { imported: 0, skipped: 0, failed: 3, duplicates: 2, needsReview: 5 },
      }),
    ]);
    expect(issues.map((i) => i.severity)).toEqual(['high', 'high', 'medium', 'medium', 'low']);
    expect(issues.find((i) => i.issue.includes('failed'))?.affected).toBe(3);
    expect(issues.find((i) => i.issue.includes('duplicate'))?.affected).toBe(2);
  });

  it('never suggests an automatic merge for duplicates', () => {
    const issues = buildQualityIssues([
      run({ totals: { imported: 1, skipped: 0, failed: 0, duplicates: 4, needsReview: 0 } }),
    ]);
    expect(issues[0]?.action).toContain('never merges');
  });
});

// ── stages ─────────────────────────────────────────────────────────────────

describe('import stages', () => {
  it('every stage has a human label', () => {
    const stages: ImportStage[] = ['idle', 'reading', 'inspecting', 'analyzing', 'review', 'importing', 'done', 'error'];
    for (const s of stages) expect(IMPORT_STAGE_LABEL[s].length).toBeGreaterThan(0);
  });

  it('only the working stages are busy', () => {
    expect(isBusyStage('analyzing')).toBe(true);
    expect(isBusyStage('importing')).toBe(true);
    expect(isBusyStage('review')).toBe(false);
    expect(isBusyStage('done')).toBe(false);
    expect(isBusyStage('idle')).toBe(false);
  });

  it('no stage label promises a percentage', () => {
    for (const label of Object.values(IMPORT_STAGE_LABEL)) expect(label).not.toMatch(/%/);
  });
});

// ── errors ─────────────────────────────────────────────────────────────────

describe('friendlyError', () => {
  it('explains an approval-rights denial in terms of the right, not the code', () => {
    const e = friendlyError(new Error('Not authorized: data:approve'));
    expect(e.title).toBe('Permission required');
    expect(e.detail).toContain('approval rights');
    expect(e.canRetry).toBe(false);
  });

  it('explains a plain permission denial', () => {
    const e = friendlyError(new Error('Not authorized: data:import'));
    expect(e.title).toBe('Permission required');
    expect(e.canRetry).toBe(false);
  });

  it('tells the user to re-analyze when a plan expired', () => {
    const e = friendlyError(new Error('That import plan is no longer available — re-analyze the file.'));
    expect(e.title).toBe('This import expired');
    expect(e.canRetry).toBe(true);
  });

  it('suggests splitting the file on a timeout', () => {
    const e = friendlyError(new Error('Request timed out'));
    expect(e.detail).toContain('smaller files');
    expect(e.canRetry).toBe(true);
  });

  it('shows an unsupported-format reason verbatim and does not offer a pointless retry', () => {
    const e = friendlyError(new Error('OCR is not configured (external dependency).'));
    expect(e.detail).toBe('OCR is not configured (external dependency).');
    expect(e.canRetry).toBe(false);
  });

  it('falls back without leaking an empty message', () => {
    const e = friendlyError(undefined);
    expect(e.title).toBe('Something went wrong');
    expect(e.detail.length).toBeGreaterThan(0);
  });
});

// ── file handling ──────────────────────────────────────────────────────────

describe('file handling', () => {
  it('accepts a file at the limit and refuses one past it, in real bytes', () => {
    expect(tooLargeMessage(1024)).toBeNull();
    expect(tooLargeMessage(MAX_UPLOAD_BYTES)).toBeNull();
    const msg = tooLargeMessage(MAX_UPLOAD_BYTES + 1);
    expect(msg).not.toBeNull();
    // The message states the actual ceiling rather than a vague "too large".
    expect(msg).toContain('accepts up to');
  });

  it('encodes bytes exactly like the transport expects', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('encodes a payload far past the argument-spread limit without overflowing', () => {
    // 300k bytes: the naive String.fromCharCode(...bytes) blows the call stack
    // here, which is exactly the size this feature exists to handle.
    const bytes = new Uint8Array(300_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

// ── approval gate ──────────────────────────────────────────────────────────

describe('approval gate', () => {
  const safe = plannedTable({ tableName: 'Customers', requiresApproval: false, importableRows: 18 });
  const risky = plannedTable({ tableName: 'Payroll', entityId: 'employee', entityLabel: 'Employee', risk: 'high', requiresApproval: true, importableRows: 5 });
  const blocked = plannedTable({ tableName: 'Broken', blockedReason: 'No rows passed validation.', importableRows: 0 });

  it('pre-approves only what the engine already judged safe', () => {
    const model = buildPlan(plan({ tables: [safe, risky, blocked] }));
    expect(approvalDefaults(model)).toEqual({ Customers: true, Payroll: false, Broken: false });
  });

  it('a blocked table is never sent as approved, even if the state says so', () => {
    const model = buildPlan(plan({ tables: [safe, blocked] }));
    const sent = toApprovals({ Customers: true, Broken: true }, model);
    expect(sent).toEqual([
      { tableName: 'Customers', approved: true },
      { tableName: 'Broken', approved: false },
    ]);
  });

  it('sends an explicit decision for every table — omission is never approval', () => {
    const model = buildPlan(plan({ tables: [safe, risky] }));
    const sent = toApprovals({ Customers: true }, model);
    expect(sent).toHaveLength(2);
    expect(sent.find((a) => a.tableName === 'Payroll')?.approved).toBe(false);
  });

  it('demands a written reason only when a high-risk group is actually selected', () => {
    const model = buildPlan(plan({ tables: [safe, risky] }));
    expect(needsApprovalReason({ Customers: true, Payroll: false }, model)).toBe(false);
    expect(needsApprovalReason({ Customers: true, Payroll: true }, model)).toBe(true);
  });

  it('will not import with nothing selected, and says why', () => {
    const model = buildPlan(plan({ tables: [safe] }));
    const r = importReadiness(model, { Customers: false }, '');
    expect(r.ready).toBe(false);
    expect(r.blockedBecause).toContain('at least one group');
  });

  it('will not import a selection with no valid rows, and says why', () => {
    const model = buildPlan(plan({ tables: [plannedTable({ tableName: 'Empty', importableRows: 0 })] }));
    const r = importReadiness(model, { Empty: true }, '');
    expect(r.ready).toBe(false);
    expect(r.blockedBecause).toContain('no rows that passed validation');
  });

  it('holds a high-risk import until the approver writes down why', () => {
    const model = buildPlan(plan({ tables: [risky] }));
    const withoutReason = importReadiness(model, { Payroll: true }, '   ');
    expect(withoutReason.ready).toBe(false);
    expect(withoutReason.blockedBecause).toContain('record why');

    const withReason = importReadiness(model, { Payroll: true }, 'Verified against the signed payroll register.');
    expect(withReason.ready).toBe(true);
    expect(withReason.approvedRecords).toBe(5);
  });

  it('counts exactly what is about to be written', () => {
    const model = buildPlan(plan({ tables: [safe, risky] }));
    const r = importReadiness(model, { Customers: true, Payroll: true }, 'Signed off by finance.');
    expect(r.approvedTables).toBe(2);
    expect(r.approvedRecords).toBe(23);
  });
});

// ── export ─────────────────────────────────────────────────────────────────

describe('export view-model', () => {
  const mod = (over: Partial<Parameters<typeof buildExportRows>[0][number]> = {}): Parameters<typeof buildExportRows>[0][number] => ({
    moduleId: 'crm-customers',
    title: 'Customers',
    plural: 'Customers',
    group: 'CRM',
    recordCount: 10,
    importedCount: 10,
    ...over,
  });

  it('states traceability honestly for a fully imported module', () => {
    const [row] = buildExportRows([mod()]);
    expect(row?.provenanceNote).toContain('Every record');
  });

  it('states the real proportion when only some records were imported', () => {
    const [row] = buildExportRows([mod({ recordCount: 10, importedCount: 3 })]);
    expect(row?.provenanceNote).toBe('3 of 10 can be traced to a source row.');
  });

  it('warns that source columns would be empty when nothing was imported', () => {
    const [row] = buildExportRows([mod({ importedCount: 0 })]);
    expect(row?.provenanceNote).toContain('would be empty');
  });

  it('groups an ungrouped module rather than showing a blank cell', () => {
    const [row] = buildExportRows([mod({ group: null })]);
    expect(row?.group).toBe('Other');
  });

  it('orders by area then name so a long list stays findable', () => {
    const rows = buildExportRows([
      mod({ moduleId: 'z', plural: 'Zebras', group: 'Ops' }),
      mod({ moduleId: 'a', plural: 'Apples', group: 'Ops' }),
      mod({ moduleId: 'c', plural: 'Cats', group: 'CRM' }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Cats', 'Apples', 'Zebras']);
  });

  it('reports a cancelled save as cancelled, never as a zero-record success', () => {
    const msg = describeExport(
      { moduleId: 'crm-customers', format: 'csv', records: 0, columns: 4, filePath: null, cancelled: true, manifest: null, packaged: false, excluded: [] },
      'Customers',
    );
    expect(msg).toContain('cancelled');
    expect(msg).not.toContain('Exported 0');
  });

  it('names the file it actually wrote', () => {
    const msg = describeExport(
      { moduleId: 'crm-customers', format: 'xlsx', records: 42, columns: 6, filePath: '/Users/x/customers.xlsx', cancelled: false, manifest: null, packaged: false, excluded: [] },
      'Customers',
    );
    expect(msg).toBe('Exported 42 Customers to /Users/x/customers.xlsx.');
  });
});

// ── relationships ──────────────────────────────────────────────────────────

describe('relationship view-model', () => {
  const pending = (over: Partial<Parameters<typeof buildRelationshipQueue>[0][number]> = {}): Parameters<typeof buildRelationshipQueue>[0][number] => ({
    id: 'pen_1',
    relationshipKey: 'invoice.customer',
    relationshipLabel: 'Customer',
    sourceModuleId: 'finance-invoices',
    sourceRecordId: 'inv_1',
    sourceTitle: 'INV-1004',
    sourceField: 'customer',
    sourceValue: 'ABC Hospital Limited',
    targetModuleId: 'crm-customers',
    targetLabel: 'Customer',
    status: 'ambiguous',
    candidates: [
      { id: 'c1', title: 'ABC Hospital Ltd', matchedOn: 'name', matchedValue: 'ABC Hospital Limited', method: 'canonical_name', confidence: 0.88 },
    ],
    reason: 'Confirm before linking.',
    firstSeenAt: '2026-08-09T09:00:00.000Z',
    attempts: 1,
    ...over,
  });

  it('keeps the source value verbatim so a reviewer sees what the file said', () => {
    const [row] = buildRelationshipQueue([pending()]);
    expect(row?.value).toBe('ABC Hospital Limited');
    expect(row?.statusLabel).toBe('Needs a decision');
  });

  it('explains why each candidate is offered rather than just ranking them', () => {
    const [row] = buildRelationshipQueue([pending()]);
    expect(row?.candidates[0]?.why).toContain('legal suffix');
    expect(row?.candidates[0]?.confidencePct).toBe(88);
  });

  it('distinguishes waiting-on-data from waiting-on-a-person', () => {
    const [waiting] = buildRelationshipQueue([pending({ status: 'unresolved', candidates: [] })]);
    expect(waiting?.awaitingData).toBe(true);
    const [decide] = buildRelationshipQueue([pending()]);
    expect(decide?.awaitingData).toBe(false);
  });

  it('a fresh install shows an invitation rather than four zeroes', () => {
    const summary = buildRelationshipSummary({
      declared: [],
      chains: [],
      counts: { links: 0, ambiguous: 0, unresolved: 0, skipped: 0 },
    });
    expect(summary.empty).toBe(true);
    expect(summary.metrics).toEqual([]);
  });

  it('only counts ambiguous items as needing a decision', () => {
    const summary = buildRelationshipSummary({
      declared: [],
      chains: [],
      counts: { links: 40, ambiguous: 0, unresolved: 6, skipped: 1 },
    });
    // Six references are waiting on data. Nobody has to do anything about them.
    expect(summary.headline).toContain('Nothing needs a decision');
    expect(summary.metrics.find((m) => m.key === 'unresolved')?.value).toBe(6);
  });

  it('describes a retry pass without overstating it', () => {
    expect(describeRetryPass({ examined: 0, resolved: 0, ambiguous: 0, unresolved: 0, empty: 0 })).toContain('Nothing was waiting');
    expect(describeRetryPass({ examined: 5, resolved: 0, ambiguous: 1, unresolved: 4, empty: 0 })).toContain('none could be linked yet');
    expect(describeRetryPass({ examined: 5, resolved: 3, ambiguous: 0, unresolved: 2, empty: 0 })).toBe('Linked 3 of 5 re-checked reference(s).');
  });

  it('marks a deleted far end as broken instead of rendering it as live', () => {
    const model = buildGraph({
      record: { id: 'inv_1', title: 'INV-1', moduleId: 'finance-invoices' },
      outgoing: [
        { relationshipKey: 'invoice.customer', label: 'Customer', moduleId: 'crm-customers', moduleTitle: 'Customers', recordId: 'c1', title: '(deleted record c1)', method: 'business_key', confidence: 1, decidedBy: null, at: 'T', sourceValue: 'CUST-1' },
      ],
      incoming: [],
    });
    expect(model.outgoing.rows[0]?.broken).toBe(true);
    expect(model.isolated).toBe(false);
  });

  it('reports an isolated record honestly', () => {
    const model = buildGraph({ record: { id: 'x', title: 'X', moduleId: 'm' }, outgoing: [], incoming: [] });
    expect(model.isolated).toBe(true);
  });
});

/**
 * Row preview and the reviewer's decisions.
 *
 * These exist because the first version of this arithmetic could INVENT rows.
 * `base` is refetched from main on every preview call — and main re-runs
 * identity matching against the destination each time — while a decision
 * carries a snapshot of what the engine said when the reviewer clicked. The
 * two can disagree, and the code has to survive that without changing how many
 * rows there are.
 */
describe('row decisions applied to whole-table counts', () => {
  const preview = (over: Partial<DataPlanePreview> = {}): DataPlanePreview => ({
    tableName: 'data',
    entityId: 'customer',
    entityLabel: 'Customer',
    total: 1,
    offset: 0,
    rows: [],
    counts: { all: 1, valid: 1, warning: 0, invalid: 0, duplicate: 0, ambiguous: 0 },
    plan: { create: 1, update: 0, skip: 0, review: 0 },
    ...over,
  });

  const previewRow = (over: Partial<DataPlanePreviewRow> = {}): DataPlanePreviewRow => ({
    rowIndex: 0,
    sourceRow: 2,
    verdict: 'valid',
    action: 'create',
    title: 'Acme Ltd',
    fields: [{ key: 'name', label: 'Customer Name', value: 'Acme Ltd', redacted: false }],
    issues: [],
    transformations: [],
    duplicateOfRow: null,
    existingMatch: null,
    ...over,
  });

  const total = (e: PlanEffect): number => e.create + e.update + e.skip + e.review;

  it('never changes how many rows there are, even when the snapshot is stale', () => {
    // The reviewer chose SKIP while the engine said CREATE. By the time this
    // renders, someone else has created the matching record, so the engine now
    // says SKIP for that same row and `base` has no `create` left to move.
    const base: PlanEffect = { create: 0, update: 0, skip: 1, review: 0 };
    const out = applyDecisions(base, { 0: { action: 'skip', from: 'create' } });

    // The earlier version decremented with `Math.max(0, …)` and incremented
    // unconditionally, producing `{skip: 2}` for a one-row table.
    expect(total(out)).toBe(total(base));
    expect(out.skip).toBe(1);
  });

  it('does not report an update the reviewer never asked for', () => {
    // Same stale-snapshot shape, but now the engine's fresh answer is UPDATE.
    // Unguarded, this produced "This will update 1 record" for the only row in
    // the file — which the reviewer had set to skip.
    const base: PlanEffect = { create: 0, update: 1, skip: 0, review: 0 };
    const out = applyDecisions(base, { 0: { action: 'skip', from: 'create' } });
    expect(total(out)).toBe(1);
    expect(out.update).toBe(1);
    expect(out.skip).toBe(0);
  });

  it('prefers what the engine says NOW for a row the reviewer can see', () => {
    // The row is on screen, so there is no need to trust a snapshot at all.
    const base: PlanEffect = { create: 0, update: 1, skip: 0, review: 0 };
    const live = new Map<number, DataPlaneRowAction>([[0, 'update']]);
    const out = applyDecisions(base, { 0: { action: 'skip', from: 'create' } }, live);
    expect(out).toEqual({ create: 0, update: 0, skip: 1, review: 0 });
  });

  it('moves a row between buckets in the ordinary case', () => {
    const base: PlanEffect = { create: 2, update: 0, skip: 0, review: 1 };
    const out = applyDecisions(base, { 5: { action: 'update', from: 'review' } });
    expect(out).toEqual({ create: 2, update: 1, skip: 0, review: 0 });
  });

  it('counts an unanswered ambiguous row, and stops once it is answered', () => {
    const model = buildPreview(preview({ plan: { create: 1, update: 0, skip: 0, review: 2 } }));
    expect(undecidedRows(model, undefined)).toBe(2);
    expect(undecidedRows(model, { 3: { action: 'create', from: 'review' } })).toBe(1);
    expect(
      undecidedRows(model, {
        3: { action: 'create', from: 'review' },
        4: { action: 'skip', from: 'review' },
      }),
    ).toBe(0);
  });

  it('never reports a NEGATIVE number of undecided rows', () => {
    // Decisions outlive a re-preview. If the destination changed so that fewer
    // rows are ambiguous than have been answered, the honest answer is zero,
    // not "-1 rows await a decision".
    const model = buildPreview(preview({ plan: { create: 0, update: 0, skip: 0, review: 1 } }));
    const many = {
      1: { action: 'create' as const, from: 'review' as const },
      2: { action: 'create' as const, from: 'review' as const },
      3: { action: 'create' as const, from: 'review' as const },
    };
    expect(undecidedRows(model, many)).toBe(0);
  });

  it('does not prompt for a decision it offers no way to make', () => {
    /**
     * Main has a branch — no destination module for the entity — that marks
     * rows `review`. An INVALID row offers no actions at all, so a
     * "needs a decision" prompt on one is unanswerable, and the counter next
     * to the import button could never reach zero.
     */
    const model = buildPreview(
      preview({
        rows: [
          previewRow({ rowIndex: 0, verdict: 'invalid', action: 'review', issues: [{ field: 'Name', message: 'required', original: '' }] }),
          previewRow({ rowIndex: 1, verdict: 'valid', action: 'review' }),
        ],
      }),
    );
    expect(model.rows[0]!.choices).toEqual([]);
    expect(model.rows[0]!.needsDecision).toBe(false);
    expect(model.rows[0]!.unimportableReason).not.toBeNull();
    expect(model.rows[1]!.needsDecision).toBe(true);
  });

  it('refuses to offer CREATE against an exact identity match', () => {
    const row = previewRow({
      action: 'skip',
      existingMatch: {
        recordId: 'r1',
        title: 'Acme Ltd',
        kind: 'exact',
        basis: 'customerCode=cus-1',
        differs: [],
      },
    });
    const actions = rowChoices(row).map((c) => c.action);
    // A declared identity field matched literally. Creating a second record is
    // precisely the duplicate the matching pass exists to prevent.
    expect(actions).toContain('skip');
    expect(actions).toContain('update');
    expect(actions).not.toContain('create');
  });

  it('offers all three when the match is only normalized', () => {
    const row = previewRow({
      action: 'review',
      existingMatch: {
        recordId: 'r1',
        title: 'Acme Pvt Ltd',
        kind: 'normalized',
        basis: 'name=acme pvt ltd',
        differs: [],
      },
    });
    // "Probably the same" is not "the same": two real companies can normalise
    // to one string, so the reviewer keeps every option.
    expect(rowChoices(row).map((c) => c.action).sort()).toEqual(['create', 'skip', 'update']);
  });

  it('carries the reviewed record id so a moved match can be refused', () => {
    const model = buildPreview(
      preview({
        rows: [
          previewRow({
            action: 'review',
            existingMatch: { recordId: 'r1', title: 'Acme', kind: 'normalized', basis: 'name=acme', differs: [] },
          }),
        ],
      }),
    );
    const decided = setRowDecision({}, 'data', model.rows[0]!, 'update');
    expect(toRowActions(decided['data'])).toEqual([
      { rowIndex: 0, action: 'update', expectRecordId: 'r1' },
    ]);
  });

  it('sends row actions only for groups actually being imported', () => {
    const model = buildPlan(
      plan({ tables: [plannedTable({ tableName: 'A' }), plannedTable({ tableName: 'B', signature: 'sig_b' })] }),
    );
    const decisions = {
      A: { 0: { action: 'skip' as const, from: 'create' as const } },
      B: { 0: { action: 'skip' as const, from: 'create' as const } },
    };
    const out = toApprovals({ A: true, B: false }, model, decisions);
    // Asserting intent about writes the reviewer declined is a trap waiting
    // for the next person who reads the payload.
    expect(out.find((t) => t.tableName === 'A')?.rowActions).toHaveLength(1);
    expect(out.find((t) => t.tableName === 'B')?.rowActions).toBeUndefined();
  });

  it('keeps other groups ticked when one is corrected', () => {
    const model = buildPlan(
      plan({
        tables: [
          plannedTable({ tableName: 'A', requiresApproval: false }),
          plannedTable({ tableName: 'B', signature: 'sig_b', requiresApproval: true }),
        ],
      }),
    );
    const merged = mergeApprovals({ A: true, B: true }, model, 'B');
    expect(merged.A).toBe(true);
    // …and the corrected one goes back to its own default, which for a table
    // that needs approval means unticked.
    expect(merged.B).toBe(false);
  });

  it('describes what the button will do, not just how many rows passed', () => {
    const model = buildPlan(plan({ tables: [plannedTable({ tableName: 'A', requiresApproval: false })] }));
    const before = importReadiness(model, { A: true }, '');
    // With no preview consulted, it talks about validation — a claim the plan
    // alone supports — rather than guessing a create/update split.
    expect(before.summary).toContain('passed validation');

    const after = importReadiness(
      model,
      { A: true },
      '',
      { A: { create: 3, update: 2, skip: 1, review: 4 } },
      {},
    );
    expect(after.summary).toContain('create 3');
    expect(after.summary).toContain('update 2');
    expect(after.undecided).toBe(4);
  });

  it('does not block an import the reviewer has set entirely to skip, but says so', () => {
    const model = buildPlan(plan({ tables: [plannedTable({ tableName: 'A', requiresApproval: false })] }));
    const r = importReadiness(model, { A: true }, '', { A: { create: 0, update: 0, skip: 5, review: 0 } }, {});
    expect(r.ready).toBe(true);
    expect(r.summary).toContain('Nothing will be written');
  });
});
