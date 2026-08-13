import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  convertAmount,
  currencyPairCode,
  resolveExchangeRate,
  type EnterpriseEntity,
  type ExchangeRate,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createExchangeRateModule } from './exchangeRateModule';

const T0 = '2026-08-06T00:00:00.000Z';

const rate = (over: Partial<ExchangeRate>): ExchangeRate => ({
  id: `r-${randomUUID().slice(0, 6)}`, fromCurrency: 'USD', toCurrency: 'INR', rate: 83, effectiveFrom: '2026-04-01', source: '', lockedAt: null, createdAt: T0, updatedAt: T0, ...over,
});

describe('Exchange-rate resolution + conversion (pure)', () => {
  it('resolves the latest rate on/before the date, honors same-currency and inverse pairs', () => {
    const rates = [
      rate({ id: 'a', rate: 82, effectiveFrom: '2026-04-01' }),
      rate({ id: 'b', rate: 84, effectiveFrom: '2026-08-01' }),
    ];
    expect(resolveExchangeRate(rates, 'USD', 'INR', '2026-08-06')).toBe(84); // latest ≤ date
    expect(resolveExchangeRate(rates, 'USD', 'INR', '2026-05-01')).toBe(82); // earlier window
    expect(resolveExchangeRate(rates, 'USD', 'INR', '2026-03-01')).toBeNull(); // before any rate
    expect(resolveExchangeRate(rates, 'usd', 'usd', '2026-08-06')).toBe(1); // same currency
    // Inverse: only USD→INR exists, ask INR→USD.
    expect(resolveExchangeRate([rate({ rate: 80 })], 'INR', 'USD', '2026-08-06')).toBe(0.0125);
    // Unknown pair → null (never assume 1:1).
    expect(resolveExchangeRate(rates, 'EUR', 'JPY', '2026-08-06')).toBeNull();
  });

  it('converts money and reports the rate, leaving amount null when unresolved', () => {
    const rates = [rate({ rate: 84 })];
    expect(convertAmount(rates, 1000, 'USD', 'INR', '2026-08-06')).toEqual({ amount: 84000, rate: 84, from: 'USD', to: 'INR' });
    expect(convertAmount(rates, 1000, 'EUR', 'INR', '2026-08-06')).toEqual({ amount: null, rate: null, from: 'EUR', to: 'INR' });
    expect(currencyPairCode('usd', 'inr')).toBe('USD-INR');
  });
});

describe('Exchange-rate module over a real store', () => {
  let dir: string;
  let rates: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fx-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    rates = createExchangeRateModule(join(dir, 'rates.json'));
    await rates.store.load();
    ctx = { actor: () => 't@np', now: () => T0, authorize: () => undefined, moduleFor: () => null, emit: () => undefined };
  });

  afterEach(async () => {
    await rates.store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const make = (fields: Record<string, unknown>): EnterpriseEntity => {
    const v = rates.hooks.validate({ fields: { fromCurrency: 'USD', toCurrency: 'INR', rate: 84, effectiveFrom: '2026-08-01', ...fields } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return rates.store.create({ title: String(v.values.pairCode), fields: v.values, actor: 't@np', now: T0 });
  };

  it('validates codes and rate, stamps the pair, and refuses same-currency or bad input', () => {
    const rec = make({});
    expect(rec.fields.pairCode).toBe('USD-INR');
    expect(rec.fields.status).toBe('active');
    expect(rates.hooks.validate({ fields: { fromCurrency: 'US', toCurrency: 'INR', rate: 84, effectiveFrom: '2026-08-01' } }).ok).toBe(false);
    expect(rates.hooks.validate({ fields: { fromCurrency: 'USD', toCurrency: 'USD', rate: 1, effectiveFrom: '2026-08-01' } }).ok).toBe(false);
    expect(rates.hooks.validate({ fields: { fromCurrency: 'USD', toCurrency: 'INR', rate: 0, effectiveFrom: '2026-08-01' } }).ok).toBe(false);
  });

  it('locks a rate into immutable history — edits and re-lock refused, forged marker refused', async () => {
    const rec = make({});
    const locked = await rates.hooks.runAction!('lock', rec, ctx);
    expect(locked.ok).toBe(true);
    const frozen = rates.store.get(rec.id)!;
    expect(frozen.fields.status).toBe('locked');
    expect(rates.hooks.validate({ fields: { ...frozen.fields, rate: 90 } }).ok).toBe(false);
    expect((await rates.hooks.runAction!('lock', frozen, ctx)).ok).toBe(false);
    expect(rates.hooks.validate({ fields: { fromCurrency: 'USD', toCurrency: 'INR', rate: 84, effectiveFrom: '2026-08-01', lockedAt: T0 } }).ok).toBe(false);
  });
});
