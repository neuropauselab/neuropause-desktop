/**
 * P5 — Increment 9: the HubSpot connector FAMILY (Contacts, Companies, Deals, Tickets, Products, Owners,
 * Notes, Tasks, Meetings, Emails on one `hubspot` connector). Pure-node, fake HttpClient. Covers family
 * composition, scope-gated capability discovery (✓/✗), the Search-API last-modified high-water incremental
 * pull (empty-filter first sync, GTE epoch-ms incremental, ASC sort, within-run `after` paging, run-scoped
 * offset guard, MAX_PAGES cap), the owners full-list walk, the mappers (kinds, per-type collision prefixes,
 * timestamp normalization, HTML-stripped bodies), and graceful degradation (403 unauthorized / 5xx propagates).
 */
import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import { MANIFEST_BY_ID } from '../../../connectors/manifests';
import {
  hubspotAdapter,
  hubspotServiceAvailability,
  HUBSPOT_SERVICES,
  mapContact,
  mapCompany,
  mapDeal,
  mapTicket,
  mapProduct,
  mapNote,
  mapTask,
  mapMeeting,
  mapEmail,
  mapOwner,
} from './hubspot';

const NOW = '2026-07-13T00:00:00.000Z';
/** Must match OVERLAP_MS in hubspot.ts — the incremental filter re-scans this window below the high-water. */
const OVERLAP = 2 * 60 * 1000;
const baseCtx = { connectorId: 'hubspot', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...baseCtx, http: undefined as never, cursor: null };

interface Req { method: 'GET' | 'POST'; url: string; body?: unknown; opts?: HttpRequestOptions }

/** ctx whose http replays a body per request (200), or throws. Supports getJson (owners) + postJson (search). */
function routed(handler: (req: Req) => unknown, cursor: string | null): SyncContext {
  const run = (fn: () => unknown) => {
    try {
      return Promise.resolve({ data: fn(), headers: {}, status: 200 });
    } catch (err) {
      return Promise.reject(err);
    }
  };
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => run(() => handler({ method: 'GET', url, opts })),
    postJson: (url: string, body: unknown, opts?: HttpRequestOptions) => run(() => handler({ method: 'POST', url, body, opts })),
  } as unknown as SyncContext['http'];
  return { ...baseCtx, http, cursor };
}
const rejecting = (err: Error, cursor: string | null): SyncContext => ({
  ...baseCtx,
  http: {
    getJson: () => Promise.reject(err),
    postJson: () => Promise.reject(err),
  } as unknown as SyncContext['http'],
  cursor,
});

const byId = (id: string) => hubspotAdapter.resources.find((r) => r.id === id)!;
const contactsR = byId('hubspot_contacts');
const dealsR = byId('hubspot_deals');
const ownersR = byId('hubspot_owners');

describe('HubSpot family — composition & scope-gated capability discovery', () => {
  it('is ONE connector with every CRM object mounted as a service resource', () => {
    expect(hubspotAdapter.connectorId).toBe('hubspot');
    expect(hubspotAdapter.resources.map((r) => r.id)).toEqual([
      'hubspot_contacts', 'hubspot_companies', 'hubspot_deals', 'hubspot_tickets', 'hubspot_products',
      'hubspot_notes', 'hubspot_tasks', 'hubspot_meetings', 'hubspot_emails', 'hubspot_owners',
    ]);
  });

  it('the catalog ids match the adapter resource ids (so live counts appear per service)', () => {
    expect(HUBSPOT_SERVICES.map((s) => s.id)).toEqual(hubspotAdapter.resources.map((r) => r.id));
  });

  it('projects availability against the granted per-object scopes (✓/✗)', () => {
    const map = Object.fromEntries(
      hubspotServiceAvailability(['crm.objects.contacts.read', 'crm.objects.deals.read']).map((s) => [s.id, s.available]),
    );
    // Contacts scope unlocks contacts AND the engagement objects (notes/tasks/meetings/emails).
    expect(map.hubspot_contacts).toBe(true);
    expect(map.hubspot_notes).toBe(true);
    expect(map.hubspot_tasks).toBe(true);
    expect(map.hubspot_emails).toBe(true);
    expect(map.hubspot_deals).toBe(true);
    // Not granted → not available.
    expect(map.hubspot_companies).toBe(false);
    expect(map.hubspot_tickets).toBe(false);
    expect(map.hubspot_products).toBe(false); // e-commerce (tier-gated) not granted
    expect(map.hubspot_owners).toBe(false);
  });
});

