/**
 * Module 10 — Event Streaming Platform. Subscriptions, partitions, and replay over the ONE
 * runtime event bus. It buffers recent events (for partition-scoped tailing) and delegates
 * durable replay to the runtime. No second event system — it's a streaming view of the one bus.
 */
import type { CloudEvent, EventHandler } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';

const BUFFER_CAP = 2000;

export class EventStreamingPlatform {
  private readonly buffer: CloudEvent[] = [];

  constructor(private readonly runtime: EnterpriseRuntime) {
    this.runtime.events().subscribe(
      () => true,
      (e) => {
        this.buffer.push(e);
        if (this.buffer.length > BUFFER_CAP) this.buffer.shift();
      },
    );
  }

  /** Subscribe to events by type prefix, optionally scoped to a partition (tenant). */
  subscribe(pattern: string, handler: EventHandler, opts: { partition?: string } = {}): () => void {
    return this.runtime.events().subscribe(
      (e) => (e.type === pattern || e.type.startsWith(pattern)) && (opts.partition === undefined || e.partitionKey === opts.partition),
      handler,
    );
  }

  recent(opts: { topic?: string; partition?: string; limit?: number } = {}): CloudEvent[] {
    let evs = this.buffer;
    if (opts.topic) evs = evs.filter((e) => e.topic === opts.topic);
    if (opts.partition) evs = evs.filter((e) => e.partitionKey === opts.partition);
    return evs.slice(-(opts.limit ?? 50));
  }

  replayFrom(fromSeq: number, handler: EventHandler): Promise<number> {
    return this.runtime.events().replay(fromSeq, handler);
  }

  partitions(): string[] {
    return [...new Set(this.buffer.map((e) => e.partitionKey))];
  }
}
