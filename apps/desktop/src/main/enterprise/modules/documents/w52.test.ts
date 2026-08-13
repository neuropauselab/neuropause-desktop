import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OPPORTUNITIES_MODULE_ID,
  appendDocumentVersion,
  documentFromRecord,
  parseDocumentVersions,
  runBiReport,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createDocumentModule } from './documentModule';
import { createBiReportModule } from '../executive/biReportModule';
import { createOpportunityModule } from '../crm/opportunityModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('W5.2 pure engines — append-only versions and honest aggregation', () => {
  it('appends versions monotonically and never mutates the input history', () => {
    const v1 = appendDocumentVersion([], { ref: 'file:///sop-a.pdf', notes: 'first', at: T0, by: 't@np' });
    expect(v1.version).toBe(1);
    const v2 = appendDocumentVersion(v1.versions, { ref: 'file:///sop-b.pdf', notes: 'second', at: T0, by: 't@np' });
    expect(v2.version).toBe(2);
    expect(v1.versions).toHaveLength(1); // input untouched
    expect(parseDocumentVersions(JSON.stringify(v2.versions))).toHaveLength(2);
    expect(parseDocumentVersions('not json')).toEqual([]);
  });

  it('aggregates with groups, filters, and unparseable counts — never silent zeros', () => {
    const rec = (fields: Record<string, unknown>, i: number): EnterpriseEntity =>
      ({ id: `r${i}`, title: '', fields, createdAt: T0, updatedAt: T0 }) as unknown as EnterpriseEntity;
    const records = [
      rec({ stage: 'negotiation', assignedTo: 'kinjal', weightedValue: 100 }, 1),
      rec({ stage: 'negotiation', assignedTo: 'kinjal', weightedValue: 50 }, 2),
      rec({ stage: 'negotiation', assignedTo: 'dishant', weightedValue: 'oops' }, 3),
      rec({ stage: 'proposal', assignedTo: 'kinjal', weightedValue: 999 }, 4),
    ];
    const result = runBiReport(records, {
      reportName: 'x', targetModule: 'y', aggregate: 'sum', sumField: 'weightedValue',
      groupByField: 'assignedTo', filterField: 'stage', filterValue: 'negotiation',
    });
    expect(result.totalCount).toBe(3); // proposal filtered out
    expect(result.rows[0]).toMatchObject({ group: 'kinjal', count: 2, sum: 150 });
    expect(result.rows[1]).toMatchObject({ group: 'dishant', unparseable: 1, sum: 0 });
    expect(result.totalUnparseable).toBe(1);
  });
});

describe('Documents + BI Reports over real stores', () => {
  let dir: string;
  let documents: EnterpriseModule;
  let reports: EnterpriseModule;
  let opps: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-w52-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    documents = createDocumentModule(join(dir, 'documents.json'));
    reports = createBiReportModule(join(dir, 'reports.json'));
    opps = createOpportunityModule(join(dir, 'opps.json'));
    await Promise.all([documents.store.load(), reports.store.load(), opps.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === OPPORTUNITIES_MODULE_ID ? opps : null),
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([documents.store.flush(), reports.store.flush(), opps.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('checks in append-only versions, refuses empty drafts, freezes on archive', async () => {
    const v = documents.hooks.validate({ fields: { documentNumber: 'DOC-1', title: 'Pilot SOP', draftRef: 'file:///sop-a.pdf', draftNotes: 'first cut' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = documents.store.create({ title: 'Pilot SOP', fields: v.values, actor: 't@np', now: T0 });
    const checkIn = await documents.hooks.runAction!('checkIn', rec, ctx);
    expect(checkIn.ok, checkIn.ok ? '' : checkIn.error).toBe(true);
    const doc = documentFromRecord(documents.store.get(rec.id)!);
    expect(doc.currentVersion).toBe(1);
    expect(doc.versions[0]).toMatchObject({ version: 1, ref: 'file:///sop-a.pdf', by: 't@np' });
    expect(doc.draftRef).toBe(''); // draft cleared after check-in
    // Empty draft refused; archive freezes.
    expect((await documents.hooks.runAction!('checkIn', documents.store.get(rec.id)!, ctx)).ok).toBe(false);
    expect((await documents.hooks.runAction!('archive', documents.store.get(rec.id)!, ctx)).ok).toBe(true);
    expect(documents.hooks.validate({ fields: { ...documents.store.get(rec.id)!.fields, title: 'edit' } }).ok).toBe(false);
    expect((await documents.hooks.runAction!('checkIn', documents.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('runs saved reports over live module records and refuses unknown targets', async () => {
    for (const [name, weighted] of [['A', 100], ['B', 50]] as const) {
      const ov = opps.hooks.validate({ fields: { name, amount: 1000, stage: 'prospecting', probability: 10 } });
      if (!ov.ok) throw new Error('opp invalid');
      opps.store.create({ title: name, fields: { ...ov.values, weightedValue: weighted }, actor: 't@np', now: T0 });
    }
    const rv = reports.hooks.validate({ fields: { reportName: 'Weighted pipeline', targetModule: OPPORTUNITIES_MODULE_ID, aggregate: 'sum', sumField: 'weightedValue' } });
    expect(rv.ok, JSON.stringify('errors' in rv ? rv.errors : {})).toBe(true);
    if (!rv.ok) throw new Error('unreachable');
    // Sum without a sum field is refused at validate.
    expect(reports.hooks.validate({ fields: { reportName: 'X', targetModule: 'y', aggregate: 'sum' } }).ok).toBe(false);
    const rec = reports.store.create({ title: 'Weighted pipeline', fields: rv.values, actor: 't@np', now: T0 });
    const run = await reports.hooks.runAction!('run', rec, ctx);
    expect(run.ok, run.ok ? '' : run.error).toBe(true);
    const after = reports.store.get(rec.id)!;
    expect(after.fields.lastRunAt).toBe(T0);
    const rows = JSON.parse(String(after.fields.lastResult));
    expect(rows[0]).toMatchObject({ group: '(all)', count: 2, sum: 150 });
    // Unknown module ids are refused by id, stated.
    const ghost = reports.hooks.validate({ fields: { reportName: 'G', targetModule: 'no-such-module', aggregate: 'count' } });
    if (!ghost.ok) throw new Error('unreachable');
    const grec = reports.store.create({ title: 'G', fields: ghost.values, actor: 't@np', now: T0 });
    const gres = await reports.hooks.runAction!('run', grec, ctx);
    expect(gres.ok).toBe(false);
    if (!gres.ok) expect(String(gres.error)).toContain('no-such-module');
  });
});
