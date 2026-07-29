/**
 * Trigger Engine (NCEA 10.4, Phase 5). Trigger kinds — webhook / polling /
 * schedule / event / manual / ai / approval / dependency — that fire automations.
 * Event triggers subscribe to the SINGLE event bus; schedule/polling triggers
 * register on the SINGLE runtime scheduler; the rest fire explicitly. No duplicate
 * scheduling or eventing infrastructure.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { TriggerKind } from './sdk';

export interface TriggerRegistration {
  id: string;
  kind: TriggerKind;
  /** automation id to run when the trigger fires. */
  automation: string;
  intervalMs?: number;
  eventPattern?: string;
  dependsOn?: string;
  enabled: boolean;
}

export type TriggerHandler = (trigger: TriggerRegistration, payload: unknown) => Promise<void> | void;

export class TriggerEngine {
  private readonly triggers = new Map<string, TriggerRegistration>();
  private handler?: TriggerHandler;

  constructor(private readonly runtime: EnterpriseRuntime) {}

  onFire(handler: TriggerHandler): void {
    this.handler = handler;
  }

  register(input: Omit<TriggerRegistration, 'enabled'> & { enabled?: boolean }): TriggerRegistration {
    const trigger: TriggerRegistration = { enabled: input.enabled ?? true, ...input };
    this.triggers.set(trigger.id, trigger);

    if (trigger.kind === 'event' && trigger.eventPattern) {
      this.runtime.events().subscribe(trigger.eventPattern, async (event) => {
        if (trigger.enabled) await this.fire(trigger.id, event);
      });
    }
    if ((trigger.kind === 'schedule' || trigger.kind === 'polling') && trigger.intervalMs) {
      this.runtime.scheduler().register({
        name: `trigger:${trigger.id}`,
        intervalMs: trigger.intervalMs,
        handler: async () => {
          if (trigger.enabled) await this.fire(trigger.id, { scheduled: true });
        },
      });
    }
    return trigger;
  }

  get(id: string): TriggerRegistration | undefined {
    return this.triggers.get(id);
  }
  list(): TriggerRegistration[] {
    return [...this.triggers.values()];
  }
  enable(id: string): void {
    const t = this.triggers.get(id);
    if (t) t.enabled = true;
  }
  disable(id: string): void {
    const t = this.triggers.get(id);
    if (t) t.enabled = false;
  }

  /** Fire a trigger explicitly (manual / webhook / ai / approval / dependency). */
  async fire(id: string, payload: unknown): Promise<void> {
    const trigger = this.triggers.get(id);
    if (!trigger || !trigger.enabled) return;
    await this.handler?.(trigger, payload);
  }
}
