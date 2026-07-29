/**
 * Module 8 — Cross-Organization Exchange. Share workflows / policies / dashboards /
 * playbooks / connectors / AI agents between organizations as REFERENCES (descriptors) —
 * never cross-org execution. A share requires `share`-level trust from the source to the
 * target (enforced via the trust engine) and is governed. The recipient gets a copy of the
 * payload descriptor; nothing executes across the org boundary.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { TrustEngine } from './trust';
import type { SharedArtifact } from './types';
import type { ArtifactKind } from './constants';

export class CrossOrgExchange {
  private readonly shared: SharedArtifact[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: FederationGovernance,
    private readonly trust: TrustEngine,
  ) {}

  async share(input: { federationId: string; kind: ArtifactKind; name: string; fromOrg: string; toOrg: string; payload?: Record<string, unknown> }): Promise<SharedArtifact> {
    if (!this.trust.validate(input.federationId, input.fromOrg, input.toOrg, 'share')) {
      throw new Error(`'${input.fromOrg}' lacks 'share' trust to '${input.toOrg}' in federation '${input.federationId}'`);
    }
    const artifact: SharedArtifact = { id: randomId('share'), kind: input.kind, name: input.name, fromOrg: input.fromOrg, toOrg: input.toOrg, federationId: input.federationId, payload: input.payload ?? {}, sharedAt: this.clock.now() };
    this.shared.push(artifact);
    await this.governance.record({ federationId: input.federationId, actor: input.fromOrg, operation: `exchange.${input.kind}.share`, targetId: artifact.id, evidence: 'live-verified', detail: `${input.fromOrg}→${input.toOrg}` });
    return artifact;
  }

  received(orgId: string): SharedArtifact[] {
    return this.shared.filter((a) => a.toOrg === orgId);
  }
  sharedBy(orgId: string): SharedArtifact[] {
    return this.shared.filter((a) => a.fromOrg === orgId);
  }
  forFederation(federationId: string): SharedArtifact[] {
    return this.shared.filter((a) => a.federationId === federationId);
  }
  all(): SharedArtifact[] {
    return [...this.shared];
  }
  count(): number {
    return this.shared.length;
  }
}
