/**
 * What an export covers, and which of a module's fields may leave with it.
 *
 * Pure functions over records and descriptors — no store, no IPC, no clock —
 * so the handler and the tests exercise the same code, and the number shown on
 * the button is produced by the function that produces the file.
 *
 * Two properties this file exists to guarantee:
 *
 *   1. THE FILE MATCHES THE SCOPE THE USER SAW. Filters are applied here, once.
 *      `dp:export.plan` and `dp:export` both call `resolveScope`, so a preview
 *      saying "12 of 340" and a file containing 340 rows is not a state this
 *      code can reach.
 *
 *   2. SENSITIVE FIELDS DO NOT LEAVE BY ACCIDENT. Selection is computed from
 *      the descriptor by `selectableFields`, and `resolveFields` intersects the
 *      caller's request with it. A field the caller names that is not
 *      selectable is DROPPED and reported — never silently honoured, and never
 *      silently ignored either.
 */
import type {
  DataPlaneExportField,
  DataPlaneExportScopeKind,
  EnterpriseModuleDescriptor,
  SensitivityClass,
} from '@neuropause/shared';
import { classifyField, sensitivityReason } from '@neuropause/shared';
import type { EnterpriseEntity } from '@neuropause/shared';

/**
 * The most rows one export may carry.
 *
 * A refusal, not a truncation. Silently writing the first 50,000 of 80,000
 * records produces a file that looks complete and is not — the single worst
 * outcome available to an export feature, because the person who acts on it
 * has no way to notice.
 */
export const MAX_EXPORT_RECORDS = 50_000;

export interface ScopeInput {
  recordIds?: readonly string[] | undefined;
  filters?: readonly { field: string; value: string }[] | undefined;
  search?: string | undefined;
}

