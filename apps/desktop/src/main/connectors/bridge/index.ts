/**
 * The bridge from a connected system into the governed business data.
 *
 * THE GAP THIS CLOSES
 *
 * Thirteen real adapters pulled live provider data into the Unified store,
 * where it fed search, memory, the timeline and briefings — and reached
 * nothing governed. A customer that arrived from a CSV had provenance,
 * relationships, Related Records and could raise an Opportunity. The same
 * customer arriving from HubSpot had none of it. Two parallel worlds, one of
 * them invisible to every program built on top of the Data Plane.
 *
 * WHAT IT DOES NOT DO
 *
 * It is an adapter, not a second import pipeline. It writes through
 * `EnterpriseRecordStore`, records provenance in the Data Plane's own
 * `ProvenanceStore`, and fires the same `onImported` fan-out a file import
 * fires, so the existing relationship engine resolves the links. There is no
 * connector record store, no connector provenance store, no connector
 * relationship engine and no connector audit log.
 *
 * THE FOUR RULES
 *
 *  1. WRITE PERMISSION IS CHECKED. Being connected is not permission to write
 *     into a module. The destination module's own write scope is required,
 *     exactly as `dp:import` requires it.
 *  2. IDEMPOTENT BY EXTERNAL IDENTITY. The provider's own id is the key.
 *     Syncing twice produces no second copy — not because the values happen
 *     to match, but because the second pass finds the record the first one
 *     made.
 *  3. AMBIGUITY IS NEVER MERGED. A literal match on a declared identity field
 *     is a match. Two names that agree only after canonicalisation are a
 *     question, and the answer is a person's, so the row is held.
 *  4. AN ADOPTED RECORD IS NOT OVERWRITTEN. A record the connector CREATED is
 *     connector-managed and updated fully. A record that was already here and
 *     was matched has empty fields filled and nothing else touched — the
 *     value in it may be somebody's correction.
 */
import type {
  ConnectorId,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  UnifiedEntity,
} from '@neuropause/shared';
import type { EnterpriseRecordStore } from '../../enterprise/framework/enterpriseRecordStore';
import { validateEnterpriseRecordInput } from '@neuropause/shared';
import type { CellValue } from '../../dataPlane/parsers';
import type { ProvenanceRecord, ProvenanceStore } from '../../dataPlane/importer';
import { canonicalName, normalizeValue } from '../../dataPlane/normalize';
import { createLogger } from '../../logger';
import { entityForMapping, mappingFor, type FieldMapping, type ResourceMapping } from './entityMap';

const log = createLogger('connector-bridge');

/** What happened to one provider object. */
export type BridgeRowOutcome =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'adopted'
  /** Matched only after canonicalising a name. Held for a person. */
  | 'ambiguous'
  /** A required field is missing or unusable. */
  | 'invalid'
  /** No mapping declares this resource. Stays in the Unified store. */
  | 'unmapped'
  /** The record this object produced was deleted by a person. Left deleted. */
  | 'suppressed';

export interface BridgeRowResult {
  externalId: string;
  title: string;
  outcome: BridgeRowOutcome;
  recordId: string | null;
  /** Why, in words, whenever the outcome is not a plain write. */
  reason: string | null;
}

export interface BridgeResult {
  connectorId: string;
  accountId: string;
  resourceId: string;
  moduleId: string | null;
  entityId: string | null;
  created: number;
  updated: number;
  unchanged: number;
  adopted: number;
  ambiguous: number;
  invalid: number;
  suppressed: number;
  /** Set when nothing was written and the reason is structural. */
  skippedReason: string | null;
  rows: BridgeRowResult[];
}

