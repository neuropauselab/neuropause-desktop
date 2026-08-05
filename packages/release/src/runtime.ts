/**
 * EPIC 1 — General Availability Runtime. The release/version registries and the governed release
 * lifecycle. A release advances through draft → release-candidate → validated → ga-approved → released
 * (or superseded/rolled-back); each transition appends to the release history and is audited on the one
 * chain. 'released' is reached only after the evidence-based GA gate — never assumed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ReleaseStatus, ReleaseChannel } from './constants';
import type { ReleaseGovernance } from './governance';

export interface ReleaseEvent {
  at: number;
  status: ReleaseStatus;
  note: string;
}

export interface Release {
  id: string;
  version: string;
  channel: ReleaseChannel;
  status: ReleaseStatus;
  createdAt: number;
  history: ReleaseEvent[];
  metadata: Record<string, string>;
}

const NEXT: Record<ReleaseStatus, ReleaseStatus[]> = {
  draft: ['release-candidate', 'superseded'],
  'release-candidate': ['validated', 'rolled-back'],
  validated: ['ga-approved', 'rolled-back'],
  'ga-approved': ['released', 'rolled-back'],
  released: ['superseded', 'rolled-back'],
  superseded: [],
  'rolled-back': [],
};

export class ReleaseRuntime {
  private readonly releases = new Map<string, Release>();
  private readonly byVersion = new Map<string, string>();

  constructor(
    private readonly clock: Clock,
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  async register(input: { version: string; channel?: ReleaseChannel; metadata?: Record<string, string> }): Promise<Release> {
    if (this.byVersion.has(input.version)) throw new Error(`version already registered: ${input.version}`);
    const at = this.clock.now();
    const release: Release = {
      id: randomId('rel'),
      version: input.version,
      channel: input.channel ?? 'stable',
      status: 'draft',
      createdAt: at,
      history: [{ at, status: 'draft', note: 'release registered' }],
      metadata: input.metadata ?? {},
    };
    this.releases.set(release.id, release);
    this.byVersion.set(input.version, release.id);
    await this.gov.record({ operator: this.operator, version: input.version, environment: '_release', customerScope: '_all', epic: 'E1', operation: 'register-release', targetId: release.id, evidence: 'live-verified' });
    return release;
  }

  /** Advance a release through its lifecycle. Illegal transitions throw — status is never silently forced. */
  async transition(releaseId: string, status: ReleaseStatus, note?: string): Promise<Release> {
    const release = this.releases.get(releaseId);
    if (!release) throw new Error(`unknown release: ${releaseId}`);
    if (!NEXT[release.status].includes(status)) throw new Error(`illegal release transition: ${release.status} → ${status}`);
    release.status = status;
    release.history.push({ at: this.clock.now(), status, note: note ?? status });
    await this.gov.record({ operator: this.operator, version: release.version, environment: '_release', customerScope: '_all', epic: 'E1', operation: 'transition', targetId: releaseId, evidence: 'live-verified', decision: status });
    return release;
  }

  get(id: string): Release | undefined { return this.releases.get(id); }
  byVersionId(version: string): Release | undefined {
    const id = this.byVersion.get(version);
    return id ? this.releases.get(id) : undefined;
  }
  history(releaseId: string): ReleaseEvent[] { return this.releases.get(releaseId)?.history ?? []; }
  versions(): string[] { return [...this.byVersion.keys()]; }
  list(status?: ReleaseStatus): Release[] {
    const all = [...this.releases.values()];
    return status ? all.filter((r) => r.status === status) : all;
  }
}