export interface ResolvedScope {
  kind: DataPlaneExportScopeKind;
  label: string;
  records: EnterpriseEntity[];
  /** Every live record in the module, so "N of M" can be stated honestly. */
  total: number;
  /** Ids that were asked for and are not in the module (or are deleted). */
  missingIds: string[];
  /** Filters that were APPLIED, with their labels, for the manifest. */
  appliedFilters: { field: string; label: string; value: string }[];
  /** Filters that were REFUSED, with the reason. Never silently dropped. */
  refusedFilters: { field: string; reason: string }[];
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Apply the scope to a module's live records.
 *
 * `recordIds` and `filters` COMPOSE rather than override. Selecting three rows
 * inside a filtered view and exporting must not quietly widen back to the
 * whole module, and an id that no longer matches the filter is a real
 * discrepancy the caller is told about rather than one resolved by guessing.
 */
export function resolveScope(
  all: readonly EnterpriseEntity[],
  descriptor: EnterpriseModuleDescriptor,
  scope: ScopeInput | undefined,
): ResolvedScope {
  const live = all.filter((r) => r.status !== 'deleted');
  const total = live.length;

  const ids = scope?.recordIds;
  const filters = (scope?.filters ?? []).filter((f) => f.value.length > 0);
  const search = scope?.search?.trim().toLowerCase() ?? '';

  let records = live;
  const parts: string[] = [];
  const appliedFilters: { field: string; label: string; value: string }[] = [];
  const refusedFilters: { field: string; reason: string }[] = [];

  /**
   * A filter may only name a field this actor could have exported anyway.
   *
   * Without this, `filters` was a value-confirmation oracle over exactly the
   * fields the rest of this file works to protect: a read-only actor could
   * send `{field: 'monthlySalary', value: '125000'}` and read the answer off
   * the record count — no file written, and nothing audited. The search path
   * below was already restricted for this reason; the filter path was not.
   *
   * Refusals are REPORTED, because a filter that is quietly ignored produces a
   * wider export than the caller asked for and they have no way to notice.
   */
  const byKey = new Map(descriptor.fields.map((f) => [f.key, f]));
  const usable: { field: string; value: string }[] = [];
  for (const f of filters) {
    const declared = byKey.get(f.field);
    if (!declared) {
      refusedFilters.push({ field: f.field, reason: `${descriptor.plural} have no “${f.field}” field.` });
      continue;
    }
    const cls = classifyField(declared);
    if (cls !== 'normal') {
      refusedFilters.push({
        field: f.field,
        reason: `“${declared.label}” holds ${cls === 'secret' ? 'authentication material' : 'a personal or financial identifier'}, so it cannot be used to narrow an export.`,
      });
      continue;
    }
    usable.push(f);
    appliedFilters.push({ field: f.field, label: declared.label, value: f.value });
  }

  if (usable.length > 0) {
    records = records.filter((r) =>
      usable.every((f) => textOf(r.fields[f.field]).toLowerCase() === f.value.toLowerCase()),
    );
    parts.push(...appliedFilters.map((f) => `${f.label} is ${f.value}`));
  }

  if (search !== '') {
    /**
     * The haystack is the TITLE and the non-sensitive values only.
     *
     * Searching a hidden field would let the box be used to confirm a salary
     * one digit at a time — the same reasoning as the import preview, and the
     * same rule, because it is the same threat.
     */
    const visible = descriptor.fields.filter((f) => classifyField(f) === 'normal').map((f) => f.key);
    records = records.filter((r) => {
      const hay = [r.title, ...visible.map((k) => textOf(r.fields[k]))].join(' ').toLowerCase();
      return hay.includes(search);
    });
    parts.push(`matching “${search}”`);
  }

  let missingIds: string[] = [];
  if (ids !== undefined) {
    const wanted = new Set(ids);
    const found = new Set(records.filter((r) => wanted.has(r.id)).map((r) => r.id));
    missingIds = [...wanted].filter((id) => !found.has(id));
    records = records.filter((r) => wanted.has(r.id));
  }

  const kind: DataPlaneExportScopeKind =
    ids !== undefined && ids.length === 1
      ? 'record'
      : ids !== undefined
        ? 'selected'
        : parts.length > 0
          ? 'filtered'
          : 'module';

  const label =
    kind === 'record'
      ? `One ${descriptor.singular.toLowerCase()}`
      : kind === 'selected'
        ? `${records.length} selected ${records.length === 1 ? descriptor.singular.toLowerCase() : descriptor.plural.toLowerCase()}`
        : kind === 'filtered'
          ? `${descriptor.plural} where ${parts.join(' and ')}`
          : `All ${descriptor.plural.toLowerCase()}`;

  return { kind, label, records, total, missingIds, appliedFilters, refusedFilters };
}

/**
 * Every field of a module, with whether it may be exported and why not.
 *
 * `mayAdminister` is the module's WRITE permission. Producing a payroll file
 * is a legitimate act for whoever administers payroll; it is not a legitimate
 * act for everyone who can read the employee list. Read access alone therefore
 * gets the record without the identifiers.
 */
export function selectableFields(
  descriptor: EnterpriseModuleDescriptor,
  mayAdminister: boolean,
): DataPlaneExportField[] {
  return descriptor.fields.map((f) => {
    const sensitivity: SensitivityClass = classifyField(f);
    const selectable =
      sensitivity === 'secret' ? false : sensitivity === 'restricted' ? mayAdminister : true;
    return {
      key: f.key,
      label: f.label,
      sensitivity,
      selectable,
      filterOptions:
        f.filterable === true && Array.isArray(f.options)
          ? f.options.map((o) => ({ value: String(o.value), label: o.label }))
          : null,
      // Restricted fields are never on by default, even for an administrator.
      // The export they belong in is the one someone asked for on purpose.
      defaultSelected: sensitivity === 'normal',
      reason:
        sensitivity === 'secret'
          ? sensitivityReason('secret')
          : sensitivity === 'restricted'
            ? mayAdminister
              ? sensitivityReason('restricted')
              : `Personal or financial identifier — only someone who can edit ${descriptor.plural.toLowerCase()} may export it.`
            : '',
    };
  });
}

export interface ResolvedFields {
  /** In descriptor order, whatever order the caller asked in. */
  keys: string[];
  columns: { key: string; label: string }[];
  excluded: { key: string; label: string; reason: string }[];
  /** True when at least one restricted field is actually being written. */
  includesRestricted: boolean;
}

/**
 * Intersect a requested field list with what the actor may export.
 *
 * The caller's order is discarded on purpose: descriptor order is stable
 * across exports of the same module, which is what makes two files
 * comparable. A named field that is not selectable lands in `excluded` with
 * its reason — refusing loudly, so a script that asks for `apiKey` learns that
 * it did not get it.
 */
export function resolveFields(
  descriptor: EnterpriseModuleDescriptor,
  available: readonly DataPlaneExportField[],
  requested: readonly string[] | undefined,
  includeRestricted: boolean,
): ResolvedFields {
  const wanted =
    requested === undefined
      ? new Set(available.filter((f) => f.defaultSelected).map((f) => f.key))
      : new Set(requested);

  const keys: string[] = [];
  const columns: { key: string; label: string }[] = [];
  const excluded: { key: string; label: string; reason: string }[] = [];
  let includesRestricted = false;

  for (const field of available) {
    const asked = wanted.has(field.key);
    if (field.sensitivity === 'secret') {
      // Named or not, it never goes. Reported only when someone asked, so an
      // ordinary export is not cluttered by a list of things nobody wanted.
      if (asked) excluded.push({ key: field.key, label: field.label, reason: field.reason });
      continue;
    }
    if (field.sensitivity === 'restricted') {
      if (!asked) continue;
      if (!field.selectable || !includeRestricted) {
        excluded.push({
          key: field.key,
          label: field.label,
          reason: field.selectable
            ? 'Restricted field — not included because this export did not explicitly request restricted data.'
            : field.reason,
        });
        continue;
      }
      includesRestricted = true;
    } else if (!asked) {
      continue;
    }
    keys.push(field.key);
    columns.push({ key: field.key, label: field.label });
  }

  /**
   * An export of nothing is not a smaller export; it is a mistake — BUT the
   * fallback only fires when the caller asked for nothing at all.
   *
   * It used to fire whenever the resolved set was empty, including when every
   * requested field had been withheld. Combined with a filter on a secret,
   * that turned "give me only the api key" into a file naming WHICH record
   * held the guessed value.
   */
  if (columns.length === 0 && excluded.length === 0) {
    const title = descriptor.fields.find((f) => f.key === descriptor.titleField);
    if (title && classifyField(title) === 'normal') {
      keys.push(title.key);
      columns.push({ key: title.key, label: title.label });
    }
  }

  return { keys, columns, excluded, includesRestricted };
}

/** The reason an export is refused, or null when it may proceed. */
export function exportBlockedReason(
  scope: ResolvedScope,
  fields: ResolvedFields,
  descriptor: EnterpriseModuleDescriptor,
): string | null {
  if (scope.records.length === 0) {
    return scope.total === 0
      ? `There are no ${descriptor.plural.toLowerCase()} to export.`
      : 'Nothing matches this selection, so there is nothing to write.';
  }
  if (fields.columns.length === 0) {
    return 'Every field in this selection is withheld, so the file would have no columns.';
  }
  return null;
}

export function tooLargeReason(scope: ResolvedScope): string | null {
  if (scope.records.length <= MAX_EXPORT_RECORDS) return null;
  return `This selection covers ${scope.records.length.toLocaleString()} records. One export carries at most ${MAX_EXPORT_RECORDS.toLocaleString()} — narrow it with a filter rather than receiving a file that is quietly incomplete.`;
}
