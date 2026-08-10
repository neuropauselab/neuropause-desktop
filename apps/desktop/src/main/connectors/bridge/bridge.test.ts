/**
 * Connector → Universal Data Plane, end to end.
 *
 * THE DEFECT THIS CLOSES, restated because it is the whole point: thirteen
 * real adapters pulled live provider data into the Unified store, where it fed
 * search and the timeline and reached NOTHING governed. A customer from a CSV
 * had provenance, relationships and Related Records; the same customer from
 * HubSpot had none of them.
 *
 * The pipeline below runs the REAL HubSpot adapter — the same
 * `hubspotAdapter.resources[…].pull` the scheduler calls — against a
 * provider-shaped HTTP double, and then writes the result through the REAL
 * record store, the REAL provenance store and the REAL identity rules. Only
 * the socket is a double.
 *
 * NO LIVE PROVIDER IS CONTACTED, and nothing here claims otherwise. Live
 * authentication needs an operator-supplied OAuth client and a browser; see
 * the report.
 *
 * Load-bearing assertions, as always, are the refusals: syncing twice creates
 * nothing, a name that matches only after canonicalising is NOT merged, an
 * adopted record is never overwritten, and no module is written without its
 * own write permission.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  UnifiedEntity,
} from '@neuropause/shared';
import type { SyncContext, HttpRequestOptions } from '../../unified/sync/adapterSdk';
import { hubspotAdapter } from '../../unified/sync/adapters/hubspot';
import { EnterpriseRecordStore } from '../../enterprise/framework/enterpriseRecordStore';
import { ProvenanceStore } from '../../dataPlane/importer';
import { bridgeResource, applyNormalize, mapEntity, type BridgeDeps } from './index';
import { RESOURCE_MAPPINGS, entityForMapping, mappingFor } from './entityMap';
import { ONTOLOGY, entityById } from '../../dataPlane/ontology';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

const ACTOR = 'priya@example.com';
const NOW = '2026-08-10T00:00:00.000Z';

const CONTACTS_MODULE: EnterpriseModuleDescriptor = {
  id: 'crm',
  title: 'Contacts',
  singular: 'Contact',
  plural: 'Contacts',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'website', label: 'Website', type: 'text' },
    { key: 'state', label: 'State', type: 'text' },
  ],
};

const CUSTOMERS_MODULE: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Customer Name', type: 'text', required: true },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'website', label: 'Website', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'customerCode', label: 'Customer Code', type: 'text' },
  ],
};

const MODULES = [CONTACTS_MODULE, CUSTOMERS_MODULE];

/* ── the provider double ──────────────────────────────────────────────── */

