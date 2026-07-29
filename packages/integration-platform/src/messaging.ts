/**
 * EPIC 9 — Messaging Platform. Kafka / RabbitMQ / NATS / MQTT / Redis Streams brokers (adapter-
 * verified until configured) plus a REAL in-process event bus: publish, consume, retry, a
 * dead-letter queue, and replay all execute in-process. The broker CONNECTIONS are represented; the
 * pub/sub/retry/DLQ/replay LOGIC is live-verified.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { IntegrationGovernance } from './governance';
import { BROKER_KINDS, type BrokerKind } from './constants';

export interface Message { id: string; topic: string; payload: unknown; at: number }
export interface BrokerAdapter { id: string; kind: BrokerKind; configured: boolean }

export class MessagingPlatform {
  private readonly brokers = new Map<string, BrokerAdapter>();
  private readonly topics = new Map<string, Message[]>();
  private readonly published = new Map<string, Message[]>(); // history for replay
  private readonly dlq: Message[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: IntegrationGovernance,
  ) {}

  async registerBroker(kind: BrokerKind, org?: string): Promise<BrokerAdapter> {
    if (!BROKER_KINDS.includes(kind)) throw new Error(`unknown broker: ${kind}`);
    const b: BrokerAdapter = { id: randomId('broker'), kind, configured: false };
    this.brokers.set(b.id, b);
    await this.governance.record({ operator: 'system', org: org ?? '_platform', integration: '_messaging', connector: kind, epic: 'E9', operation: `messaging.broker.${kind}`, targetId: b.id, evidence: 'adapter-verified' });
    return b;
  }

  /** REAL publish into the in-process bus (+ history for replay). */
  publish(topic: string, payload: unknown): Message {
    const msg: Message = { id: randomId('msg'), topic, payload, at: this.clock.now() };
    (this.topics.get(topic) ?? this.topics.set(topic, []).get(topic)!).push(msg);
    (this.published.get(topic) ?? this.published.set(topic, []).get(topic)!).push(msg);
    return msg;
  }

  /** REAL consume — drains and returns the topic's pending messages. */
  consume(topic: string): Message[] {
    const msgs = this.topics.get(topic) ?? [];
    this.topics.set(topic, []);
    return msgs;
  }

  /** REAL retry: run a handler per message, retrying on failure; exhausted messages go to the DLQ. */
  async processWithRetry(topic: string, handler: (m: Message) => void | Promise<void>, maxAttempts = 3): Promise<{ processed: number; deadLettered: number }> {
    const msgs = this.consume(topic);
    let processed = 0;
    let deadLettered = 0;
    for (const msg of msgs) {
      let ok = false;
      for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
        try { await handler(msg); ok = true; } catch { /* retry */ }
      }
      if (ok) processed += 1;
      else { this.dlq.push(msg); deadLettered += 1; }
    }
    return { processed, deadLettered };
  }

  /** REAL replay — re-publish a topic's full history back onto the live topic. */
  replay(topic: string): number {
    const hist = this.published.get(topic) ?? [];
    for (const m of hist) (this.topics.get(topic) ?? this.topics.set(topic, []).get(topic)!).push(m);
    return hist.length;
  }

  pending(topic: string): number { return (this.topics.get(topic) ?? []).length; }
  deadLetters(): Message[] { return [...this.dlq]; }
  brokerList(): BrokerAdapter[] { return [...this.brokers.values()]; }
  count(): number { return this.brokers.size; }
}
