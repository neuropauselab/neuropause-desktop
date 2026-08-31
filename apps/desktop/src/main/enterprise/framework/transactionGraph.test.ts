/**
 * Transaction-graph spine — pure helpers + trace reconstruction.
 *
 * These pins are electron-free and disk-free: they exercise the correlation
 * algebra (inherit vs root) and the trace's ordering + root-resolution over
 * lightweight in-memory modules. The real end-to-end wiring (quote → order →
 * invoice + the movement/GL funnels through the actual modules) is proven in
 * transactionGraphSpine.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseEntity } from '@neuropause/shared';
import type { EnterpriseModule } from './enterpriseModule';
import {
  CAUSATION_ID_KEY,
  CAUSED_BY_MODULE_KEY,
  CORRELATION_ID_KEY,
  CORRELATION_ROOT_KEY,
  childCorrelationMeta,
  globalRef,
  parseGlobalRef,
  readCorrelation,
  rootMetaIfUnset,
  traceTransactionGraph,
} from './transactionGraph';

const T0 = '2026-08-31T12:00:00.000Z';

/** A minimal record carrying only what the spine reads. */
function rec(id: string, meta: Record<string, string> = {}, over: Partial<EnterpriseEntity> = {}): EnterpriseEntity {
  return {
    id,
    moduleId: over.moduleId ?? 'm',
    kind: 'k',
    title: over.title ?? id,
    status: over.status ?? 'active',
    fields: {},
    tags: [],
    rev: 1,
    createdAt: T0,
    updatedAt: over.updatedAt ?? T0,
    createdBy: null,
    updatedBy: null,
    metadata: meta,
    ...over,
  };
}

/** A fake module exposing exactly the surface `traceTransactionGraph` uses. */
function fakeModule(id: string, records: EnterpriseEntity[]): EnterpriseModule {
  return {
    descriptor: { id },
    store: {
      load: async () => undefined,
      list: () => records,
      get: (rid: string) => records.find((r) => r.id === rid) ?? null,
    },
  } as unknown as EnterpriseModule;
}

// ── global ref ───────────────────────────────────────────────────────────────
describe('globalRef / parseGlobalRef', () => {
  it('round-trips a module:record ref (record ids contain no colon)', () => {
    const ref = globalRef('sales-orders', 'rec_abc-123');
    expect(ref).toBe('sales-orders:rec_abc-123');
    expect(parseGlobalRef(ref)).toEqual({ moduleId: 'sales-orders', recordId: 'rec_abc-123' });
  });
  it('splits on the FIRST colon, so a record id could itself contain one', () => {
    expect(parseGlobalRef('mod:rec:with:colons')).toEqual({ moduleId: 'mod', recordId: 'rec:with:colons' });
  });
  it('rejects non-refs', () => {
    expect(parseGlobalRef('nocolon')).toBeNull();
    expect(parseGlobalRef(':leading')).toBeNull();
    expect(parseGlobalRef('trailing:')).toBeNull();
  });
});

// ── correlation algebra ──────────────────────────────────────────────────────
describe('childCorrelationMeta — inherit vs root', () => {
  it('roots the transaction at the source when the source has no correlation', () => {
    const source = rec('rec_q1');
    const meta = childCorrelationMeta(source, 'sales-quotes');
    expect(meta[CORRELATION_ID_KEY]).toBe('sales-quotes:rec_q1');
    expect(meta[CORRELATION_ROOT_KEY]).toBe('sales-quotes:rec_q1');
    expect(meta[CAUSATION_ID_KEY]).toBe('rec_q1');
    expect(meta[CAUSED_BY_MODULE_KEY]).toBe('sales-quotes');
  });
  it('inherits the correlationId + root when the source already has one', () => {
    const source = rec('rec_o1', {
      [CORRELATION_ID_KEY]: 'sales-quotes:rec_q1',
      [CORRELATION_ROOT_KEY]: 'sales-quotes:rec_q1',
    });
    const meta = childCorrelationMeta(source, 'sales-orders');
    // Same transaction — NOT a new root.
    expect(meta[CORRELATION_ID_KEY]).toBe('sales-quotes:rec_q1');
    expect(meta[CORRELATION_ROOT_KEY]).toBe('sales-quotes:rec_q1');
    // But the immediate cause is the order, not the quote.
    expect(meta[CAUSATION_ID_KEY]).toBe('rec_o1');
    expect(meta[CAUSED_BY_MODULE_KEY]).toBe('sales-orders');
  });
  it('a whole chain converges on ONE correlationId as it inherits down', () => {
    const quote = rec('rec_q1');
    const orderMeta = childCorrelationMeta(quote, 'sales-quotes');
    const order = rec('rec_o1', orderMeta as Record<string, string>);
    const invoiceMeta = childCorrelationMeta(order, 'sales-orders');
    expect(invoiceMeta[CORRELATION_ID_KEY]).toBe(orderMeta[CORRELATION_ID_KEY]);
    expect(invoiceMeta[CORRELATION_ID_KEY]).toBe('sales-quotes:rec_q1');
  });
});

describe('rootMetaIfUnset — stamp the origin, never overwrite an inherited chain', () => {
  it('stamps a record with no correlation as its own root', () => {
    const meta = rootMetaIfUnset(rec('rec_o1'), 'sales-orders');
    expect(meta[CORRELATION_ID_KEY]).toBe('sales-orders:rec_o1');
    expect(meta[CORRELATION_ROOT_KEY]).toBe('sales-orders:rec_o1');
    expect(meta[CAUSATION_ID_KEY]).toBeUndefined(); // a root has no cause
  });
  it('returns {} for a record already in a transaction (never clobbers the chain)', () => {
    const inChain = rec('rec_o1', { [CORRELATION_ID_KEY]: 'sales-quotes:rec_q1' });
    expect(rootMetaIfUnset(inChain, 'sales-orders')).toEqual({});
  });
});

