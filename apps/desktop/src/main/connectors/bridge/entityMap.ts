/**
 * The declared bridge from a provider's resource to a NeuroPause entity.
 *
 * WHY THIS FILE EXISTS
 *
 * The sync engine and the Data Plane were two parallel worlds. Thirteen real
 * adapters pulled live data into the Unified store, where it fed search,
 * memory, the timeline and briefings — and reached nothing governed. A
 * customer that arrived from a CSV had provenance, relationships, Related
 * Records and could raise an Opportunity; the same customer arriving from
 * HubSpot had none of that. This is the seam that closes it.
 *
 * WHY IT MAPS ON THE RESOURCE, NOT THE KIND
 *
 * `UnifiedEntityKind` is deliberately coarse — Salesforce Contacts, Leads AND
 * Users are all `kind: 'contact'`. Mapping on kind would file the sales team's
 * own user accounts into the CRM contact book. The RESOURCE id
 * (`salesforce_contacts`, `hubspot_companies`) is the precise unit the adapter
 * already declares, so that is what is mapped.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * Only resources with a real destination in `ONTOLOGY` appear here. A HubSpot
 * deal has no NeuroPause entity in this build, so it is UNMAPPED and stays in
 * the Unified store, where it still feeds search and the timeline. Inventing a
 * `deal` entity to make the table look complete would put records into a
 * module nothing else understands.
 *
 * Every mapping is data, not code: visible, enumerable, and testable against
 * the live ontology, so a field that is renamed in the ontology fails a test
 * rather than silently writing to a key that no longer exists.
 */
import type { ConnectorId, UnifiedEntity } from '@neuropause/shared';
import type { CanonicalEntity } from '../../dataPlane/ontology';
import { entityById } from '../../dataPlane/ontology';

/** A value pulled out of a `UnifiedEntity`, before normalization. */
export type FieldSource =
  /** A top-level column: `title`, `body`, `status`, `author`, `url`. */
  | { from: 'field'; key: keyof UnifiedEntity }
  /** A key in the adapter's `metadata` bag. */
  | { from: 'metadata'; key: string }
  /** The first of several metadata keys that has a value. */
  | { from: 'metadataFirst'; keys: readonly string[] }
  /**
   * A stable code built from the provider and its own id, e.g. `HUBSPOT-900`.
   *
   * The reason this exists: `customer.identityKeys` is
   * `[[customerCode],[email],[name]]`, and a CRM company payload has no email
   * — so the only complete keyset was `['name']`, which is canonicalised and
   * therefore never exact. Every company that matched an existing customer was
   * held as ambiguous forever. The provider's own id IS an identifier, so
   * writing it into the field the ontology declares `identity: true` makes
   * adoption deterministic instead of impossible.
   */
  | { from: 'externalCode' };

export interface FieldMapping {
  /** The ontology field this writes to. Validated against `ONTOLOGY` in tests. */
  target: string;
  source: FieldSource;
  /**
   * How the value is conditioned. Only deterministic, meaning-preserving
   * transforms — see `normalize.ts`. Anything judgemental belongs to a person.
   */
  normalize?: 'trim' | 'lower' | 'phone' | 'country' | 'url';
}

export interface ResourceMapping {
  connectorId: ConnectorId;
  /** The adapter's resource id. One mapping per resource, never per kind. */
  resourceId: string;
  /** An entity that must exist in `ONTOLOGY`. */
  entityId: string;
  /** Shown in the UI: "HubSpot Contacts → Contacts". */
  label: string;
  fields: readonly FieldMapping[];
  /**
   * Version of THIS mapping.
   *
   * Bumped when a mapping changes meaning, so provenance can say which
   * version produced a stored value. A record written by v1 and one written
   * by v2 are not the same claim.
   */
  version: number;
}

