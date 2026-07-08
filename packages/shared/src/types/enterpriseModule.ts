/**
 * Enterprise Module Framework — the shared contract every ERP module is built
 * on (Finance, CRM, Sales, Inventory, HR, Projects, …).
 *
 * A module is described ONCE, here, as an `EnterpriseModuleDescriptor`: its
 * identity, the fields its records carry, and the permissions its reads/writes
 * require. That single descriptor drives everything downstream — the backend
 * record store + validation, the generic CRUD IPC surface, and the renderer's
 * generic list/detail/form UI — so a new module ships without hand-writing a
 * store, a set of handlers, or a screen.
 *
 * Records follow the UDM's "one flat canonical record" philosophy: every module
 * entity is the same `EnterpriseEntity` shape with a primitive `fields` bag, so
 * the store, search, timeline, and UI stay uniform across all modules.
 *
 * This module holds ONLY types + pure helpers (no I/O), so it is shared by the
 * main process, the renderer, and the tests without pulling in a runtime.
 */
import type { EnterprisePermission } from './enterprise';

/** Lifecycle status shared by every enterprise record. */
export type EnterpriseRecordStatus = 'active' | 'archived' | 'deleted';

export const ENTERPRISE_RECORD_STATUSES: readonly EnterpriseRecordStatus[] = [
  'active',
  'archived',
  'deleted',
];

/** The primitive value a record field may hold (flat, cheaply serializable). */
export type EnterpriseFieldValue = string | number | boolean | null;

/** Free-form, primitive-valued metadata bag carried by every record. */
export type EnterpriseRecordMeta = Record<string, string | number | boolean | null>;

/**
 * A single canonical enterprise record. Every module's entities share this
 * shape; module-specific data lives in the `fields` bag, keyed by the module's
 * `EnterpriseFieldDef.key`s.
 */
export interface EnterpriseEntity {
  id: string;
  /** The module that owns this record (e.g. 'finance', 'crm'). */
  moduleId: string;
  /** The record kind within the module (usually the module's singular slug). */
  kind: string;
  /** The human title, derived from the module's `titleField`. */
  title: string;
  status: EnterpriseRecordStatus;
  /** Module-specific data, keyed by field key. */
  fields: Record<string, EnterpriseFieldValue>;
  tags: string[];
  /** Monotonic revision, bumped on every write — the seam for cloud-sync LWW. */
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** Actor (email/id) that created / last-updated the record, if known. */
  createdBy: string | null;
  updatedBy: string | null;
  metadata: EnterpriseRecordMeta;
}

/** The input a caller supplies to create or update a record. */
export interface EnterpriseRecordInput {
  title?: string;
  fields?: Record<string, EnterpriseFieldValue>;
  tags?: string[];
  metadata?: EnterpriseRecordMeta;
}

/** The kinds of field a module can declare. Drives validation + the form UI. */
export type EnterpriseFieldType = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'date';

export interface EnterpriseFieldOption {
  value: string;
  label: string;
  /** Optional Badge tone for this option when rendered as a badge (renderer maps it). */
  tone?: string;
}

/** A field a module's records carry — the unit of both validation and UI. */
export interface EnterpriseFieldDef {
  key: string;
  label: string;
  type: EnterpriseFieldType;
  required?: boolean;
  /** Options for `select` fields. */
  options?: EnterpriseFieldOption[];
  placeholder?: string;
  help?: string;
  /** Numeric bounds for `number` fields. */
  min?: number;
  max?: number;
  /** Default value applied when a create omits the field (form + validation). */
  default?: EnterpriseFieldValue;
  /** Whether to show this field as a column in the list view (default: true). */
  column?: boolean;
  /** Display formatting hint for the list/detail (generic renderer). */
  format?: 'currency' | 'date';
  /** Render a `select` field's value as a colored Badge (uses the option tone). */
  badge?: boolean;
  /** Offer this `select` field as a filter (chip row) in the list view. */
  filterable?: boolean;
  /**
   * A computed/display-only field: shown in the list + detail, but hidden from
   * the create/edit form (its value is derived by the module, e.g. a lead score).
   */
  readOnly?: boolean;
}