describe('HubSpot mappers — kinds, per-type collision prefixes, timestamps', () => {
  it('maps a Contact → contact and a Company → organization with normalized (Z) timestamps', () => {
    const c = mapContact(pureCtx, { id: '101', properties: { firstname: 'Ada', lastname: 'Byron', email: 'ada@acme.com' }, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-07-02T10:00:00.000Z' });
    expect(c.kind).toBe('contact');
    expect(c.id).toBe('hubspot:a1:contact:contact-101');
    expect(c.title).toBe('Ada Byron');
    expect(c.updatedAt).toBe('2026-07-02T10:00:00.000Z');
    expect(c.metadata.hubspotType).toBe('contact');
    const co = mapCompany(pureCtx, { id: '55', properties: { name: 'Acme', domain: 'acme.com' } });
    expect(co.kind).toBe('organization');
    expect(co.id).toBe('hubspot:a1:organization:company-55');
  });

  it('prefixes sourceIds per type so Deals/Tickets/Tasks (all → task) never collide on a shared id', () => {
    const deal = mapDeal(pureCtx, { id: '12345', properties: { dealname: 'Big Deal', dealstage: 'contractsent', amount: '5000' } });
    const ticket = mapTicket(pureCtx, { id: '12345', properties: { subject: 'Broken', hs_pipeline_stage: '1' } });
    const task = mapTask(pureCtx, { id: '12345', properties: { hs_task_subject: 'Call back' } });
    expect([deal.kind, ticket.kind, task.kind]).toEqual(['task', 'task', 'task']);
    // Same raw id 12345, same kind, but three DISTINCT unified ids thanks to the type prefix.
    expect(new Set([deal.id, ticket.id, task.id]).size).toBe(3);
    expect(deal.id).toBe('hubspot:a1:task:deal-12345');
    expect(ticket.id).toBe('hubspot:a1:task:ticket-12345');
    expect(task.id).toBe('hubspot:a1:task:task-12345');
    expect(deal.metadata.amount).toBe('5000');
  });

  it('maps a Product → document, a Note → activity (HTML stripped), a Meeting → calendar_event with start/end', () => {
    const prod = mapProduct(pureCtx, { id: '9', properties: { name: 'Widget', price: '19.99', hs_sku: 'W-1' } });
    expect(prod.kind).toBe('document');
    expect(prod.id).toBe('hubspot:a1:document:product-9');

    const note = mapNote(pureCtx, { id: '7', properties: { hs_note_body: '<p>Called&nbsp;the <b>lead</b></p>' } });
    expect(note.kind).toBe('activity');
    expect(note.title).toBe('Called the lead'); // tags + entities stripped
    expect(note.body).toBe('Called the lead');

    const mtg = mapMeeting(pureCtx, { id: '3', properties: { hs_meeting_title: 'Demo', hs_meeting_start_time: '2026-07-15T15:00:00Z', hs_meeting_end_time: '2026-07-15T16:00:00Z' } });
    expect(mtg.kind).toBe('calendar_event');
    expect(mtg.timestamp).toBe('2026-07-15T15:00:00.000Z');
    expect(mtg.endTimestamp).toBe('2026-07-15T16:00:00.000Z');
  });

  it('normalizes a property datetime given as an epoch-ms string (meeting start) to ISO-Z', () => {
    const start = Date.UTC(2026, 6, 20, 9, 0, 0); // 2026-07-20T09:00:00Z
    const mtg = mapMeeting(pureCtx, { id: '4', properties: { hs_meeting_title: 'Sync', hs_meeting_start_time: String(start) } });
    expect(mtg.timestamp).toBe('2026-07-20T09:00:00.000Z');
  });

  it('maps an Email → message and (via the owners endpoint) an Owner → contact, disjoint from a contact id', () => {
    const em = mapEmail(pureCtx, { id: '88', properties: { hs_email_subject: 'Hello', hs_email_from_email: 'rep@acme.com', hs_email_direction: 'EMAIL' } });
    expect(em.kind).toBe('message');
    expect(em.id).toBe('hubspot:a1:message:email-88');
    expect(em.author).toBe('rep@acme.com');

    const owner = mapOwner(pureCtx, { id: '101', email: 'rep@acme.com', firstName: 'Sales', lastName: 'Rep', userId: 55, updatedAt: '2026-05-01T00:00:00Z' });
    const contact = mapContact(pureCtx, { id: '101', properties: { firstname: 'Ada' } });
    expect(owner.kind).toBe('contact');
    expect(owner.metadata.hubspotType).toBe('owner');
    expect(owner.id).toBe('hubspot:a1:contact:owner-101');
    expect(owner.id).not.toBe(contact.id); // owner-101 vs contact-101 — no collision despite the shared raw id
    expect(owner.updatedAt).toBe('2026-05-01T00:00:00.000Z'); // owner's own stamp (churn-free), not the run clock
  });
});

describe('HubSpot Search incremental — last-modified high-water (ASC, leapfrog-free)', () => {
  it('first sync: no filter, ASC sort on the object last-modified property, commits the newest high-water on drain', async () => {
    let sentBody: Record<string, unknown> = {};
    const ctx = routed((req) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://api.hubapi.com/crm/v3/objects/contacts/search');
      sentBody = req.body as Record<string, unknown>;
      return { results: [{ id: '1', properties: { firstname: 'A' }, updatedAt: '2026-07-10T00:00:00.000Z' }], paging: null };
    }, null);
    const page = await contactsR.pull(ctx);
    expect(sentBody.filterGroups).toEqual([]); // no high-water yet → unfiltered
    expect(sentBody.sorts).toEqual([{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }]); // contacts quirk
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-10T00:00:00.000Z')); // epoch-ms high-water committed
  });

  it('incremental: filters <lastmod> GTE (high-water − overlap) as an epoch-ms STRING', async () => {
    const hw = Date.parse('2026-07-05T08:15:20.500Z');
    let sentBody: { filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }> } = {};
    const ctx = routed((req) => {
      sentBody = req.body as typeof sentBody;
      return { results: [{ id: '2', properties: { hs_lastmodifieddate: String(Date.parse('2026-07-11T09:00:00.000Z')) }, updatedAt: '2026-07-11T09:00:00.000Z' }], paging: null };
    }, JSON.stringify({ hw }));
    await dealsR.pull(ctx);
    // A small overlap window below the high-water absorbs HubSpot Search's out-of-order indexing (deduped).
    expect(sentBody.filterGroups).toEqual([{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(hw - OVERLAP) }] }]);
  });

  it('advances the high-water by the sort/filter property, NOT the top-level updatedAt (contacts quirk)', async () => {
    // A contact whose SYSTEM updatedAt is far ahead of its `lastmodifieddate` (e.g. list-membership churn):
    // the committed high-water must come from `lastmodifieddate` (the field we sort/filter on), else the
    // next GTE(hw) would skip every contact whose `lastmodifieddate` sits below that inflated updatedAt.
    const lastMod = Date.parse('2026-07-03T00:00:00.000Z');
    const ctx = routed(() => ({
      results: [{ id: '1', properties: { lastmodifieddate: String(lastMod) }, updatedAt: '2026-07-12T00:00:00.000Z' }],
      paging: null,
    }), null);
    const page = await contactsR.pull(ctx);
    expect(JSON.parse(page.cursor as string).hw).toBe(lastMod); // from lastmodifieddate, NOT updatedAt (2026-07-12)
  });

  it('within a run it follows paging.next.after (tagged with the run clock) and holds the high-water uncommitted', async () => {
    const p1 = await contactsR.pull(routed(() => ({
      results: [{ id: '1', properties: {}, updatedAt: '2026-07-18T00:00:00.000Z' }], paging: { next: { after: '200' } },
    }), null));
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor as string);
    expect(c1.after).toBe('200');
    expect(c1.runAt).toBe(NOW);
    expect(c1.hw).toBeUndefined(); // not committed mid-walk
    expect(c1.pending).toBe(Date.parse('2026-07-18T00:00:00.000Z'));

    const p2 = await contactsR.pull(routed((req) => {
      expect((req.body as { after?: string }).after).toBe('200'); // same-run offset is sent
      return { results: [{ id: '2', properties: {}, updatedAt: '2026-07-20T00:00:00.000Z' }], paging: null };
    }, p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string).hw).toBe(Date.parse('2026-07-20T00:00:00.000Z'));
  });

  it('an offset AND a mid-walk pending left by a PRIOR run (runAt ≠ now) are NEVER replayed — rebuild from the high-water', async () => {
    const hw = Date.parse('2026-07-02T00:00:00.000Z');
    const stalePending = Date.parse('2026-12-31T00:00:00.000Z'); // an inflated pending from an interrupted walk
    const recLastMod = Date.parse('2026-07-04T00:00:00.000Z');
    let sentBody: { after?: string; filterGroups?: Array<{ filters: Array<{ value: string }> }> } = {};
    const ctx = routed((req) => {
      sentBody = req.body as typeof sentBody;
      return { results: [{ id: 'r', properties: { lastmodifieddate: String(recLastMod) }, updatedAt: '2026-07-04T00:00:00.000Z' }], paging: null };
    }, JSON.stringify({ hw, after: '600', runAt: '2020-01-01T00:00:00.000Z', pending: stalePending, page: 3 }));
    const page = await contactsR.pull(ctx);
    expect(sentBody.after).toBeUndefined(); // stale offset dropped (a fresh run never trusts a prior offset)
    expect(sentBody.filterGroups?.[0].filters[0].value).toBe(String(hw - OVERLAP)); // rebuilt from the durable high-water
    // The committed high-water derives from THIS page's records, never the stale mid-walk pending.
    expect(JSON.parse(page.cursor as string).hw).toBe(recLastMod);
  });

  it('at the MAX_PAGES cap it commits the high-water and drops the offset — the search resumes next run (NO leapfrog)', async () => {
    // Within the run (runAt === now) at page 19 → page+1 (20) is not < MAX_PAGES (20), so it caps with a live offset.
    const page = await contactsR.pull(routed(() => ({
      results: [{ id: '9', properties: {}, updatedAt: '2026-07-25T00:00:00.000Z' }], paging: { next: { after: '4000' } },
    }), JSON.stringify({ hw: Date.parse('2026-07-01T00:00:00.000Z'), after: '3800', runAt: NOW, page: 19 })));
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string);
    expect(c.hw).toBe(Date.parse('2026-07-25T00:00:00.000Z')); // committed → next run's GTE(this) resumes forward
    expect(c.after).toBeUndefined(); // offset dropped; the durable high-water drives resumption
  });
});