interface HsContact {
  id: string;
  properties: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

/** A HubSpot CRM Search response, in the shape the real API returns. */
function searchResponse(results: HsContact[]): { total: number; results: HsContact[]; paging?: unknown } {
  return { total: results.length, results };
}

function contact(id: string, props: Record<string, string>, updatedAt = '2026-08-01T10:00:00.000Z'): HsContact {
  return {
    id,
    properties: { ...props, lastmodifieddate: updatedAt },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

function company(id: string, props: Record<string, string>, updatedAt = '2026-08-01T10:00:00.000Z'): HsContact {
  return {
    id,
    properties: { ...props, hs_lastmodifieddate: updatedAt },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

/** A SyncContext whose http replays a body per request. Only the socket is fake. */
function routed(handler: (url: string, body: unknown) => unknown, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string) => Promise.resolve({ data: handler(url, undefined), headers: {}, status: 200 }),
    postJson: (url: string, body: unknown, _opts?: HttpRequestOptions) =>
      Promise.resolve({ data: handler(url, body), headers: {}, status: 200 }),
  } as unknown as SyncContext['http'];
  return { connectorId: 'hubspot', accountId: 'acct_1', http, cursor, now: NOW };
}

describe('connector → data plane bridge', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let provenance: ProvenanceStore;
  let granted: Set<EnterprisePermission>;
  let audit: { action: string; target: string; summary: string }[];
  let imported: { moduleId: string; recordIds: string[] }[];
  let deps: BridgeDeps;

  const pullContacts = async (rows: HsContact[]): Promise<UnifiedEntity[]> => {
    const resource = hubspotAdapter.resources.find((r) => r.id === 'hubspot_contacts')!;
    const page = await resource.pull(routed(() => searchResponse(rows), null));
    return page.entities;
  };

  const pullCompanies = async (rows: HsContact[]): Promise<UnifiedEntity[]> => {
    const resource = hubspotAdapter.resources.find((r) => r.id === 'hubspot_companies')!;
    const page = await resource.pull(routed(() => searchResponse(rows), null));
    return page.entities;
  };

  const bridge = (resourceId: string, entities: readonly UnifiedEntity[], syncRunId = 'run_1') =>
    bridgeResource({ connectorId: 'hubspot', accountId: 'acct_1', resourceId, syncRunId, entities }, deps);

  beforeEach(async () => {
    dir = join(tmpdir(), `np-bridge-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    audit = [];
    imported = [];
    granted = new Set<EnterprisePermission>(['crm:read', 'crm:manage']);
    stores = new Map(
      MODULES.map((m) => [m.id, new EnterpriseRecordStore(join(dir, `${m.id}.json`), m.id, m.id).bindScope(() => TEST_TENANT_SCOPE)]),
    );
    await Promise.all([...stores.values()].map((s) => s.load()));
    provenance = new ProvenanceStore(join(dir, 'provenance.json'));
    await provenance.load();

    deps = {
      storeFor: (id) => stores.get(id) ?? null,
      modules: () => MODULES,
      allows: (permission) => granted.has(permission),
      provenance,
      actor: () => ACTOR,
      now: () => NOW,
      audit: (e) => audit.push(e),
      onImported: (e) => imported.push({ moduleId: e.moduleId, recordIds: e.recordIds }),
    };
  });

  afterEach(async () => {
    await Promise.all([...stores.values()].map((s) => s.flush()));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /* ── 1. The mapping table is honest about the ontology ────────────────── */

  describe('the declared mapping', () => {
    it('every mapping targets an entity and fields that actually exist', () => {
      /**
       * The table is data, so it can drift from the ontology silently — a
       * renamed field would write to a key nothing reads, and the records
       * would look fine and be empty. Checked against the live ontology.
       */
      for (const mapping of RESOURCE_MAPPINGS) {
        const target = entityById(mapping.entityId);
        expect(target, `${mapping.label} targets a missing entity`).toBeTruthy();
        const keys = new Set(target!.fields.map((f) => f.key));
        for (const fm of mapping.fields) {
          expect(keys.has(fm.target), `${mapping.label}: “${fm.target}” is not a field on ${target!.id}`).toBe(true);
        }
      }
    });

    it('maps on the RESOURCE, not the coarse kind', () => {
      /**
       * Salesforce Contacts, Leads AND Users are all `kind: 'contact'`.
       * Mapping on kind would file the sales team's own user accounts into the
       * customer contact book. `salesforce_users` is deliberately absent.
       */
      expect(mappingFor('salesforce', 'salesforce_contacts')).toBeTruthy();
      expect(mappingFor('salesforce', 'salesforce_users')).toBeNull();
    });

    it('leaves a resource with no destination UNMAPPED rather than inventing one', () => {
      // A HubSpot deal has no NeuroPause entity in this build. Inventing one
      // would put records into a module nothing else understands.
      expect(mappingFor('hubspot', 'hubspot_deals')).toBeNull();
      expect(ONTOLOGY.some((e) => e.id === 'deal')).toBe(false);
    });

    it('an unmapped resource writes nothing and says nothing went wrong', async () => {
      const result = await bridge('hubspot_deals', []);
      expect(result.created).toBe(0);
      expect(result.moduleId).toBeNull();
      expect(result.skippedReason).toBeNull();
    });
  });

  /* ── 2. The pipeline ──────────────────────────────────────────────────── */

  describe('first sync', () => {
    it('brings provider contacts into the governed contact module', async () => {
      const entities = await pullContacts([
        contact('101', {
          firstname: 'Asha',
          lastname: 'Rao',
          email: 'ASHA@Example.COM',
          phone: '+91 98765-43210',
          company: 'Borealis Trading',
        }),
        contact('102', { firstname: 'Ravi', lastname: 'Kumar', email: 'ravi@example.com' }),
      ]);
      // The REAL adapter produced these — same code path the scheduler runs.
      expect(entities).toHaveLength(2);
      expect(entities[0]!.id).toBe('hubspot:acct_1:contact:contact-101');

      const result = await bridge('hubspot_contacts', entities);
      expect(result.created).toBe(2);
      expect(result.moduleId).toBe('crm');

      const stored = stores.get('crm')!.list({ status: 'active', limit: 10 });
      const asha = stored.find((r) => r.title === 'Asha Rao')!;
      expect(asha).toBeTruthy();
      // Normalized, and meaning-preserving: an address lowered, a phone
      // stripped to digits, a country code raised.
      expect(asha.fields.email).toBe('asha@example.com');
      expect(asha.fields.phone).toBe('+919876543210');
      expect(asha.fields.company).toBe('Borealis Trading');
      /**
       * HubSpot's contact payload carries no city or country, so those stay
       * empty. The mapping is a superset across providers on purpose — an
       * absent source yields nothing rather than an error, which is what lets
       * one contact mapping serve HubSpot and Salesforce.
       */
      /**
       * `null`, not absent: the record goes through the module's own validator,
       * which declares every field — so an unsupplied one is explicitly empty
       * rather than missing. That is what makes the module's required-field
       * defaults apply.
       */
      expect(asha.fields.country).toBeNull();
    });

    it('records provenance that answers “where did this come from?”', async () => {
      const entities = await pullContacts([contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com' })]);
      await bridge('hubspot_contacts', entities, 'run_abc');

      const record = stores.get('crm')!.list({ status: 'active', limit: 10 })[0]!;
      const p = provenance.forRecord(record.id)!;
      expect(p.connector?.connectorId).toBe('hubspot');
      expect(p.connector?.accountId).toBe('acct_1');
      expect(p.connector?.resourceId).toBe('hubspot_contacts');
      expect(p.connector?.externalId).toBe('contact-101');
      expect(p.connector?.syncRunId).toBe('run_abc');
      expect(p.connector?.linkage).toBe('created');
      expect(p.connector?.mappingVersion).toBe(1);
      // The provenance VIEW is file-shaped; a connector fills it with what is
      // true rather than leaving blanks a reader cannot interpret.
      expect(p.sourceFile).toContain('hubspot');
    });

    it('fires the SAME lifecycle fan-out a file import fires', async () => {
      /**
       * This is the line that makes a synced customer participate in
       * relationship resolution and Related Records. Without it the records
       * exist and nothing else in the system knows they arrived — which was
       * the entire defect.
       */
      const entities = await pullContacts([contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com' })]);
      await bridge('hubspot_contacts', entities);
      expect(imported).toHaveLength(1);
      expect(imported[0]!.moduleId).toBe('crm');
      expect(imported[0]!.recordIds).toHaveLength(1);
    });

    it('writes an audit line naming what happened', async () => {
      const entities = await pullContacts([contact('101', { firstname: 'A', lastname: 'B', email: 'a@x.com' })]);
      await bridge('hubspot_contacts', entities);
      const line = audit.find((a) => a.action === 'connector.bridge');
      expect(line?.summary).toContain('1 created');
      expect(line?.target).toBe('hubspot:hubspot_contacts');
    });
  });

  /* ── 3. Idempotency ───────────────────────────────────────────────────── */

  describe('running the same sync twice', () => {
    it('creates nothing the second time', async () => {
      const rows = [
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com' }),
        contact('102', { firstname: 'Ravi', lastname: 'Kumar', email: 'r@x.com' }),
      ];
      const first = await bridge('hubspot_contacts', await pullContacts(rows), 'run_1');
      const second = await bridge('hubspot_contacts', await pullContacts(rows), 'run_2');

      expect(first.created).toBe(2);
      expect(second.created).toBe(0);
      expect(second.unchanged).toBe(2);
      expect(stores.get('crm')!.list({ status: 'active', limit: 100 })).toHaveLength(2);
    });

    it('matches on the PROVIDER id, not on the values happening to be equal', async () => {
      /**
       * The real test of idempotency. The person is renamed at the provider,
       * so nothing about the values matches — but it is the same object, and
       * a second record would be wrong.
       */
      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com' }),
      ]), 'run_1');

      const second = await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Sharma', email: 'asha.sharma@x.com' }),
      ]), 'run_2');

      expect(second.created).toBe(0);
      expect(second.updated).toBe(1);
      const all = stores.get('crm')!.list({ status: 'active', limit: 100 });
      expect(all).toHaveLength(1);
      expect(all[0]!.fields.email).toBe('asha.sharma@x.com');
    });

    it('an incremental change updates only what changed', async () => {
      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com', phone: '111' }),
      ]), 'run_1');
      const second = await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com', phone: '222' }),
      ]), 'run_2');

      expect(second.updated).toBe(1);
      expect(stores.get('crm')!.list({ status: 'active', limit: 10 })[0]!.fields.phone).toBe('222');
    });
  });

  /* ── 4. Identity: the refusals ────────────────────────────────────────── */

  describe('identity resolution', () => {
    it('adopts a record that matches EXACTLY on a declared identity field', async () => {
      const crm = stores.get('crm')!;
      const existing = crm.create({
        title: 'Asha Rao',
        fields: { name: 'Asha Rao', email: 'asha@example.com', phone: 'DO NOT TOUCH' },
        actor: 'a person',
        now: NOW,
      });
      await crm.flush();

      const result = await bridge('hubspot_contacts', await pullContacts([
        contact('101', {
          firstname: 'Asha',
          lastname: 'Rao',
          email: 'asha@example.com',
          phone: '999',
          company: 'Borealis Trading',
        }),
      ]));

      expect(result.adopted).toBe(1);
      expect(result.created).toBe(0);
      const after = crm.get(existing.id)!;
      /**
       * The gap is filled, the person's value is not touched. An adopted
       * record's non-empty values are somebody's — possibly a correction —
       * and a sync that overwrites them silently undoes a person's work.
       */
      expect(after.fields.company).toBe('Borealis Trading');
      expect(after.fields.phone).toBe('DO NOT TOUCH');
    });

    it('an adopted record stays protected on EVERY later sync, not just the first', async () => {
      const crm = stores.get('crm')!;
      crm.create({
        title: 'Asha Rao',
        fields: { name: 'Asha Rao', email: 'asha@example.com', phone: 'DO NOT TOUCH' },
        actor: 'a person',
        now: NOW,
      });
      await crm.flush();

      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'asha@example.com', phone: '111' }),
      ]), 'run_1');
      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'asha@example.com', phone: '222' }),
      ]), 'run_2');

      expect(crm.list({ status: 'active', limit: 10 })[0]!.fields.phone).toBe('DO NOT TOUCH');
    });

    it('a record the CONNECTOR created is fully updatable — the promise is per-record', async () => {
      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com', phone: '111' }),
      ]), 'run_1');
      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com', phone: '222' }),
      ]), 'run_2');
      expect(stores.get('crm')!.list({ status: 'active', limit: 10 })[0]!.fields.phone).toBe('222');
    });

    it('does NOT merge a name that matches only after canonicalising', async () => {
      /**
       * "Acme Ltd" and "ACME Limited" really can be two companies. Adopting
       * the wrong one attaches a provider's future updates to a record it does
       * not describe, and nothing downstream would ever surface it.
       */
      const customers = stores.get('crm-customers')!;
      customers.create({ title: 'Acme Pvt Ltd', fields: { name: 'Acme Pvt Ltd' }, actor: 'a person', now: NOW });
      await customers.flush();

      const result = await bridge(
        'hubspot_companies',
        await pullCompanies([company('900', { name: 'Acme Private Limited' })]),
      );

      expect(result.ambiguous).toBe(1);
      expect(result.created).toBe(0);
      expect(result.adopted).toBe(0);
      expect(result.rows[0]!.reason).toMatch(/only after normalising/i);
      // Nothing was written, in either direction.
      expect(customers.list({ status: 'active', limit: 10 })).toHaveLength(1);
    });

    it('raises the ambiguity as a QUESTION, with the differences attached', async () => {
      /**
       * P10 — this is the assertion Program 9 could not make.
       *
       * Before this, an ambiguous row was counted in the result and dropped, so
       * the customer never appeared and nobody was ever asked. The bridge now
       * hands the decision out, and it hands out enough to decide WITH: the
       * candidate, the evidence, and what confirming would change.
       */
      const customers = stores.get('crm-customers')!;
      const existing = customers.create({
        title: 'Acme Pvt Ltd',
        // `industry` is deliberately blank and `phone` deliberately set, so the
        // difference list has one of each kind.
        fields: { name: 'Acme Pvt Ltd', phone: '+1 555 0000', industry: '' },
        actor: 'a person',
        now: NOW,
      });
      await customers.flush();

      const asked: Parameters<NonNullable<BridgeDeps['raiseIdentityQuestion']>>[0][] = [];
      const result = await bridgeResource(
        {
          connectorId: 'hubspot',
          accountId: 'acct_1',
          resourceId: 'hubspot_companies',
          syncRunId: 'run_q',
          entities: await pullCompanies([
            company('900', { name: 'Acme Private Limited', industry: 'Retail', phone: '+1 555 9999' }),
          ]),
        },
        { ...deps, raiseIdentityQuestion: (q) => asked.push(q) },
      );

      expect(result.ambiguous).toBe(1);
      expect(asked).toHaveLength(1);
      const question = asked[0]!;
      expect(question.provider).toBe('hubspot');
      // The provider's own id for the object, as the adapter reported it.
      expect(question.providerEntityId).toBe('company-900');
      expect(question.destinationModuleId).toBe('crm-customers');
      expect(question.candidates).toHaveLength(1);
      expect(question.candidates[0]!.subject.id).toBe(existing.id);
      // The reason the person reads is the SAME string the row reports. Two
      // different explanations of one refusal is how a UI starts lying.
      expect(question.reason).toBe(result.rows[0]!.reason);

      const differs = new Map(question.candidates[0]!.differs.map((d) => [d.field, d]));
      expect(differs.get('industry')).toMatchObject({ existing: '', incoming: 'Retail' });
      /**
       * The incoming side is shown POST-normalisation (`+1 555 9999` →
       * `+15559999`), because that is the value that would actually be written.
       * Showing the raw provider string would make the preview disagree with the
       * result, which is the class of defect this whole screen exists to avoid.
       */
      expect(differs.get('phone')).toMatchObject({ existing: '+1 555 0000', incoming: '+15559999' });
      // Still nothing written. Raising a question is not a decision.
      expect(customers.list({ status: 'active', limit: 10 })).toHaveLength(1);
    });

    it('does not re-ask a question a person already answered', async () => {
      /**
       * "Not a match" writes no record and therefore no provenance, so the row
       * looks identical to the engine on every subsequent sync. Without this
       * probe the person's answer lasted exactly one sync interval — and this is
       * a scheduled loop, so the question came back every minute forever.
       */
      const customers = stores.get('crm-customers')!;
      customers.create({ title: 'Acme Pvt Ltd', fields: { name: 'Acme Pvt Ltd' }, actor: 'a person', now: NOW });
      await customers.flush();

      const asked: unknown[] = [];
      const settled: BridgeDeps = {
        ...deps,
        identityDecided: () => true,
        raiseIdentityQuestion: (q) => asked.push(q),
      };
      const result = await bridgeResource(
        {
          connectorId: 'hubspot',
          accountId: 'acct_1',
          resourceId: 'hubspot_companies',
          syncRunId: 'run_settled',
          entities: await pullCompanies([company('900', { name: 'Acme Private Limited' })]),
        },
        settled,
      );

      expect(asked).toHaveLength(0);
      // Counted separately, so a settled question stops inflating the
      // "needs attention" number for the rest of time.
      expect(result.decided).toBe(1);
      expect(result.ambiguous).toBe(0);
      expect(result.rows[0]!.outcome).toBe('decided');
      expect(result.created).toBe(0);
    });

    it('a build with no identity subsystem still refuses, rather than pretending', async () => {
      /**
       * `raiseIdentityQuestion` is optional. Absent, the row must still be held
       * — an optional dependency that turns a refusal into a silent merge would
       * be worse than a required one.
       */
      const customers = stores.get('crm-customers')!;
      customers.create({ title: 'Acme Pvt Ltd', fields: { name: 'Acme Pvt Ltd' }, actor: 'a person', now: NOW });
      await customers.flush();
      const result = await bridge('hubspot_companies', await pullCompanies([company('900', { name: 'Acme Private Limited' })]));
      expect(result.ambiguous).toBe(1);
      expect(result.adopted).toBe(0);
      expect(result.created).toBe(0);
    });

    it('an unrelated company is simply created', async () => {
      const result = await bridge(
        'hubspot_companies',
        await pullCompanies([
          company('900', { name: 'Borealis Trading', domain: 'HTTPS://Borealis.example/', industry: 'Retail' }),
        ]),
      );
      expect(result.created).toBe(1);
      const rec = stores.get('crm-customers')!.list({ status: 'active', limit: 10 })[0]!;
      expect(rec.fields.name).toBe('Borealis Trading');
      expect(rec.fields.industry).toBe('Retail');
      /**
       * A stable provider-scoped code in the ontology's declared identity
       * field. Without it a CRM company's only complete keyset is its NAME,
       * which is canonicalised and therefore never exact — so the connector's
       * own companies were held as ambiguous against themselves the moment
       * provenance was lost.
       */
      // The adapter prefixes its own source ids (`company-900`), which is exactly
      // what makes the code unique across a provider's object types.
      expect(rec.fields.customerCode).toBe('HUBSPOT-company-900');
      /**
       * The provider's `domain` is NOT written. A customer has no website
       * field in this ontology, and putting a hostname into `company` or
       * `email` to avoid losing it would be worse than losing it.
       */
      expect(rec.fields.website ?? null).toBeNull();
    });
  });

  /* ── 5. Validation ────────────────────────────────────────────────────── */

  describe('rows that cannot be written', () => {
    it('a record with no name is reported, not silently dropped and not guessed', async () => {
      const entities = await pullContacts([contact('101', { email: 'nameless@example.com' })]);
      // The adapter titles it from the email, so give the bridge something
      // genuinely empty to work with.
      const blanked: UnifiedEntity[] = entities.map((e) => ({ ...e, title: '', metadata: {} }));
      const result = await bridge('hubspot_contacts', blanked);

      expect(result.invalid).toBe(1);
      expect(result.created).toBe(0);
      expect(result.rows[0]!.reason).toMatch(/needs Name/i);
    });

    it('a value the destination cannot store is dropped, never coerced', () => {
      // Writing "not-a-number" into a numeric column is how a report starts
      // lying. Checked at the mapping level, where it is decided.
      const mapping = mappingFor('hubspot', 'hubspot_companies')!;
      const target = entityForMapping(mapping)!;
      expect(target.id).toBe('customer');
      const row = mapEntity(
        {
          id: 'x',
          kind: 'organization',
          connectorId: 'hubspot',
          accountId: 'a',
          sourceId: 's',
          createdAt: NOW,
          updatedAt: NOW,
          syncState: 'active',
          syncedAt: NOW,
          metadata: { phone: '  ', industry: 'Retail' },
          title: 'Borealis',
          url: null,
          parentId: null,
          containerId: null,
          body: null,
          status: null,
          author: null,
          timestamp: null,
          endTimestamp: null,
          labels: [],
        },
        mapping,
      );
      expect(row.fields.industry).toBe('Retail');
      expect(row.fields.phone).toBeUndefined();
      expect(row.invalidReason).toBeNull();
    });

    it('normalization is deterministic and meaning-preserving', () => {
      expect(applyNormalize('  Asha  ', 'trim')).toBe('Asha');
      expect(applyNormalize('ASHA@Example.COM', 'lower')).toBe('asha@example.com');
      expect(applyNormalize('+91 98765-43210', 'phone')).toBe('+919876543210');
      expect(applyNormalize('in', 'country')).toBe('IN');
      // Not a country code — left alone rather than mangled into one.
      expect(applyNormalize('India', 'country')).toBe('India');
      expect(applyNormalize('HTTPS://Acme.example/', 'url')).toBe('acme.example');
    });
  });

  /* ── 6. Permission ────────────────────────────────────────────────────── */

  describe('permission', () => {
    it('being connected is not permission to write into a module', async () => {
      granted.delete('crm:manage');
      const entities = await pullContacts([contact('101', { firstname: 'A', lastname: 'B', email: 'a@x.com' })]);
      /**
       * The same gate `dp:import` applies — but REPORTED, not thrown. A
       * scheduled sync runs with no signed-in actor, and throwing there both
       * lost the page and wrote a governance artefact every fifteen minutes.
       */
      const result = await bridge('hubspot_contacts', entities);
      expect(result.skippedReason).toMatch(/crm:manage/);
      expect(result.created).toBe(0);
      expect(stores.get('crm')!.list({ status: 'active', limit: 10 })).toHaveLength(0);
    });

    it('refuses a module this build does not have, rather than writing nowhere', async () => {
      const narrow: BridgeDeps = { ...deps, modules: () => [CUSTOMERS_MODULE] };
      const entities = await pullContacts([contact('101', { firstname: 'A', lastname: 'B', email: 'a@x.com' })]);
      const result = await bridgeResource(
        { connectorId: 'hubspot', accountId: 'acct_1', resourceId: 'hubspot_contacts', syncRunId: 'r', entities },
        narrow,
      );
      expect(result.skippedReason).toMatch(/not a module in this build/i);
      expect(result.created).toBe(0);
    });
  });

  it('an adopted record with one filled field still reports and still fills the rest', async () => {
    /**
     * The regression: the per-field "do not overwrite a person" guard was a
     * `return`, not a `continue`. One non-empty field abandoned the WHOLE row —
     * no provenance refresh, no result row, no count — so the report silently
     * stopped summing to the number of entities pulled, and the row's remaining
     * blanks were never filled on any later sync.
     */
    const contacts = stores.get('crm')!;
    const rows = [contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com' })];
    // First sync ADOPTS a record that was already here.
    contacts.create({
      title: 'Asha Rao',
      fields: { name: 'Asha Rao', email: 'a@x.com', city: 'Pune' },
      actor: 'a person',
      now: NOW,
    });
    await contacts.flush();
    const adopt = await bridge('hubspot_contacts', await pullContacts(rows), 'r1');
    expect(adopt.adopted).toBe(1);
    const recordId = adopt.rows[0]!.recordId!;

    // Second sync: `city` is a person's value and must survive; `phone` is blank
    // and must be filled. Every row must still be accounted for.
    const second = await bridge(
      'hubspot_contacts',
      await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com', phone: '+1 555 1234', city: 'Mumbai' }),
      ]),
      'r2',
    );
    expect(second.rows).toHaveLength(1);
    const after = contacts.get(recordId)!;
    expect(after.fields.city).toBe('Pune');
    expect(after.fields.phone).toBe('+15551234');
  });

  /* ── 7. Two accounts of the same provider ─────────────────────────────── */

  describe('account isolation', () => {
    it('the same provider id under two accounts is two records, not one', async () => {
      /**
       * HubSpot contact `101` in the sales org and contact `101` in the
       * support org are different people. The external key carries the account
       * for exactly this reason.
       */
      const rows = [contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@sales.example' })];
      await bridgeResource(
        {
          connectorId: 'hubspot',
          accountId: 'acct_1',
          resourceId: 'hubspot_contacts',
          syncRunId: 'r1',
          entities: await pullContacts(rows),
        },
        deps,
      );

      const other = hubspotAdapter.resources.find((r) => r.id === 'hubspot_contacts')!;
      const page = await other.pull({
        connectorId: 'hubspot',
        accountId: 'acct_2',
        http: {
          getJson: () => Promise.resolve({ data: searchResponse([]), headers: {}, status: 200 }),
          postJson: () =>
            Promise.resolve({
              data: searchResponse([contact('101', { firstname: 'Ravi', lastname: 'Kumar', email: 'r@support.example' })]),
              headers: {},
              status: 200,
            }),
        } as unknown as SyncContext['http'],
        cursor: null,
        now: NOW,
      });

      const result = await bridgeResource(
        {
          connectorId: 'hubspot',
          accountId: 'acct_2',
          resourceId: 'hubspot_contacts',
          syncRunId: 'r2',
          entities: page.entities,
        },
        deps,
      );
      expect(result.created).toBe(1);
      expect(stores.get('crm')!.list({ status: 'active', limit: 10 })).toHaveLength(2);
    });
  });

  /* ── 8. Scale ─────────────────────────────────────────────────────────── */

  describe('scale', () => {
    it('a thousand contacts bridge once and re-bridge as unchanged', async () => {
      const rows = Array.from({ length: 1000 }, (_, i) =>
        contact(String(i), { firstname: 'P', lastname: String(i), email: `p${i}@example.com` }),
      );
      const entities = await pullContacts(rows);

      const started = Date.now();
      const first = await bridge('hubspot_contacts', entities, 'run_1');
      const elapsed = Date.now() - started;
      expect(first.created).toBe(1000);

      const second = await bridge('hubspot_contacts', entities, 'run_2');
      expect(second.created).toBe(0);
      expect(second.unchanged).toBe(1000);
      expect(stores.get('crm')!.list({ status: 'active', limit: 5000 })).toHaveLength(1000);
      // Not a benchmark — a guard against the identity index being rebuilt
      // per row, which turns a sync into an O(n²) scan.
      expect(elapsed).toBeLessThan(20_000);
    });
  });

  /* ── 9. What the adversarial review found ─────────────────────────────── */

  describe('regressions', () => {
    it('a CSV-imported record keeps its file provenance after a connector adopts it', async () => {
      /**
       * `appendConnector` used to `Object.assign` the connector row over the
       * existing one, so a background sync rewrote "row 412 of
       * Q3-customers.csv, approved by Priya, original value X" into "HubSpot
       * Contacts" — and dropped the per-field originals entirely.
       */
      const crm = stores.get('crm')!;
      const existing = crm.create({
        title: 'Asha Rao',
        fields: { name: 'Asha Rao', email: 'asha@example.com' },
        actor: 'a person',
        now: NOW,
      });
      await crm.flush();
      await provenance.appendConnector([
        {
          recordId: existing.id,
          moduleId: 'crm',
          planId: 'imp_1',
          sourceFile: 'Q3-customers.csv',
          sourceTable: 'Sheet1',
          sourceRow: 412,
          confidence: 0.94,
          approvedBy: 'Priya',
          importedAt: NOW,
          fields: [{ field: 'email', column: 'Email', original: 'ASHA@EXAMPLE.COM', transformation: 'lowercased' }],
        },
      ]);

      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'asha@example.com' }),
      ]));

      const p = provenance.forRecord(existing.id)!;
      expect(p.sourceFile).toBe('Q3-customers.csv');
      expect(p.sourceRow).toBe(412);
      expect(p.approvedBy).toBe('Priya');
      expect(p.fields).toHaveLength(1);
      // …and the connector origin is recorded ALONGSIDE it.
      expect(p.connector?.connectorId).toBe('hubspot');
      expect(p.connector?.linkage).toBe('adopted');
    });

    it('an adopted CSV record is found by its PROVIDER id afterwards, not re-created', async () => {
      /**
       * The idempotency hole this closes: `byExternal` was not indexed when the
       * record already had provenance, so the next sync fell back to identity
       * matching — and the moment the provider edited the identity field, it
       * created a duplicate.
       */
      const crm = stores.get('crm')!;
      crm.create({ title: 'Asha Rao', fields: { name: 'Asha Rao', email: 'asha@example.com' }, actor: 'x', now: NOW });
      await crm.flush();

      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'asha@example.com' }),
      ]), 'run_1');

      // The provider changes the very field the identity match relied on.
      const second = await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'asha.new@example.com' }),
      ]), 'run_2');

      expect(second.created).toBe(0);
      expect(crm.list({ status: 'active', limit: 100 })).toHaveLength(1);
    });

    it('a record somebody deleted is not resurrected every fifteen minutes', async () => {
      const crm = stores.get('crm')!;
      await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com' }),
      ]), 'run_1');
      const created = crm.list({ status: 'active', limit: 10 })[0]!;
      crm.softDelete(created.id, { actor: 'a person', now: NOW });
      await crm.flush();

      const second = await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'Asha', lastname: 'Rao', email: 'a@x.com' }),
      ]), 'run_2');

      expect(second.suppressed).toBe(1);
      expect(second.created).toBe(0);
      expect(crm.list({ status: 'active', limit: 10 })).toHaveLength(0);
    });

    it('a connector-created record carries the destination module’s required defaults', async () => {
      /**
       * `store.create` was called directly, bypassing the validator — which is
       * where `field.default` is applied. Every connector contact landed with
       * no `status`: a blank badge in every list and invisible to the status
       * filter.
       */
      const withRequired: EnterpriseModuleDescriptor = {
        ...CONTACTS_MODULE,
        fields: [
          ...CONTACTS_MODULE.fields,
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            required: true,
            default: 'lead',
            options: [
              { value: 'lead', label: 'Lead' },
              { value: 'active', label: 'Active' },
            ],
          },
        ],
      };
      const local: BridgeDeps = { ...deps, modules: () => [withRequired, CUSTOMERS_MODULE] };
      await bridgeResource(
        {
          connectorId: 'hubspot',
          accountId: 'acct_1',
          resourceId: 'hubspot_contacts',
          syncRunId: 'r',
          entities: await pullContacts([contact('101', { firstname: 'A', lastname: 'B', email: 'a@x.com' })]),
        },
        local,
      );
      expect(stores.get('crm')!.list({ status: 'active', limit: 10 })[0]!.fields.status).toBe('lead');
    });

    it('one unusable row does not cost the whole batch its provenance', async () => {
      /**
       * A throw from `store.create` propagated out before `appendConnector`
       * ran, so every record already written had NO provenance — and the next
       * sync adopted them, meaning the connector would never update them again.
       */
      const crm = stores.get('crm')!;
      const realCreate = crm.create.bind(crm);
      let calls = 0;
      crm.create = ((input: Parameters<typeof realCreate>[0]) => {
        calls += 1;
        if (calls === 2) throw new Error('store refused this one');
        return realCreate(input);
      }) as typeof crm.create;

      const result = await bridge('hubspot_contacts', await pullContacts([
        contact('101', { firstname: 'One', lastname: 'X', email: 'one@x.com' }),
        contact('102', { firstname: 'Two', lastname: 'X', email: 'two@x.com' }),
        contact('103', { firstname: 'Three', lastname: 'X', email: 'three@x.com' }),
      ]));

      expect(result.created).toBe(2);
      expect(result.invalid).toBe(1);
      // The survivors have provenance, so the next sync UPDATES them rather
      // than adopting them and freezing them forever.
      for (const record of crm.list({ status: 'active', limit: 10 })) {
        expect(provenance.forRecord(record.id)?.connector?.linkage).toBe('created');
      }
    });

    it('a company can still be adopted by name — the synthetic code did not blind it', async () => {
      /**
       * Adding a synthetic `customerCode` made the connector's own companies
       * exactly identifiable. It must not also mean a provider company never
       * meets the customer already in the book: `identitiesOf` returns EVERY
       * complete keyset, so the name keyset still reaches it — and reports
       * ambiguity rather than merging.
       */
      const customers = stores.get('crm-customers')!;
      customers.create({ title: 'Acme Pvt Ltd', fields: { name: 'Acme Pvt Ltd' }, actor: 'a person', now: NOW });
      await customers.flush();

      const result = await bridge(
        'hubspot_companies',
        await pullCompanies([company('900', { name: 'Acme Private Limited' })]),
      );
      expect(result.ambiguous).toBe(1);
      expect(result.created).toBe(0);
    });

    it('the external key cannot be forged by a provider id containing the separator', async () => {
      // `a::b` and `a`/`b` must not collapse onto one record.
      const rows = [
        contact('1::2', { firstname: 'One', lastname: 'X', email: 'one@x.com' }),
        contact('1', { firstname: 'Two', lastname: 'X', email: 'two@x.com' }),
      ];
      const result = await bridge('hubspot_contacts', await pullContacts(rows));
      expect(result.created).toBe(2);
      expect(new Set(result.rows.map((r) => r.recordId)).size).toBe(2);
    });
  });
});
