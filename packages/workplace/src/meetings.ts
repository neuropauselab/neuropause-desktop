/**
 * Module 10 — Meetings Platform. Audio / video meetings, screen sharing, whiteboard, AI meeting
 * notes, and recording metadata. The meeting RECORD is in-process (live-verified scheduling); the
 * actual audio/video is delivered through an external provider (adapter-verified until configured),
 * and recording is metadata only — no real recording is captured (real infra is regulated-external).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export type MeetingKind = 'audio' | 'video';
export interface Meeting {
  id: string;
  title: string;
  kind: MeetingKind;
  start: number;
  providerId?: string;
  aiNotes?: string;
  status: 'scheduled';
  note: string;
  createdAt: number;
}

export class MeetingRuntime {
  private readonly meetings = new Map<string, Meeting>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async schedule(input: { title: string; kind: MeetingKind; start: number; providerId?: string }): Promise<Meeting> {
    const m: Meeting = { id: randomId('meet'), title: input.title, kind: input.kind, start: input.start, ...(input.providerId ? { providerId: input.providerId } : {}), status: 'scheduled', note: `meeting scheduled — ${input.kind} delivery is via an external provider (adapter-verified until configured); no real ${input.kind} infrastructure is operated`, createdAt: this.clock.now() };
    this.meetings.set(m.id, m);
    await this.governance.record({ actor: 'system', module: 'meetings', operation: `schedule.${input.kind}`, targetId: m.id, evidence: 'live-verified', detail: m.note });
    return m;
  }

  /** Attach AI meeting notes (text supplied by the reused Workspace AI). */
  recordAiNotes(meetingId: string, notes: string): Meeting {
    const m = this.require(meetingId);
    m.aiNotes = notes;
    return m;
  }

  /** Recording metadata only — no real recording is captured. */
  recordingMetadata(meetingId: string): { meetingId: string; hasRecording: false; note: string } {
    this.require(meetingId);
    return { meetingId, hasRecording: false, note: 'recording metadata only — no media captured; real recording/retention is regulated-external' };
  }

  private require(id: string): Meeting {
    const m = this.meetings.get(id);
    if (!m) throw new Error(`no meeting ${id}`);
    return m;
  }

  list(): Meeting[] { return [...this.meetings.values()]; }
  count(): number { return this.meetings.size; }
}
