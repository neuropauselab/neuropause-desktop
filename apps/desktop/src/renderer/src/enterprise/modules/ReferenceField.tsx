/**
 * ERP Session 50 — reference pickers for GENUINELY relational procurement fields.
 *
 * The S50 census measured which operator-typed fields are consumed main-side as
 * lookup KEYS (each with a named refusal or a measured silent-miss cost) versus
 * descriptive text. Only consumed references are registered here — descriptive
 * fields keep their plain input, deliberately. Two field classes, two shapes:
 *
 *   'id'   — the consumer matches the RECORD ID (strict, e.g. `assignSupplier`'s
 *            tenant-scoped `store.get`, `evaluateBudgetControl`'s `r.id === ref`)
 *            or id-first (`findBill`, three-way-match PO resolve). Rendered as a
 *            Select storing the canonical id, showing the human label.
 *   'name' — the consumer matches by NAME (contract gate, three-way match vendor
 *            limb, supplier scorecards). A value outside the master is LEGAL
 *            today, so a closed Select would invent membership policy — rendered
 *            as an Input + datalist: suggestions from the master, free text kept.
 *
 * Choices come from the EXISTING tenant-scoped, RBAC'd read door
 * (`enterprise:module.list`) — no new IPC, no second source of truth, and no
 * widened authority: a caller without read permission on the target module gets
 * a refusal and the field FALLS BACK to the plain text input (fail-safe for the
 * form; main-side consumers still validate whatever is submitted). Cross-tenant
 * ids remain refused where they always were — at the main-side consumer.
 *
 * A stored value that resolves to no live choice (legacy number-refs, deleted
 * targets) is preserved as an explicit "(unresolved)" option — editing a record
 * never silently destroys a reference the operator did not touch.
 */
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  BUDGETS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  SUPPLIERS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_CONTRACTS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  type EnterpriseEntity,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Input, Select } from '@renderer/components/ui/Input';

export interface ReferenceFieldConfig {
  /** Module whose records supply the choices (read via the existing RBAC'd list door). */
  targetModuleId: string;
  /** Field on the target record shown as the label (its titleField). */
  labelField: string;
  /** Optional second field appended to the label for disambiguation. */
  detailField?: string;
  /** What the consumer matches on: the record id (strict Select) or a name field (open datalist). */
  match: 'id' | 'name';
}

/**
 * (moduleId → fieldKey → target). Every entry is census-backed; the main-side
 * consumer and its refusal are cited in SESSION50-PROCUREMENT-SURFACE-HARDENING.md.
 * `procurement-receipts.purchaseOrder` is deliberately ABSENT: it is
 * conversion-stamped readOnly and the form never renders it.
 */
const REFERENCE_FIELDS: Record<string, Record<string, ReferenceFieldConfig>> = {
  [PURCHASE_ORDERS_MODULE_ID]: {
    // assignSupplier → tenant-scoped store.get(id); foreign/suspended refused.
    supplierRef: { targetModuleId: SUPPLIERS_MODULE_ID, labelField: 'name', match: 'id' },
    // evaluateBudgetControl → budgets.find(r.id === ref); dangling ref never approves,
    // but a wrong-but-real id commits spend against the wrong budget silently.
    budgetRef: { targetModuleId: BUDGETS_MODULE_ID, labelField: 'budgetName', match: 'id' },
    // evaluateContractGate → contracts.find(r.id === ref); dangling/foreign-supplier refused.
    contractRef: { targetModuleId: VENDOR_CONTRACTS_MODULE_ID, labelField: 'contractNumber', detailField: 'supplier', match: 'id' },
    // Name-keyed by THREE consumers (contract gate ci, three-way match byte-exact,
    // supplier scorecards silent) — suggestions kill the misspelling class; free text stays legal.
    supplier: { targetModuleId: SUPPLIERS_MODULE_ID, labelField: 'name', match: 'name' },
  },
  [VENDOR_BILLS_MODULE_ID]: {
    // Bill validate + three-way match resolve id-or-poNumber; id is canonical.
    sourcePurchaseOrder: { targetModuleId: PURCHASE_ORDERS_MODULE_ID, labelField: 'poNumber', detailField: 'supplier', match: 'id' },
    // The vendor limb of the three-way match is byte-exact vs po.supplier.
    vendor: { targetModuleId: SUPPLIERS_MODULE_ID, labelField: 'name', match: 'name' },
  },
  [VENDOR_PAYMENTS_MODULE_ID]: {
    // findBill(id or billNumber); duplicate bill numbers resolve silently — the id doesn't.
    billRef: { targetModuleId: VENDOR_BILLS_MODULE_ID, labelField: 'billNumber', detailField: 'vendor', match: 'id' },
  },
};

export function referenceFieldFor(moduleId: string, fieldKey: string): ReferenceFieldConfig | null {
  return REFERENCE_FIELDS[moduleId]?.[fieldKey] ?? null;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export function ReferenceField({
  id,
  config,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  config: ReferenceFieldConfig;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const [records, setRecords] = useState<EnterpriseEntity[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc.enterpriseModules
      .records(config.targetModuleId, { limit: 500 })
      .then((rows) => {
        if (alive) setRecords(Array.isArray(rows) ? (rows as EnterpriseEntity[]) : []);
      })
      .catch(() => {
        // Read refused (RBAC) or transport failure — the operator keeps a working
        // plain input; main-side consumers still validate whatever is typed.
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [config.targetModuleId]);

  const labelOf = (r: EnterpriseEntity): string => {
    const label = str(r.fields[config.labelField]) || r.title || r.id;
    const detail = config.detailField ? str(r.fields[config.detailField]) : '';
    return detail ? `${label} — ${detail}` : label;
  };

  const options = useMemo(() => {
    if (config.match === 'name') {
      // datalist suggestions carry the NAME itself as the value
      const names = new Set<string>();
      for (const r of records ?? []) {
        const n = str(r.fields[config.labelField]);
        if (n) names.add(n);
      }
      return [...names].map((n) => ({ value: n, label: n }));
    }
    const opts = (records ?? []).map((r) => ({ value: r.id, label: labelOf(r) }));
    // Preserve a stored value that matches no live choice rather than destroying it.
    if (value && !opts.some((o) => o.value === value)) {
      opts.unshift({ value, label: `${value} (unresolved)` });
    }
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, value, config.match, config.labelField, config.detailField]);

  if (failed || (config.match === 'name' && records === null)) {
    // name-mode renders a working input immediately; suggestions attach when loaded
    return (
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    );
  }

  if (config.match === 'name') {
    const listId = `${id}-choices`;
    return (
      <>
        <Input
          id={id}
          list={listId}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o.value} value={o.value} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <Select
      id={id}
      value={value}
      placeholder={records === null ? 'Loading…' : 'None'}
      options={options}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
