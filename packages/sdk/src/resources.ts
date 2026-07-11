/**
 * Typed resource clients. Each maps to a section of the REST surface fronted by
 * the API gateway; the gateway enforces auth, scope, rate, and quota on every
 * call. Methods return parsed, typed data.
 */
import type {
  BillingSummary,
  ListingDetail,
  ListingManifest,
  ListingVersion,
  MarketplaceListing,
  MarketplaceStats,
  OAuthTokenResponse,
  Plan,
  ReviewDecision,
} from '@neuropause/shared';
import type { Transport } from './transport';

/**
 * OAuth 2.1 — obtain a machine access token via the client-credentials grant
 * (P3.0). The returned `access_token` is a Bearer token: pass it as `apiKey` to a
 * `NeuroPauseClient` to make authenticated calls as the service account.
 */
export class OAuthResource {
  constructor(private readonly t: Transport) {}
  token(input: { clientId: string; clientSecret: string; scope?: string }): Promise<OAuthTokenResponse> {
    return this.t
      .request<OAuthTokenResponse>({
        method: 'POST',
        path: '/oauth/token',
        body: { grantType: 'client_credentials', clientId: input.clientId, clientSecret: input.clientSecret, scope: input.scope },
      })
      .then((r) => r.data);
  }
}

export class MarketplaceResource {
  constructor(private readonly t: Transport) {}

  list(): Promise<MarketplaceListing[]> {
    return this.t.request<MarketplaceListing[]>({ method: 'GET', path: '/marketplace/listings', scope: 'marketplace:read' }).then((r) => r.data);
  }
  get(listingId: string): Promise<ListingDetail> {
    return this.t.request<ListingDetail>({ method: 'GET', path: `/marketplace/listings/${listingId}`, scope: 'marketplace:read' }).then((r) => r.data);
  }
  stats(): Promise<MarketplaceStats> {
    return this.t.request<MarketplaceStats>({ method: 'GET', path: '/marketplace/stats', scope: 'marketplace:read' }).then((r) => r.data);
  }
  /** Create a new version (draft) for a listing from a manifest. */
  publishVersion(listingId: string, manifest: ListingManifest, changelog: string): Promise<ListingVersion> {
    return this.t.request<ListingVersion>({ method: 'POST', path: `/marketplace/listings/${listingId}/versions`, body: { manifest, changelog }, scope: 'marketplace:publish' }).then((r) => r.data);
  }
  /** Submit a version into the review pipeline (scan → sign → review). */
  submit(versionId: string): Promise<ListingVersion> {
    return this.t.request<ListingVersion>({ method: 'POST', path: `/marketplace/versions/${versionId}/submit`, scope: 'marketplace:publish' }).then((r) => r.data);
  }
  review(versionId: string, decision: ReviewDecision, notes = ''): Promise<ListingVersion> {
    return this.t.request<ListingVersion>({ method: 'POST', path: `/marketplace/versions/${versionId}/review`, body: { decision, notes }, scope: 'marketplace:publish' }).then((r) => r.data);
  }
  publish(versionId: string): Promise<ListingVersion> {
    return this.t.request<ListingVersion>({ method: 'POST', path: `/marketplace/versions/${versionId}/publish`, scope: 'marketplace:publish' }).then((r) => r.data);
  }
  rollback(listingId: string): Promise<MarketplaceListing> {
    return this.t.request<MarketplaceListing>({ method: 'POST', path: `/marketplace/listings/${listingId}/rollback`, scope: 'marketplace:publish' }).then((r) => r.data);
  }
  install(listingId: string): Promise<MarketplaceListing> {
    return this.t.request<MarketplaceListing>({ method: 'POST', path: `/marketplace/listings/${listingId}/install`, scope: 'marketplace:read' }).then((r) => r.data);
  }
}

export class WorkersResource {
  constructor(private readonly t: Transport) {}
  list(): Promise<MarketplaceListing[]> {
    return this.t.request<MarketplaceListing[]>({ method: 'GET', path: '/workers', scope: 'workers:read' }).then((r) => r.data);
  }
}

export class ConnectorsResource {
  constructor(private readonly t: Transport) {}
  list(): Promise<MarketplaceListing[]> {
    return this.t.request<MarketplaceListing[]>({ method: 'GET', path: '/connectors', scope: 'connectors:read' }).then((r) => r.data);
  }
}

export class UsageResource {
  constructor(private readonly t: Transport) {}
  summary(windowDays = 30): Promise<unknown> {
    return this.t.request<unknown>({ method: 'GET', path: '/usage/analytics', query: { windowDays }, scope: 'usage:read' }).then((r) => r.data);
  }
}

export class BillingResource {
  constructor(private readonly t: Transport) {}
  summary(): Promise<BillingSummary> {
    return this.t.request<BillingSummary>({ method: 'GET', path: '/billing/summary', scope: 'billing:read' }).then((r) => r.data);
  }
  plans(): Promise<Plan[]> {
    return this.t.request<Plan[]>({ method: 'GET', path: '/billing/plans', scope: 'billing:read' }).then((r) => r.data);
  }
}
