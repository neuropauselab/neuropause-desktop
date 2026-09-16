/**
 * ERP Session 50 — structured line editor retiring the raw "Lines (JSON)" textarea
 * for the procurement chain.
 *
 * MEASURED (census, SESSION50-PROCUREMENT-SURFACE-HARDENING.md): `fields.lines`
 * JSON is the ONE canonical line model on the buy side — PR lines carry VERBATIM
 * to the PO (conversion.ts), the PO subtotal derives from them, the GR post and
 * the three-way match read them through `procurementLines.ts`. The adopted
 * document-line store is a second, unsynced representation whose accounting legs
 * are structurally dead — so this editor deliberately does NOT touch it.
 *
 * This component is renderer-only: it EDITS the same JSON string the textarea
 * edited, serializing on every change back into the form state, so the persisted
 * shape, the command payloads, the conversion and every main-side parser are
 * byte-compatible and untouched. Main-side validation stays authoritative — the
 * totals shown here are a preview, labelled as derived.
 *
 * Honesty rules:
 *  - alias keys the canonical parser accepts (productId/product, qty,
 *    price/unitCost, orderedQuantity/quantityReceived) are READ so legacy rows
 *    display correctly; edits serialize the canonical key while unknown extra
 *    keys on a row are PRESERVED verbatim (never silently dropped);
 *  - a `lines` value that does not parse as a JSON array falls back to the raw
 *    textarea with the original text intact — operator data is never destroyed.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import {
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
} from '@neuropause/shared';
import { Button } from '@renderer/components/ui/Button';
import { Input, Textarea } from '@renderer/components/ui/Input';

type LineShape = 'priced' | 'receipt';

export interface LinesEditorConfig {
  /** 'priced' = {sku, quantity, unitPrice} (PR / PO / vendor bill); 'receipt' = {sku, quantity, poLine?, warehouse?}. */
  shape: LineShape;
}

/** Procurement-chain adopters only — other modules' `lines` fields carry DIFFERENT
 *  shapes (GL journal lines, bank statements, payroll…) and keep their textarea. */
const LINES_FIELDS: Record<string, Record<string, LinesEditorConfig>> = {
  [PURCHASE_REQUESTS_MODULE_ID]: { lines: { shape: 'priced' } },
  [PURCHASE_ORDERS_MODULE_ID]: { lines: { shape: 'priced' } },
  [VENDOR_BILLS_MODULE_ID]: { lines: { shape: 'priced' } },
  [GOODS_RECEIPTS_MODULE_ID]: { lines: { shape: 'receipt' } },
};

export function linesEditorFor(moduleId: string, fieldKey: string): LinesEditorConfig | null {
  return LINES_FIELDS[moduleId]?.[fieldKey] ?? null;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Mirror of the canonical parser's ALIAS reads (procurementLines.ts) — display only. */
function readSku(row: Row): string {
  return str(row.sku ?? row.productId ?? row.product);
}
function readQty(row: Row, shape: LineShape): number {
  return num(row.quantity ?? (shape === 'receipt' ? row.quantityReceived : row.orderedQuantity) ?? row.qty);
}
function readPrice(row: Row): number {
  return num(row.unitPrice ?? row.price ?? row.unitCost);
}

/** null = malformed (fallback to textarea); [] = empty/absent. */
function parseRows(raw: string): Row[] | null {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((r) => (r && typeof r === 'object' ? (r as Row) : {}));
  } catch {
    return null;
  }
}

