/**
 * The NeuroPause client — the main entry point. Configure it with a gateway base
 * URL + API key (HTTP transport), or inject a custom transport. Resources hang
 * off the client and share its transport.
 */
import type { ApiVersion } from '@neuropause/shared';
import { HttpTransport, type FetchLike, type Transport } from './transport';
import { BillingResource, ConnectorsResource, MarketplaceResource, UsageResource, WorkersResource } from './resources';

export interface NeuroPauseClientOptions {
  baseUrl?: string;
  apiKey?: string;
  version?: ApiVersion;
  /** Provide a custom transport to bypass HTTP entirely (tests, IPC embedding). */
  transport?: Transport;
  fetchImpl?: FetchLike;
}

const DEFAULT_BASE_URL = 'https://api.neuropause.dev';

export class NeuroPauseClient {
  readonly transport: Transport;
  readonly marketplace: MarketplaceResource;
  readonly workers: WorkersResource;
  readonly connectors: ConnectorsResource;
  readonly usage: UsageResource;
  readonly billing: BillingResource;

  constructor(options: NeuroPauseClientOptions = {}) {
    this.transport =
      options.transport ??
      new HttpTransport({
        baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
        apiKey: options.apiKey,
        defaultVersion: options.version ?? 'v1',
        fetchImpl: options.fetchImpl,
      });
    this.marketplace = new MarketplaceResource(this.transport);
    this.workers = new WorkersResource(this.transport);
    this.connectors = new ConnectorsResource(this.transport);
    this.usage = new UsageResource(this.transport);
    this.billing = new BillingResource(this.transport);
  }
}
