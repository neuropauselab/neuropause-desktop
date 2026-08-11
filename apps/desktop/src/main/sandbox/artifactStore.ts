/**
 * AI Sandbox — Artifact store (S1). ONE reusable store for every execution output —
 * screenshots, video, logs, traces, reports, and results — with typed facets over it
 * (there is no separate persistence layer per kind). Binary captures (screenshots,
 * video) carry a `storageRef` a later stage wrote; textual outputs (logs, reports,
 * results) may carry `inline` content. Reports/results are stored as first-class
 * artifacts whose id is the report/result id, so an execution can point straight at
 * them. Electron-free.
 */
import { randomUUID } from 'node:crypto';
import type { Artifact, ArtifactKind, RunResult, SandboxReport } from '@neuropause/shared';
import { PersistentStore } from './persistentStore';

interface ArtifactFile {
  artifacts: Artifact[];
}

export interface ArtifactAddInput {
  executionId: string;
  workspaceId: string;
  kind: ArtifactKind;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageRef?: string | null;
  inline?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  /** Reuse a caller-owned id (results/reports pin their id here). */
  id?: string;
}

const MAX_ARTIFACTS = 10_000;

export class SandboxArtifactStore extends PersistentStore<ArtifactFile> {
  private artifacts = new Map<string, Artifact>();

  constructor(filePath: string, private readonly now: () => number = Date.now) {
    super(filePath, 'sandbox-artifacts');
  }

  protected snapshot(): ArtifactFile {
    return { artifacts: [...this.artifacts.values()] };
  }
  protected hydrate(data: Partial<ArtifactFile>): void {
    for (const a of data.artifacts ?? []) if (a?.id) this.artifacts.set(a.id, a);
  }

  add(input: ArtifactAddInput): Artifact {
    const inline = input.inline ?? null;
    const artifact: Artifact = {
      id: input.id ?? `sba_${randomUUID()}`,
      /**
       * P13C N3 — owner from the running context.
       *
       * Artifacts are written from inside the engine, which runs each execution
       * under that execution's own principal, so `requireTenant()` here resolves
       * the ENQUEUING tenant rather than whoever is on screen when the run
       * happens to finish. `inline` carries the full result and report JSON,
       * which makes this the most content-bearing row in the subsystem.
       */
      tenantId: this.requireTenant(),
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      name: input.name,
      mimeType: input.mimeType ?? guessMime(input.kind),
      sizeBytes: input.sizeBytes ?? (inline ? Buffer.byteLength(inline) : 0),
      storageRef: input.storageRef ?? null,
      inline,
      createdAt: new Date(this.now()).toISOString(),
      metadata: input.metadata ?? {},
    };
    this.artifacts.set(artifact.id, artifact);
    this.prune();
    this.changed();
    return artifact;
  }

  /** Store a run result as a first-class `result` artifact (id = result.id). */
  addResult(workspaceId: string, result: RunResult): Artifact {
    const inline = JSON.stringify(result);
    return this.add({
      id: result.id,
      executionId: result.executionId,
      workspaceId,
      kind: 'result',
      name: 'result.json',
      mimeType: 'application/json',
      inline,
      metadata: { outcome: result.outcome },
    });
  }

  /** Store a generated report as a first-class `report` artifact (id = report.id). */
  addReport(report: SandboxReport): Artifact {
    return this.add({
      id: report.id,
      executionId: report.executionId,
      workspaceId: report.workspaceId,
      kind: 'report',
      name: 'report.json',
      mimeType: 'application/json',
      inline: JSON.stringify(report),
      metadata: { status: report.status },
    });
  }

  /**
   * The artifact, IF it is the caller's.
   *
   * P13C N3 — THE SHARPEST READ IN THE SUBSYSTEM. An artifact id alone returned
   * the record including `inline`, which carries the complete result and report
   * JSON of a run — assertions, metrics, summaries, every logged step. No
   * workspace check, no execution check, just the id.
   */
  get(id: string): Artifact | null {
    const a = this.artifacts.get(id) ?? null;
    return a !== null && this.mine(a) ? a : null;
  }
  all(): Artifact[] {
    return this.onlyMine([...this.artifacts.values()]);
  }
  count(): number {
    return this.all().length;
  }

  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.countOwnership([...this.artifacts.values()]);
  }

  /**
   * An execution's artifacts. Scoped on the ARTIFACTS, not the execution id.
   *
   * Filtering on `executionId` alone was a capability check on a uuid: knowing
   * the id was the whole authorization. The tenant filter runs first, so a
   * foreign execution id now matches nothing rather than returning its files.
   */
  list(executionId: string, kind?: ArtifactKind): Artifact[] {
    return this.onlyMine([...this.artifacts.values()])
      .filter((a) => a.executionId === executionId && (kind ? a.kind === kind : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  /* ── typed facets ── */
  screenshots(executionId: string): Artifact[] {
    return this.list(executionId, 'screenshot');
  }
  videos(executionId: string): Artifact[] {
    return this.list(executionId, 'video');
  }
  logs(executionId: string): Artifact[] {
    return this.list(executionId, 'log');
  }
  traces(executionId: string): Artifact[] {
    return this.list(executionId, 'trace');
  }
  reports(executionId: string): SandboxReport[] {
    return this.list(executionId, 'report').map((a) => parseInline<SandboxReport>(a)).filter((r): r is SandboxReport => r !== null);
  }
  results(executionId: string): RunResult[] {
    return this.list(executionId, 'result').map((a) => parseInline<RunResult>(a)).filter((r): r is RunResult => r !== null);
  }
  getReport(executionId: string): SandboxReport | null {
    const list = this.reports(executionId);
    return list[list.length - 1] ?? null;
  }
  getResult(executionId: string): RunResult | null {
    const list = this.results(executionId);
    return list[list.length - 1] ?? null;
  }

  private prune(): void {
    if (this.artifacts.size <= MAX_ARTIFACTS) return;
    const ordered = [...this.artifacts.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    let over = this.artifacts.size - MAX_ARTIFACTS;
    for (const a of ordered) {
      if (over <= 0) break;
      this.artifacts.delete(a.id);
      over -= 1;
    }
  }
}

function parseInline<T>(a: Artifact): T | null {
  if (!a.inline) return null;
  try {
    return JSON.parse(a.inline) as T;
  } catch {
    return null;
  }
}

function guessMime(kind: ArtifactKind): string {
  switch (kind) {
    case 'screenshot':
      return 'image/png';
    case 'video':
      return 'video/webm';
    case 'log':
      return 'text/plain';
    case 'report':
    case 'result':
      return 'application/json';
    case 'trace':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}