export function LinesEditor({
  id,
  config,
  value,
  onChange,
}: {
  id: string;
  config: LinesEditorConfig;
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const rows = useMemo(() => parseRows(value), [value]);

  if (rows === null) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-amber-300">
          These lines could not be read as a table — fix the JSON below and they will appear as
          editable rows.
        </p>
        <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  const write = (next: Row[]): void => onChange(next.length ? JSON.stringify(next) : '');
  // Serialize the canonical key; drop the aliases it replaces; keep every other key verbatim.
  const setCell = (i: number, key: 'sku' | 'quantity' | 'unitPrice' | 'poLine' | 'warehouse', v: string): void => {
    const next = rows.map((r) => ({ ...r }));
    const row = next[i];
    if (key === 'sku') {
      delete row.productId;
      delete row.product;
      row.sku = v;
    } else if (key === 'quantity') {
      delete row.qty;
      delete row.orderedQuantity;
      delete row.quantityReceived;
      row.quantity = v === '' ? 0 : num(v);
    } else if (key === 'unitPrice') {
      delete row.price;
      delete row.unitCost;
      row.unitPrice = v === '' ? 0 : num(v);
    } else if (key === 'poLine') {
      // optional 1-based PO line — absent means "resolve by SKU"
      if (v === '') delete row.poLine;
      else row.poLine = Math.trunc(num(v));
    } else {
      if (v === '') delete row.warehouse;
      else row.warehouse = v;
    }
    write(next);
  };

  const priced = config.shape === 'priced';
  const subtotal = priced
    ? Math.round(rows.reduce((n, r) => n + readQty(r, config.shape) * readPrice(r), 0) * 100) / 100
    : 0;

  return (
    <div className="space-y-2" data-testid={`${id}-lines-editor`}>
      {rows.length > 0 && (
        <div
          className="grid items-center gap-1.5 text-xs text-faint"
          style={{ gridTemplateColumns: priced ? '1fr 90px 110px 90px 28px' : '1fr 90px 80px 110px 28px' }}
        >
          <span>SKU</span>
          <span>Qty</span>
          {priced ? <span>Unit price</span> : <span>PO line</span>}
          {priced ? <span className="text-right">Amount</span> : <span>Warehouse</span>}
          <span />
        </div>
      )}
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid items-center gap-1.5"
          style={{ gridTemplateColumns: priced ? '1fr 90px 110px 90px 28px' : '1fr 90px 80px 110px 28px' }}
        >
          <Input
            aria-label={`Line ${i + 1} SKU`}
            value={readSku(row)}
            placeholder="SKU-0001"
            onChange={(e) => setCell(i, 'sku', e.target.value)}
          />
          <Input
            aria-label={`Line ${i + 1} quantity`}
            type="number"
            min={0}
            value={String(readQty(row, config.shape) || '')}
            onChange={(e) => setCell(i, 'quantity', e.target.value)}
          />
          {priced ? (
            <Input
              aria-label={`Line ${i + 1} unit price`}
              type="number"
              min={0}
              step="0.01"
              value={String(readPrice(row) || '')}
              onChange={(e) => setCell(i, 'unitPrice', e.target.value)}
            />
          ) : (
            <Input
              aria-label={`Line ${i + 1} PO line`}
              type="number"
              min={1}
              value={row.poLine === undefined || row.poLine === null ? '' : String(row.poLine)}
              placeholder="by SKU"
              onChange={(e) => setCell(i, 'poLine', e.target.value)}
            />
          )}
          {priced ? (
            <span className="text-right text-sm tabular-nums text-ink">
              {(Math.round(readQty(row, config.shape) * readPrice(row) * 100) / 100).toLocaleString(
                undefined,
                { minimumFractionDigits: 2, maximumFractionDigits: 2 },
              )}
            </span>
          ) : (
            <Input
              aria-label={`Line ${i + 1} warehouse`}
              value={str(row.warehouse ?? '')}
              placeholder="doc default"
              onChange={(e) => setCell(i, 'warehouse', e.target.value)}
            />
          )}
          <button
            type="button"
            aria-label={`Remove line ${i + 1}`}
            className="text-faint transition hover:text-syspink"
            onClick={() => write(rows.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => write([...rows, {}])}>
          Add line
        </Button>
        {priced && rows.length > 0 && (
          <span className="text-xs text-faint">
            Subtotal (derived):{' '}
            <span className="tabular-nums text-ink">
              {subtotal.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