describe('HubSpot owners — full-list walk (no search / no last-modified filter)', () => {
  it('walks /crm/v3/owners via after and resets the cursor on drain (re-walked each run, store dedups)', async () => {
    const p1 = await ownersR.pull(routed((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('https://api.hubapi.com/crm/v3/owners');
      expect(req.opts?.query).toMatchObject({ limit: 100, archived: false });
      return { results: [{ id: '1', email: 'a@acme.com', firstName: 'A', updatedAt: '2026-01-01T00:00:00Z' }], paging: { next: { after: '1' } } };
    }, null));
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string).after).toBe('1');

    const p2 = await ownersR.pull(routed((req) => {
      expect(req.opts?.query?.after).toBe('1'); // resumes within the run from the persisted offset
      return { results: [{ id: '2', email: 'b@acme.com' }], paging: null };
    }, p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string)).toEqual({}); // reset → next run re-walks the full snapshot
  });
});

describe('HubSpot manifest — least-privilege + refresh', () => {
  it('requires only granular .read scopes; coarse/tier scopes are optional; no synthesized token TTL', () => {
    const hs = MANIFEST_BY_ID['hubspot'];
    // REQUIRED = granular least-privilege reads only (the coarse read+write `tickets` scope is NOT required).
    expect(hs?.oauth?.scopes).toEqual([
      'crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.owners.read',
    ]);
    expect(hs?.oauth?.extraAuthParams?.optional_scope).toBe('tickets e-commerce sales-email-read');
    // HubSpot returns expires_in, so the EXISTING proactive-refresh path covers it — no synthesized TTL.
    expect(hs?.oauth?.accessTokenTtlSeconds).toBeUndefined();
    expect(hs?.oauth?.usePkce).toBe(false); // confidential flow; HubSpot has no PKCE
  });
});

describe('HubSpot graceful degradation', () => {
  it('a 403 (missing/ungranted scope, e.g. a hub the portal lacks) degrades the SERVICE as unauthorized', async () => {
    const page = await dealsR.pull(rejecting(new AuthError('forbidden', 403), null));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('a 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(contactsR.pull(rejecting(new HttpError(500, 'server error', true), null))).rejects.toThrow();
  });
});
