/**
 * EPIC 5 — Production Release Management. Release scheduling, version promotion, rollback plans, and the
 * hotfix / patch / LTS registries, plus release notes. All state is real and in-process; promotion and
 * scheduling are recorded on the one chain.
 */
import { randomId } from '@neuropause/cloud-core';
import type { ReleaseChannel, PatchKind } from './constants';
import type { ReleaseGovernance } from './governance';

export interface ScheduleEntry {
  version: string;
  scheduledAt: number;
  channel: ReleaseChannel;
}

export interface PatchRecord {
  id: string;
  baseVersion: string;
  version: string;
  kind: PatchKind;
  summary: string;
}

export interface ReleaseNotes {
  version: string;
  highlights: string[];
  changes: string[];
  knownIssues: string[];
}

export class ReleaseManagement {
  private readonly schedules = new Map<string, ScheduleEntry>();
  private readonly patches = new Map<string, PatchRecord>();
  private readonly lts = new Set<string>();
  private readonly notes = new Map<string, ReleaseNotes>();

  constructor(
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  async schedule(input: { version: string; scheduledAt: number; channel?: ReleaseChannel }): Promise<ScheduleEntry> {
    const entry: ScheduleEntry = { version: input.version, scheduledAt: input.scheduledAt, channel: input.channel ?? 'stable' };
    this.schedules.set(input.version, entry);
    await this.record('schedule', input.version, `at ${input.scheduledAt}`);
    return entry;
  }

  async promote(input: { version: string; channel: ReleaseChannel }): Promise<{ version: string; channel: ReleaseChannel }> {
    await this.record('promote', input.version, input.channel);
    return { version: input.version, channel: input.channel };
  }

  rollbackPlan(version: string): { version: string; steps: string[] } {
    return { version, steps: ['freeze promotion', 'restore prior version pointer', 'invalidate artifacts', 'verify prior version health', 'notify customers'] };
  }

  async registerPatch(input: { baseVersion: string; version: string; kind: PatchKind; summary: string }): Promise<PatchRecord> {
    const patch: PatchRecord = { id: randomId('patch'), baseVersion: input.baseVersion, version: input.version, kind: input.kind, summary: input.summary };
    this.patches.set(patch.id, patch);
    await this.record('register-patch', input.version, input.kind);
    return patch;
  }

  async registerLts(version: string): Promise<{ version: string; lts: true }> {
    this.lts.add(version);
    await this.record('register-lts', version, 'lts');
    return { version, lts: true };
  }

  async releaseNotes(input: { version: string; highlights?: string[]; changes?: string[]; knownIssues?: string[] }): Promise<ReleaseNotes> {
    const notes: ReleaseNotes = { version: input.version, highlights: input.highlights ?? [], changes: input.changes ?? [], knownIssues: input.knownIssues ?? [] };
    this.notes.set(input.version, notes);
    await this.record('release-notes', input.version, `${notes.changes.length} changes`);
    return notes;
  }

  patchList(kind?: PatchKind): PatchRecord[] {
    const all = [...this.patches.values()];
    return kind ? all.filter((p) => p.kind === kind) : all;
  }
  ltsVersions(): string[] {
    return [...this.lts];
  }
  getNotes(version: string): ReleaseNotes | undefined {
    return this.notes.get(version);
  }
  getSchedule(version: string): ScheduleEntry | undefined {
    return this.schedules.get(version);
  }

  private async record(operation: string, version: string, decision: string): Promise<void> {
    await this.gov.record({ operator: this.operator, version, environment: '_release', customerScope: '_all', epic: 'E5', operation, targetId: version, evidence: 'live-verified', decision });
  }
}