/**
 * The complete, declarative description of a module. Defined once (backend) and
 * shipped to the renderer verbatim so the UI is fully generic.
 */
export interface EnterpriseModuleDescriptor {
  id: string;
  title: string;
  /** Singular noun for one record, e.g. 'Invoice'. */
  singular: string;
  /** Plural noun for the collection, e.g. 'Invoices'. */
  plural: string;
  /** Icon name (resolved by the renderer icon set). */
  icon: string;
  description: string;
  /** Optional grouping label for the module rail (e.g. 'Finance', 'Operations'). */
  group?: string;
  fields: EnterpriseFieldDef[];
  /** The field key whose value becomes the record's title. */
  titleField: string;
  /** The enterprise permissions a read / write on this module requires. */
  permissions: { read: EnterprisePermission; write: EnterprisePermission };
  /** Custom record actions surfaced as buttons in the detail view (e.g. convert). */
  actions?: EnterpriseRecordActionDef[];
}

/** A custom, module-defined action a user can run on one record. */
export interface EnterpriseRecordActionDef {
  key: string;
  label: string;
  /** Icon name (resolved by the renderer icon set). */
  icon?: string;
}

/** The result of running a record action (create/convert/etc.). */
export interface EnterpriseModuleActionResult {
  ok: boolean;
  message?: string;
  /** field/record-level error message on failure. */
  error?: string;
}

/** A module descriptor plus live counts — the payload of `enterprise:modules`. */
export interface EnterpriseModuleSummary extends EnterpriseModuleDescriptor {
  recordCount: number;
  activeCount: number;
  /** True when the module exposes an AI record summary (a `summarize` hook). */
  aiSummary: boolean;
  /** Record actions available on this module (empty when none). */
  actions: EnterpriseRecordActionDef[];
}

/** Coarse risk band a module can attach to a record's AI summary. */
export type EnterpriseRiskLevel = 'low' | 'medium' | 'high';

/**
 * An AI-assisted record summary — the payload of `enterprise:module.summarize`.
 * The risk band + reason are deterministic (grounded); `grounded` reports whether
 * a real model produced the narrative or the deterministic fallback was used.
 */
