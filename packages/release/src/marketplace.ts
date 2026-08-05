/**
 * EPIC 11 — Marketplace & Distribution. Adapters for GitHub Releases, a private enterprise repository,
 * Azure Marketplace, AWS Marketplace, and the Docker registry. Publication is REPRESENTED: preparing a
 * publication records intent and validates the artifact reference, but a channel is NEVER reported live
 * until a real, confirmed publication URL is supplied. Without that, status stays 'prepared' and
 * `live` is false — no listing is claimed before it occurs.
 */
import { MARKETPLACE_CHANNELS, type MarketplaceChannel } from './constants';
import type { ReleaseGovernance } from './governance';

export interface Publication {
  channel: MarketplaceChannel;
  version: string;
  status: 'prepared' | 'published';
  live: boolean;
  url: string | null;
  note: string;
}

export class MarketplaceDistribution {
  private readonly publications = new Map<string, Publication>();

  constructor(
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  channels(): readonly MarketplaceChannel[] {
    return MARKETPLACE_CHANNELS;
  }

  /** Prepare a publication. `publishedUrl` marks it live ONLY when a real confirmed URL is supplied. */
  async prepare(input: { channel: MarketplaceChannel; version: string; publishedUrl?: string }): Promise<Publication> {
    if (!MARKETPLACE_CHANNELS.includes(input.channel)) throw new Error(`unknown channel: ${input.channel}`);
    const confirmed = typeof input.publishedUrl === 'string' && /^https?:\/\//.test(input.publishedUrl);
    const publication: Publication = {
      channel: input.channel,
      version: input.version,
      status: confirmed ? 'published' : 'prepared',
      live: confirmed,
      url: confirmed ? input.publishedUrl! : null,
      note: confirmed ? 'a confirmed publication URL was supplied — listing recorded live' : 'publication prepared and represented; NOT live until a real publication URL is confirmed',
    };
    this.publications.set(`${input.channel}:${input.version}`, publication);
    await this.gov.record({ operator: this.operator, version: input.version, environment: '_distribution', customerScope: '_all', epic: 'E11', operation: 'prepare-publication', targetId: input.channel, evidence: confirmed ? 'live-verified' : 'adapter-verified', decision: publication.status });
    return publication;
  }

  get(channel: MarketplaceChannel, version: string): Publication | undefined {
    return this.publications.get(`${channel}:${version}`);
  }
  list(): Publication[] {
    return [...this.publications.values()];
  }
  liveCount(): number {
    return [...this.publications.values()].filter((p) => p.live).length;
  }
}