const CONTACT_FIELDS: readonly FieldMapping[] = [
  { target: 'name', source: { from: 'field', key: 'title' }, normalize: 'trim' },
  { target: 'email', source: { from: 'metadataFirst', keys: ['email'] }, normalize: 'lower' },
  { target: 'phone', source: { from: 'metadata', key: 'phone' }, normalize: 'phone' },
  { target: 'company', source: { from: 'metadata', key: 'company' }, normalize: 'trim' },
  { target: 'city', source: { from: 'metadata', key: 'city' }, normalize: 'trim' },
  { target: 'state', source: { from: 'metadata', key: 'state' }, normalize: 'trim' },
  { target: 'country', source: { from: 'metadata', key: 'country' }, normalize: 'country' },
  { target: 'website', source: { from: 'metadata', key: 'website' }, normalize: 'url' },
];

/**
 * A CRM company → the customer master.
 *
 * Deliberately SHORTER than the contact mapping. A customer has no `website`
 * field in this ontology, so the provider's `domain` has nowhere honest to go
 * and is dropped rather than stuffed into a field that means something else.
 * A test checks every target against the live ontology precisely so this stays
 * true when either side changes.
 *
 * `company` is deliberately NOT mapped from the title: it would make every
 * connector-created customer carry `company === name`, which is noise dressed
 * as data.
 */
const ORGANIZATION_FIELDS: readonly FieldMapping[] = [
  { target: 'name', source: { from: 'field', key: 'title' }, normalize: 'trim' },
  // `customerCode` is the ontology's declared identity field for a customer.
  { target: 'customerCode', source: { from: 'externalCode' } },
  { target: 'phone', source: { from: 'metadata', key: 'phone' }, normalize: 'phone' },
  { target: 'industry', source: { from: 'metadata', key: 'industry' }, normalize: 'trim' },
];

/**
 * The complete table.
 *
 * Short on purpose. Three CRM resources across two providers is a vertical
 * slice that genuinely works end to end; twenty half-considered mappings would
 * be a larger table and a smaller feature.
 */
export const RESOURCE_MAPPINGS: readonly ResourceMapping[] = [
  {
    connectorId: 'hubspot',
    resourceId: 'hubspot_contacts',
    entityId: 'contact',
    label: 'HubSpot Contacts → Contacts',
    fields: CONTACT_FIELDS,
    version: 1,
  },
  {
    connectorId: 'hubspot',
    resourceId: 'hubspot_companies',
    entityId: 'customer',
    label: 'HubSpot Companies → Customers',
    fields: ORGANIZATION_FIELDS,
    version: 1,
  },
  {
    connectorId: 'salesforce',
    resourceId: 'salesforce_contacts',
    entityId: 'contact',
    label: 'Salesforce Contacts → Contacts',
    fields: CONTACT_FIELDS,
    version: 1,
  },
  {
    connectorId: 'salesforce',
    resourceId: 'salesforce_accounts',
    entityId: 'customer',
    label: 'Salesforce Accounts → Customers',
    fields: ORGANIZATION_FIELDS,
    version: 1,
  },
];

const BY_KEY = new Map(RESOURCE_MAPPINGS.map((m) => [`${m.connectorId}::${m.resourceId}`, m]));

export function mappingFor(connectorId: string, resourceId: string): ResourceMapping | null {
  return BY_KEY.get(`${connectorId}::${resourceId}`) ?? null;
}

export function mappingsForConnector(connectorId: string): ResourceMapping[] {
  return RESOURCE_MAPPINGS.filter((m) => m.connectorId === connectorId);
}

/** The ontology entity a mapping targets. Null only if the ontology changed. */
export function entityForMapping(mapping: ResourceMapping): CanonicalEntity | null {
  return entityById(mapping.entityId);
}

/**
 * Why a resource is not bridged, in words a person can act on.
 *
 * "Not supported" with no reason reads as a defect. Naming the resource and
 * saying the data is still searchable is the difference between a gap and a
 * refusal.
 */
export function unmappedReason(resourceLabel: string): string {
  return `${resourceLabel} has no matching business record type in NeuroPause, so it is not written to your business data. It is still synced, searchable and on the timeline.`;
}