export interface BridgeDeps {
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
  modules: () => readonly EnterpriseModuleDescriptor[];
  /**
   * Whether the current principal holds a permission. NON-THROWING, and that
   * is the point.
   *
   * `authorize` throws — and on the enterprise gate a refusal ALSO opens a
   * HOLD and writes a Decision Record. A scheduled sync runs on a bare
   * interval with no signed-in actor, so calling it produced a governance
   * artefact every fifteen minutes, forever, for a machine-triggered read.
   * A pure check refuses just as hard and records nothing.
   */
  allows: (permission: EnterprisePermission) => boolean;
  provenance: ProvenanceStore;
  actor: () => string | null;
  now: () => string;
  audit: (entry: { action: string; target: string; summary: string }) => void;
  /**
   * The SAME fan-out a file import fires. Relationship resolution, the
   * platform timeline and every module's own reconciler hang off this; a
   * connector-specific replacement would be a second lifecycle that drifts.
   */
  onImported: (event: {
    moduleId: string;
    recordIds: string[];
    planId: string;
    correlationId: string;
  }) => void;
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Pull one mapped value out of a Unified entity, before normalization. */
function readSource(entity: UnifiedEntity, mapping: FieldMapping): string {
  const src = mapping.source;
  if (src.from === 'field') return textOf(entity[src.key]);
  if (src.from === 'metadata') return textOf(entity.metadata[src.key]);
  if (src.from === 'externalCode') {
    // Deterministic and provider-scoped, so the same object always produces
    // the same code and two providers never collide on one.
    return `${entity.connectorId.toUpperCase()}-${entity.sourceId}`;
  }
  for (const key of src.keys) {
    const v = textOf(entity.metadata[key]);
    if (v.trim() !== '') return v;
  }
  return '';
}

/**
 * Condition a value without changing what it means.
 *
 * Every transform here is reversible in intent: trimming whitespace, lowering
 * an address, canonicalising a country code. Anything that requires judgement
 * — deciding that "Acme" and "Acme Inc" are one company, say — is not
 * normalization, and belongs to a person.
 */
export function applyNormalize(raw: string, how: FieldMapping['normalize']): string {
  const value = raw.trim();
  if (value === '') return '';
  switch (how) {
    case 'lower':
      return value.toLowerCase();
    case 'phone': {
      // Digits and a leading `+` only. `+91 98765-43210` and `+919876543210`
      // are the same number and must not become two.
      const kept = value.replace(/[^\d+]/g, '');
      return kept.startsWith('+') ? `+${kept.slice(1).replace(/\+/g, '')}` : kept;
    }
    case 'country': {
      const upper = value.toUpperCase();
      return /^[A-Z]{2}$/.test(upper) ? upper : value;
    }
    case 'url': {
      // A CRM "domain" is a hostname; a website is a URL. One shape, so they
      // compare.
      const stripped = value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      return stripped.toLowerCase();
    }
    default:
      return value;
  }
}

export interface MappedRow {
  fields: Record<string, CellValue>;
  title: string;
  /** Set when the row cannot be written, with the reason. */
  invalidReason: string | null;
}

/** Map + normalize + check the destination's required fields. Pure. */
export function mapEntity(entity: UnifiedEntity, mapping: ResourceMapping): MappedRow {
  const target = entityForMapping(mapping);
  if (!target) {
    return { fields: {}, title: '', invalidReason: `“${mapping.entityId}” is not an entity in this build.` };
  }
  const byKey = new Map(target.fields.map((f) => [f.key, f]));
  const fields: Record<string, CellValue> = {};

  for (const fm of mapping.fields) {
    const field = byKey.get(fm.target);
    if (!field) continue; // guarded by a test against the live ontology
    const raw = applyNormalize(readSource(entity, fm), fm.normalize);
    if (raw === '') continue;
    const normalized = normalizeValue(raw, field.type);
    // A value the destination cannot store is DROPPED, not coerced. Writing
    // "not-a-number" into a numeric column is how a report starts lying.
    if (normalized.error !== null || normalized.value === null) continue;
    fields[field.key] = normalized.value;
  }

  const missing = target.fields
    .filter((f) => f.required === true && (fields[f.key] === undefined || textOf(fields[f.key]).trim() === ''))
    .map((f) => f.label);

  const title = textOf(fields[target.titleField]) || entity.title;
  return {
    fields,
    title,
    invalidReason:
      missing.length > 0
        ? `${mapping.label.split('→')[1]?.trim() ?? 'This record'} needs ${missing.join(', ')}, and the provider record has none.`
        : null,
  };
}

/**
 * The identity of a mapped row, by the destination entity's own rules.
 *
 * Reuses the ontology's `identityKeys` — the same declaration the file
 * importer matches on — so a customer from a spreadsheet and the same customer
 * from HubSpot are recognised as one thing by one rule.
 *
 * ONE DELIBERATE DIFFERENCE, and it matters enough to state:
 *
 * `canonicalName` is right for a company name and wrong for an email address.
 * It strips punctuation, so `a-b@x.com` and `a.b@x.com` collapse to the same
 * string — two different mailboxes, one identity. So a field whose SHAPE is an
 * identifier by construction (an email, a code) is compared LITERALLY and
 * counts as exact; a human name is canonicalised and never does.
 *
 * Without this the bridge treats every email match as ambiguous, and a company
 * with 500 existing contacts syncs 500 held rows and no data. The conservative
 * behaviour is still conservative: an exact match here produces ADOPTION,
 * which fills empty fields and never overwrites a value a person entered.
 */
const LITERAL_SHAPES = new Set(['email', 'code']);

export interface IdentityKey {
  key: string;
  exact: boolean;
}

/**
 * EVERY complete identity keyset, in the ontology's declared priority order.
 *
 * Returning only the first one — which is what the file importer does — has a
 * consequence the bridge cannot live with. A connector-created customer carries
 * a synthetic `customerCode`, so its first complete keyset is the code; a
 * customer somebody typed in has only a name. Compare first-keyset to
 * first-keyset and they never meet, so every provider company created a second
 * customer next to the one already there.
 *
 * With all keysets, the code matches the connector's own records exactly and
 * the name still reaches a pre-existing one — where it is reported as
 * ambiguous rather than merged, which is the whole point.
 */
function identitiesOf(
  target: NonNullable<ReturnType<typeof entityForMapping>>,
  fields: Record<string, CellValue>,
): IdentityKey[] {
  const out: IdentityKey[] = [];
  for (const keySet of target.identityKeys) {
    const parts: string[] = [];
    let complete = true;
    let literal = false;
    for (const key of keySet) {
      const v = fields[key];
      if (v === null || v === undefined || textOf(v).trim() === '') {
        complete = false;
        break;
      }
      const field = target.fields.find((f) => f.key === key);
      const isLiteral = field !== undefined && field.shape !== undefined && LITERAL_SHAPES.has(field.shape);
      if (isLiteral) literal = true;
      /**
       * `canonicalName` is right for a company name and wrong for an email or a
       * code: it strips punctuation, so `a-b@x.com` and `a.b@x.com` collapse to
       * one string — two mailboxes, one identity. A field whose SHAPE is an
       * identifier by construction is compared literally and counts as exact; a
       * human name is canonicalised and never does.
       */
      parts.push(
        isLiteral || field?.type !== 'text' ? textOf(v).trim().toLowerCase() : canonicalName(textOf(v)),
      );
    }
    if (!complete || parts.length === 0) continue;
    out.push({
      key: `${keySet.join('|')}=${parts.join('|')}`,
      exact: literal || keySet.some((k) => target.fields.find((f) => f.key === k)?.identity === true),
    });
  }
  return out;
}

export interface BridgeInput {
  connectorId: ConnectorId;
  accountId: string;
  resourceId: string;
  syncRunId: string;
  entities: readonly UnifiedEntity[];
}

/**
 * Write one resource's synced entities into the governed business data.
 *
 * Returns what happened per row. Nothing is thrown for a bad row — a sync of
 * 1,200 contacts must not be lost because three of them have no name.
 */
export async function bridgeResource(input: BridgeInput, deps: BridgeDeps): Promise<BridgeResult> {
  const empty = (skippedReason: string | null, moduleId: string | null, entityId: string | null): BridgeResult => ({
    connectorId: input.connectorId,
    accountId: input.accountId,
    resourceId: input.resourceId,
    moduleId,
    entityId,
    created: 0,
    updated: 0,
    unchanged: 0,
    adopted: 0,
    ambiguous: 0,
    invalid: 0,
    suppressed: 0,
    skippedReason,
    rows: [],
  });

  const mapping = mappingFor(input.connectorId, input.resourceId);
  if (!mapping) return empty(null, null, null);

  const target = entityForMapping(mapping);
  if (!target) {
    return empty(`“${mapping.entityId}” is not an entity in this build.`, null, mapping.entityId);
  }

  const descriptor = deps.modules().find((m) => m.id === target.moduleId);
  if (!descriptor) {
    return empty(`“${target.moduleId}” is not a module in this build.`, target.moduleId, target.id);
  }

  /**
   * The destination module's OWN write scope.
   *
   * Being connected to HubSpot is not permission to write into the customer
   * master. The same gate `dp:import` applies, for the same reason: bulk
   * insertion must not be a way around the per-module permission the
   * on-screen forms enforce.
   *
   * Reported rather than thrown. A background sync with nobody signed in is
   * not an error to raise at a user — it is a reason the governed write has
   * not happened yet, and the caller leaves the cursor where it is so it
   * happens later.
   */
  if (!deps.allows(descriptor.permissions.write)) {
    return empty(
      `Writing ${descriptor.plural.toLowerCase()} needs ${descriptor.permissions.write}. The data is synced and searchable; it has not been written to your business records.`,
      target.moduleId,
      target.id,
    );
  }

  const store = deps.storeFor(target.moduleId);
  if (!store) return empty(`“${descriptor.title}” is not available in this build.`, target.moduleId, target.id);
  await store.load();
  await deps.provenance.load();

  // One pass over the destination, not one query per row.
  const live = store.list({ status: 'active', limit: 200_000 });
  const byIdentity = new Map<string, { id: string; exact: boolean }>();
  for (const record of live) {
    for (const identity of identitiesOf(target, record.fields as Record<string, CellValue>)) {
      // First writer wins: an ambiguous local duplicate must not silently
      // determine which record a sync adopts.
      if (!byIdentity.has(identity.key)) byIdentity.set(identity.key, { id: record.id, exact: identity.exact });
    }
  }

  const result = empty(null, target.moduleId, target.id);
  const provenance: ProvenanceRecord[] = [];
  const touched: string[] = [];
  const at = deps.now();
  const actor = deps.actor();

  /** One provider object. Declared as a const so the narrowing above holds. */
  const bridgeOne = async (entity: UnifiedEntity): Promise<void> => {
    const externalKey = `${input.connectorId}::${input.accountId}::${input.resourceId}::${entity.sourceId}`;
    const mapped = mapEntity(entity, mapping);

    if (mapped.invalidReason !== null) {
      result.invalid += 1;
      result.rows.push({
        externalId: entity.sourceId,
        title: entity.title,
        outcome: 'invalid',
        recordId: null,
        reason: mapped.invalidReason,
      });
      return;
    }

    const known = deps.provenance.forExternalKey(externalKey);
    const existingId = known?.recordId ?? null;
    const existing = existingId ? store.get(existingId) : null;

    /**
     * A record a person DELETED stays deleted.
     *
     * `existing.status !== 'deleted'` sent it down the create path, so a
     * contact somebody removed came back every fifteen minutes with a new id
     * and no explanation. The provider object is still known; the answer is
     * "not this one", not "make another".
     */
    if (existing && existing.status === 'deleted') {
      result.suppressed += 1;
      result.rows.push({
        externalId: entity.sourceId,
        title: mapped.title,
        outcome: 'suppressed',
        recordId: existing.id,
        reason: 'The record this produced was deleted here, so it is not recreated.',
      });
      return;
    }

    /* ── already bridged: update in place ─────────────────────────────── */
    if (existing && existing.status !== 'deleted') {
      const linkage = known?.connector?.linkage ?? 'created';
      const patch: Record<string, CellValue> = {};
      for (const [key, value] of Object.entries(mapped.fields)) {
        const current = existing.fields[key];
        if (linkage === 'adopted' && textOf(current).trim() !== '') {
          // An adopted record's non-empty values are somebody's. A sync fills
          // gaps; it does not overwrite a person.
          return;
        }
        if (textOf(current) === textOf(value)) continue;
        patch[key] = value;
      }

      if (Object.keys(patch).length === 0) {
        result.unchanged += 1;
        result.rows.push({
          externalId: entity.sourceId,
          title: mapped.title,
          outcome: 'unchanged',
          recordId: existing.id,
          reason: null,
        });
        // Provenance is still refreshed, so `syncedAt` is honest even when
        // nothing changed — "we looked and it was the same" is a fact.
        provenance.push(
          provenanceFor(existing.id, target.moduleId, entity, mapping, externalKey, input, at, actor, linkage),
        );
        return;
      }

      store.update(existing.id, {
        fields: { ...existing.fields, ...patch },
        ...(patch[target.titleField] !== undefined ? { title: mapped.title } : {}),
        actor,
        now: at,
      });
      result.updated += 1;
      touched.push(existing.id);
      result.rows.push({
        externalId: entity.sourceId,
        title: mapped.title,
        outcome: 'updated',
        recordId: existing.id,
        reason: null,
      });
      provenance.push(
        provenanceFor(existing.id, target.moduleId, entity, mapping, externalKey, input, at, actor, linkage),
      );
      return;
    }

    /* ── not bridged yet: is it already here under another origin? ─────── */
    const identities = identitiesOf(target, mapped.fields);
    // Priority order, and an EXACT hit anywhere wins over a fuzzy one earlier
    // in the list: certainty is not something to give up because a weaker key
    // happened to be declared first.
    let identity: IdentityKey | undefined;
    let match: { id: string; exact: boolean } | undefined;
    for (const candidate of identities) {
      const hit = byIdentity.get(candidate.key);
      if (!hit) continue;
      if (hit.exact && candidate.exact) {
        identity = candidate;
        match = hit;
        break;
      }
      if (!match) {
        identity = candidate;
        match = hit;
      }
    }

    if (match && identity && !(identity.exact && match.exact)) {
      /**
       * Names that agree only after canonicalisation.
       *
       * "Acme Ltd" and "ACME Limited" really can be two companies. Adopting
       * the wrong one attaches a provider's future updates to a record it does
       * not describe, and nothing downstream would ever show it. Held.
       */
      result.ambiguous += 1;
      result.rows.push({
        externalId: entity.sourceId,
        title: mapped.title,
        outcome: 'ambiguous',
        recordId: match.id,
        reason: `“${mapped.title}” matches an existing record only after normalising the name. Not linked — confirm which record it is.`,
      });
      return;
    }

    if (match) {
      // A literal match on a declared identity field. Adopt it, fill only the
      // gaps, and record that it was adopted so later syncs keep that promise.
      const record = store.get(match.id);
      const patch: Record<string, CellValue> = {};
      if (record) {
        for (const [key, value] of Object.entries(mapped.fields)) {
          if (textOf(record.fields[key]).trim() === '') patch[key] = value;
        }
        if (Object.keys(patch).length > 0) {
          store.update(match.id, { fields: { ...record.fields, ...patch }, actor, now: at });
          touched.push(match.id);
        }
      }
      result.adopted += 1;
      result.rows.push({
        externalId: entity.sourceId,
        title: mapped.title,
        outcome: 'adopted',
        recordId: match.id,
        reason: `Matched an existing record on ${identity?.key.split('=')[0] ?? 'its identity'}. Empty fields were filled; nothing already entered was changed.`,
      });
      provenance.push(
        provenanceFor(match.id, target.moduleId, entity, mapping, externalKey, input, at, actor, 'adopted'),
      );
      return;
    }

    /* ── genuinely new ─────────────────────────────────────────────────── */
    /**
     * Through the module's OWN validator, so its declared defaults apply.
     *
     * Calling `store.create` with the mapped fields alone bypassed
     * `validateEnterpriseRecordInput`, which is where `field.default` is
     * filled in — so every connector-created contact landed with no `status`
     * and no `priority`, both declared REQUIRED with defaults. Blank badges in
     * every list, invisible to the status filter, and the module's own
     * reconciler running against a record that had none.
     */
    const validated = validateEnterpriseRecordInput(descriptor, {
      title: mapped.title,
      fields: mapped.fields as Record<string, string | number | boolean | null>,
    });
    if (!validated.ok) {
      result.invalid += 1;
      result.rows.push({
        externalId: entity.sourceId,
        title: mapped.title,
        outcome: 'invalid',
        recordId: null,
        reason: Object.entries(validated.errors)
          .map(([field, message]) => `${field}: ${message}`)
          .join(' '),
      });
      return;
    }
    const created = store.create({
      title: mapped.title,
      fields: validated.values,
      actor,
      now: at,
    });
    // Index EVERY keyset the new record satisfies, so a later row in the same
    // batch matching on any of them finds it.
    for (const candidate of identitiesOf(target, validated.values as Record<string, CellValue>)) {
      if (!byIdentity.has(candidate.key)) {
        byIdentity.set(candidate.key, { id: created.id, exact: candidate.exact });
      }
    }
    result.created += 1;
    touched.push(created.id);
    result.rows.push({
      externalId: entity.sourceId,
      title: mapped.title,
      outcome: 'created',
      recordId: created.id,
      reason: null,
    });
    provenance.push(
      provenanceFor(created.id, target.moduleId, entity, mapping, externalKey, input, at, actor, 'created'),
    );
  };

  for (const entity of input.entities) {
    /**
     * Per row, and the loop continues.
     *
     * `store.create` throwing mid-batch used to propagate out before
     * `appendConnector` ran, so every record already written in that batch had
     * NO provenance — and the next sync, finding no external key, adopted them
     * and never updated them again.
     */
    try {
      await bridgeOne(entity);
    } catch (err) {
      result.invalid += 1;
      result.rows.push({
        externalId: entity.sourceId,
        title: entity.title,
        outcome: 'invalid',
        recordId: null,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }



  /**
   * The RECORDS are flushed before their provenance.
   *
   * `appendConnector` awaits a real write; the record store's persist is
   * scheduled and fire-and-forget. Writing provenance first meant a crash in
   * between left provenance pointing at records that did not exist.
   */
  await store.flush();
  await deps.provenance.appendConnector(provenance);

  if (touched.length > 0) {
    /**
     * The same fan-out a file import fires.
     *
     * This is what makes a synced customer participate in relationship
     * resolution, Related Records and everything built on them. Without it the
     * records exist and nothing else in the system knows they arrived — which
     * was the whole defect.
     */
    deps.onImported({
      moduleId: target.moduleId,
      recordIds: touched,
      planId: input.syncRunId,
      correlationId: `sync_${input.syncRunId}`,
    });
  }

  if (result.created + result.updated + result.adopted + result.ambiguous > 0) {
    deps.audit({
      action: 'connector.bridge',
      target: `${input.connectorId}:${input.resourceId}`,
      summary:
        `${mapping.label}: ${result.created} created, ${result.updated} updated, ` +
        `${result.adopted} matched to existing records, ${result.unchanged} unchanged` +
        `${result.ambiguous > 0 ? `, ${result.ambiguous} held as ambiguous` : ''}` +
        `${result.invalid > 0 ? `, ${result.invalid} unusable` : ''}.`,
    });
  }

  log.info('Bridged resource', {
    connectorId: input.connectorId,
    resourceId: input.resourceId,
    moduleId: target.moduleId,
    created: result.created,
    updated: result.updated,
    adopted: result.adopted,
    ambiguous: result.ambiguous,
  });

  return result;
}

function provenanceFor(
  recordId: string,
  moduleId: string,
  entity: UnifiedEntity,
  mapping: ResourceMapping,
  externalKey: string,
  input: BridgeInput,
  at: string,
  actor: string | null,
  linkage: 'created' | 'adopted',
): ProvenanceRecord {
  return {
    recordId,
    moduleId,
    // The file-shaped fields are filled with what is TRUE for a connector
    // rather than left blank: "HubSpot Contacts" is where this came from, and
    // a reader of the provenance view should see that, not an empty cell.
    planId: input.syncRunId,
    sourceFile: `${input.connectorId} · ${mapping.label.split('→')[0]?.trim() ?? input.resourceId}`,
    sourceTable: input.resourceId,
    sourceRow: 0,
    confidence: 1,
    approvedBy: actor,
    importedAt: at,
    fields: [],
    connector: {
      connectorId: input.connectorId,
      accountId: input.accountId,
      resourceId: input.resourceId,
      externalId: entity.sourceId,
      externalKey,
      externalUpdatedAt: entity.updatedAt,
      syncRunId: input.syncRunId,
      mappingVersion: mapping.version,
      linkage,
    },
  };
}
