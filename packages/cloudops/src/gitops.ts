/**
 * Module 5 — GitOps Platform. A Git repository descriptor, a desired-state model, commit
 * history, rollback metadata, and a promotion pipeline. Drift detection is a REAL in-process
 * diff of desired vs observed manifest sets (live-verified). The ArgoCD/Flux engine shapes are
 * adapter-verified; actual reconciliation against a running controller/cluster is INFRA-PENDING.
 */
import { randomId, sha256Hex, type Clock } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { GitRepository, GitCommit, DriftReport } from './types';
import { GITOPS_ENGINES, type GitOpsEngine } from './constants';

export interface RegisterRepoInput {
  url: string;
  engine: GitOpsEngine;
  branch?: string;
  path?: string;
}

interface RepoState {
  repo: GitRepository;
  desired: string[];
  commits: GitCommit[];
  seq: number;
}

export class GitOpsPlatform {
  private readonly repos = new Map<string, RepoState>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
  ) {}

  async registerRepository(input: RegisterRepoInput): Promise<GitRepository> {
    if (!GITOPS_ENGINES.includes(input.engine)) throw new Error(`unknown GitOps engine: ${input.engine}`);
    const repo: GitRepository = {
      id: randomId('repo'),
      url: input.url,
      branch: input.branch ?? 'main',
      path: input.path ?? '/',
      engine: input.engine,
      createdAt: this.clock.now(),
      evidence: 'adapter-verified',
      note: `${input.engine} adapter shape registered — real GitOps reconciliation is INFRA-PENDING (needs a running controller + cluster)`,
    };
    this.repos.set(repo.id, { repo, desired: [], commits: [], seq: 0 });
    await this.governance.record({ actor: 'system', operation: `gitops.register.${input.engine}`, targetId: repo.id, evidence: 'adapter-verified', detail: repo.note });
    return repo;
  }

  /** Set desired state = the manifests git declares. Records a commit. */
  async commit(repositoryId: string, message: string, manifestIds: string[]): Promise<GitCommit> {
    const s = this.require(repositoryId);
    s.seq += 1;
    const sha = sha256Hex(JSON.stringify({ repo: repositoryId, message, manifestIds, seq: s.seq })).slice(0, 12);
    const commit: GitCommit = { sha, message, manifestIds: [...manifestIds], at: this.clock.now() };
    s.commits.push(commit);
    s.desired = [...manifestIds];
    await this.governance.record({ actor: 'system', operation: 'gitops.commit', targetId: repositoryId, evidence: 'live-verified', scope: repositoryId, detail: sha });
    return commit;
  }

  desiredState(repositoryId: string): string[] {
    return [...this.require(repositoryId).desired];
  }
  history(repositoryId: string): GitCommit[] {
    return [...this.require(repositoryId).commits];
  }

  /** REAL in-process diff of desired (git) vs observed (supplied) manifest sets. */
  detectDrift(repositoryId: string, observedManifestIds: string[]): DriftReport {
    const s = this.require(repositoryId);
    const desired = new Set(s.desired);
    const observed = new Set(observedManifestIds);
    const added = [...desired].filter((id) => !observed.has(id)); // declared but not observed
    const removed = [...observed].filter((id) => !desired.has(id)); // observed but not declared
    const inSync = added.length === 0 && removed.length === 0;
    return {
      repositoryId,
      inSync,
      added,
      removed,
      changed: [],
      evidence: 'live-verified',
      note: inSync
        ? 'desired matches observed (in-process diff)'
        : 'drift detected by in-process diff — reconciliation against a live cluster is INFRA-PENDING',
    };
  }

  /** Rollback desired state to a prior commit. Rollback METADATA only — nothing is applied. */
  async rollback(repositoryId: string, sha: string): Promise<GitCommit> {
    const s = this.require(repositoryId);
    const target = s.commits.find((c) => c.sha === sha);
    if (!target) throw new Error(`no commit ${sha} in ${repositoryId}`);
    s.desired = [...target.manifestIds];
    await this.governance.record({ actor: 'system', operation: 'gitops.rollback', targetId: repositoryId, evidence: 'live-verified', scope: repositoryId, detail: sha });
    return target;
  }

  /** Promotion pipeline: copy desired state from one repo/env to another. In-process only. */
  async promote(fromRepositoryId: string, toRepositoryId: string): Promise<GitCommit> {
    const from = this.require(fromRepositoryId);
    const commit = await this.commit(toRepositoryId, `promote from ${fromRepositoryId}`, from.desired);
    await this.governance.record({ actor: 'system', operation: 'gitops.promote', targetId: toRepositoryId, evidence: 'live-verified', scope: toRepositoryId, detail: fromRepositoryId });
    return commit;
  }

  private require(id: string): RepoState {
    const s = this.repos.get(id);
    if (!s) throw new Error(`no repository ${id}`);
    return s;
  }

  get(id: string): GitRepository | undefined {
    return this.repos.get(id)?.repo;
  }
  list(): GitRepository[] {
    return [...this.repos.values()].map((s) => s.repo);
  }
  count(): number {
    return this.repos.size;
  }
}