describe('readCorrelation', () => {
  it('returns nulls for an unstamped record and values for a stamped one', () => {
    expect(readCorrelation(rec('x'))).toEqual({
      correlationId: null,
      causationId: null,
      causedByModule: null,
      correlationRoot: null,
    });
    const stamped = rec('y', {
      [CORRELATION_ID_KEY]: 'c',
      [CAUSATION_ID_KEY]: 'p',
      [CAUSED_BY_MODULE_KEY]: 'mod',
      [CORRELATION_ROOT_KEY]: 'c',
    });
    expect(readCorrelation(stamped)).toEqual({
      correlationId: 'c',
      causationId: 'p',
      causedByModule: 'mod',
      correlationRoot: 'c',
    });
  });
});

// ── trace reconstruction ─────────────────────────────────────────────────────
describe('traceTransactionGraph', () => {
  const CID = 'sales-quotes:rec_q1';

  it('reconstructs a multi-module chain root-first, ordered by causation depth', async () => {
    const quotes = fakeModule('sales-quotes', [
      rec('rec_q1', { [CORRELATION_ID_KEY]: CID, [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'sales-quotes', updatedAt: '2026-08-31T12:00:00.000Z' }),
    ]);
    const orders = fakeModule('sales-orders', [
      rec('rec_o1', { [CORRELATION_ID_KEY]: CID, [CAUSATION_ID_KEY]: 'rec_q1', [CAUSED_BY_MODULE_KEY]: 'sales-quotes', [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'sales-orders', updatedAt: '2026-08-31T12:00:01.000Z' }),
    ]);
    const finance = fakeModule('finance', [
      rec('rec_i1', { [CORRELATION_ID_KEY]: CID, [CAUSATION_ID_KEY]: 'rec_o1', [CAUSED_BY_MODULE_KEY]: 'sales-orders', [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'finance', updatedAt: '2026-08-31T12:00:02.000Z' }),
    ]);
    const graph = await traceTransactionGraph([finance, orders, quotes], CID);
    expect(graph.map((n) => `${n.moduleId}:${n.recordId}`)).toEqual([
      'sales-quotes:rec_q1',
      'sales-orders:rec_o1',
      'finance:rec_i1',
    ]);
    expect(graph[0].isRoot).toBe(true);
    expect(graph[0].depth).toBe(0);
    expect(graph[1].depth).toBe(1);
    expect(graph[2].depth).toBe(2);
    expect(graph[2].parentRef).toBe('sales-orders:rec_o1');
  });

  it('includes the root even when it was never stamped (resolved from the correlationId ref)', async () => {
    // The quote carries NO correlation metadata, but the order points back at it.
    const quotes = fakeModule('sales-quotes', [rec('rec_q1', {}, { moduleId: 'sales-quotes' })]);
    const orders = fakeModule('sales-orders', [
      rec('rec_o1', { [CORRELATION_ID_KEY]: CID, [CAUSATION_ID_KEY]: 'rec_q1', [CAUSED_BY_MODULE_KEY]: 'sales-quotes', [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'sales-orders' }),
    ]);
    const graph = await traceTransactionGraph([quotes, orders], CID);
    const refs = graph.map((n) => `${n.moduleId}:${n.recordId}`);
    expect(refs).toContain('sales-quotes:rec_q1'); // root pulled in by ref resolution
    expect(refs).toContain('sales-orders:rec_o1');
    expect(graph.find((n) => n.recordId === 'rec_q1')?.isRoot).toBe(true);
  });

  it('handles a fan-out (one source causing two children) at the same depth', async () => {
    const orders = fakeModule('sales-orders', [rec('rec_o1', { [CORRELATION_ID_KEY]: CID, [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'sales-orders' })]);
    const finance = fakeModule('finance', [rec('rec_i1', { [CORRELATION_ID_KEY]: CID, [CAUSATION_ID_KEY]: 'rec_o1', [CAUSED_BY_MODULE_KEY]: 'sales-orders', [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'finance' })]);
    const movements = fakeModule('inventory-movements', [rec('rec_m1', { [CORRELATION_ID_KEY]: CID, [CAUSATION_ID_KEY]: 'rec_o1', [CAUSED_BY_MODULE_KEY]: 'sales-orders', [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'inventory-movements' })]);
    const graph = await traceTransactionGraph([orders, finance, movements], CID);
    expect(graph).toHaveLength(3);
    expect(graph.filter((n) => n.depth === 1)).toHaveLength(2); // invoice + movement both caused by the order
  });

  it('excludes records of OTHER transactions and deleted records', async () => {
    const orders = fakeModule('sales-orders', [
      rec('rec_o1', { [CORRELATION_ID_KEY]: CID, [CORRELATION_ROOT_KEY]: CID }, { moduleId: 'sales-orders' }),
      rec('rec_o2', { [CORRELATION_ID_KEY]: 'sales-orders:rec_o2', [CORRELATION_ROOT_KEY]: 'sales-orders:rec_o2' }, { moduleId: 'sales-orders' }), // different txn
      rec('rec_o3', { [CORRELATION_ID_KEY]: CID }, { moduleId: 'sales-orders', status: 'deleted' }), // deleted
    ]);
    const graph = await traceTransactionGraph([orders], CID);
    expect(graph.map((n) => n.recordId)).toEqual(['rec_o1']);
  });

  it('returns [] for an empty correlationId', async () => {
    const orders = fakeModule('sales-orders', [rec('rec_o1', { [CORRELATION_ID_KEY]: CID })]);
    expect(await traceTransactionGraph([orders], '')).toEqual([]);
  });
});