export interface EnterpriseRecordSummary {
  moduleId: string;
  recordId: string;
  headline: string;
  summary: string;
  risk: EnterpriseRiskLevel;
  riskReason: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

/** Query for a module's record list. */
export interface EnterpriseRecordQuery {
  status?: EnterpriseRecordStatus;
  search?: string;
  limit?: number;
}

/** The result of a record mutation (create/update/status/delete). */
export interface EnterpriseModuleMutationResult {
  ok: boolean;
  record?: EnterpriseEntity;
  /** field key → message on validation/precondition failure (`_` for record-level). */
  errors?: Record<string, string>;
}

export type EnterpriseModuleLifecycleAction =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'deleted'
  | 'converted';

/** The payload broadcast on `enterprise:module.event`. */
export interface EnterpriseModuleEvent {
  moduleId: string;
  action: EnterpriseModuleLifecycleAction;
  id: string;
  at: string;
}

/** The result of validating a record input against a descriptor. */
export interface EnterpriseRecordValidation {
  ok: boolean;
  /** field key → message, for the first problem on each field. */
  errors: Record<string, string>;
  /** Coerced, cleaned values for the descriptor's declared fields. */
  values: Record<string, EnterpriseFieldValue>;
}

/* ── pure helpers (shared by backend validation + renderer forms) ─────────── */

/** Legal record-status transitions. `deleted` is terminal (soft-delete). */
export const RECORD_STATUS_TRANSITIONS: Record<
  EnterpriseRecordStatus,
  readonly EnterpriseRecordStatus[]
> = {
  active: ['archived', 'deleted'],
  archived: ['active', 'deleted'],
  deleted: [],
};

export function canTransitionRecordStatus(
  from: EnterpriseRecordStatus,
  to: EnterpriseRecordStatus,
): boolean {
  if (from === to) return true;
  return RECORD_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Coerce a raw value to the field's declared type. Returns null when empty. */
export function coerceFieldValue(def: EnterpriseFieldDef, raw: unknown): EnterpriseFieldValue {
  if (raw === undefined || raw === null || raw === '') return null;
  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
    case 'select':
    case 'text':
    case 'textarea':
    case 'date':
    default:
      return String(raw);
  }
}

/**
 * Validate + coerce a record input against a module descriptor. Pure: no I/O,
 * so the backend store and the renderer form share exactly one implementation.
 */
export function validateEnterpriseRecordInput(
  descriptor: EnterpriseModuleDescriptor,
  input: EnterpriseRecordInput,
): EnterpriseRecordValidation {
  const errors: Record<string, string> = {};
  const values: Record<string, EnterpriseFieldValue> = {};
  const raw = input.fields ?? {};

  for (const field of descriptor.fields) {
    let value = coerceFieldValue(field, raw[field.key]);
    // Apply the field's default when the input omits it.
    if (value === null && field.default !== undefined)
      value = coerceFieldValue(field, field.default);
    if (field.required && (value === null || value === '')) {
      errors[field.key] = `${field.label} is required.`;
      values[field.key] = value;
      continue;
    }
    if (value !== null) {
      if (field.type === 'number' && typeof value === 'number') {
        if (field.min !== undefined && value < field.min) {
          errors[field.key] = `${field.label} must be at least ${field.min}.`;
        } else if (field.max !== undefined && value > field.max) {
          errors[field.key] = `${field.label} must be at most ${field.max}.`;
        }
      }
      if (field.type === 'select' && typeof value === 'string' && field.options) {
        if (!field.options.some((o) => o.value === value)) {
          errors[field.key] = `${field.label} is not a valid option.`;
        }
      }
    }
    values[field.key] = value;
  }

  return { ok: Object.keys(errors).length === 0, errors, values };
}

/** Derive a record's title from its values via the descriptor's `titleField`. */
export function deriveRecordTitle(
  descriptor: EnterpriseModuleDescriptor,
  values: Record<string, EnterpriseFieldValue>,
  explicit?: string,
): string {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return fromExplicit;
  const v = values[descriptor.titleField];
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s || `Untitled ${descriptor.singular}`;
}

/** Case-insensitive text match over a record's title, tags, and field values. */
export function matchesRecordSearch(entity: EnterpriseEntity, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entity.title.toLowerCase().includes(q)) return true;
  if (entity.tags.some((t) => t.toLowerCase().includes(q))) return true;
  for (const value of Object.values(entity.fields)) {
    if (value !== null && String(value).toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Validate a module descriptor's internal consistency. Returns the list of
 * problems (empty when valid) — the framework refuses to register a bad module.
 */
export function validateModuleDescriptor(descriptor: EnterpriseModuleDescriptor): string[] {
  const problems: string[] = [];
  if (!descriptor.id.trim()) problems.push('Module id is required.');
  if (!/^[a-z][a-z0-9-]*$/.test(descriptor.id)) {
    problems.push(`Module id "${descriptor.id}" must be kebab-case (a-z, 0-9, -).`);
  }
  if (descriptor.fields.length === 0) problems.push('A module must declare at least one field.');
  const keys = new Set<string>();
  for (const f of descriptor.fields) {
    if (keys.has(f.key)) problems.push(`Duplicate field key "${f.key}".`);
    keys.add(f.key);
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      problems.push(`Select field "${f.key}" must declare options.`);
    }
  }
  if (!keys.has(descriptor.titleField)) {
    problems.push(`titleField "${descriptor.titleField}" is not a declared field.`);
  }
  return problems;
}
