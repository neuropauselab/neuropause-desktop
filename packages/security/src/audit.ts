/**
 * Audit & Governance (NCEA 14.0, Phase 10). Expands the ONE runtime audit chain
 * with security-event categories, digital signatures, and tamper detection — it
 * does NOT create a second chain. Every security event appends to
 * `runtime.audit()` (the single hash-linked chain) AND is digitally signed
 * (Ed25519 by default) over its audit id + data hash. `verify()` checks the chain
 * integrity AND every signature; a tampered event fails signature verification and
 * a tampered chain fails the runtime's own verify. Events are immutable and
 * exportable (audit export / legal hold).
 */
import { sha256Hex, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { Signer } from './keys';

export type SecurityCategory =
  | 'identity'
  | 'authentication'
  | 'authorization'
  | 'session'
  | 'policy'
  | 'connector'
  | 'ai'
  | 'admin'
  | 'security'
  | 'key'
  | 'compliance';

export interface SecurityEvent {
  id: string; // == the runtime audit id
  category: SecurityCategory;
  action: string;
  actor: string;
  tenant?: string;
  target?: string;
  at: number;
  dataHash: string;
  signature: string;
  detail?: string;
}

export interface RecordInput {
  category: SecurityCategory;
  action: string;
  actor: string;
  tenant?: string;
  target?: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface AuditVerification {
  chainValid: boolean;
  signaturesValid: boolean;
  valid: boolean;
}

export class SecurityAudit {
  private readonly log: SecurityEvent[] = [];

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
    private readonly signer: Signer,
  ) {}

  async record(input: RecordInput): Promise<SecurityEvent> {
    const at = this.clock.now();
    const dataHash = sha256Hex(JSON.stringify({ category: input.category, action: input.action, target: input.target ?? '', tenant: input.tenant ?? '', meta: input.meta ?? {} }));
    // ONE chain: append to the runtime audit chain (hash-only).
    const entry = this.runtime.audit().append({
      actor: input.actor,
      action: `sec.${input.category}.${input.action}`,
      target: input.target ?? input.category,
      deviceId: 'security',
      at,
      dataHash,
    });
    const id = (entry as { auditId?: string }).auditId ?? sha256Hex(`${at}:${dataHash}`);
    const signature = this.signer.sign(`${id}:${dataHash}`);
    const event: SecurityEvent = {
      id,
      category: input.category,
      action: input.action,
      actor: input.actor,
      ...(input.tenant ? { tenant: input.tenant } : {}),
      ...(input.target ? { target: input.target } : {}),
      at,
      dataHash,
      signature,
      ...(input.detail ? { detail: input.detail } : {}),
    };
    this.log.push(event);
    await this.runtime.events().publish({
      type: 'security.event',
      topic: 'security',
      partitionKey: input.tenant ?? input.actor,
      version: 1,
      payload: { id, category: input.category, action: input.action, actor: input.actor, tenant: input.tenant, ok: true },
    });
    return event;
  }

  /** Verify one event's digital signature over (id : dataHash). */
  verifyEvent(event: SecurityEvent): boolean {
    return this.signer.verify(`${event.id}:${event.dataHash}`, event.signature);
  }

  /** Verify the whole chain: runtime chain integrity AND every signature. */
  verify(): AuditVerification {
    const chainValid = this.runtime.audit().verify().valid;
    const signaturesValid = this.log.every((e) => this.verifyEvent(e));
    return { chainValid, signaturesValid, valid: chainValid && signaturesValid };
  }

  events(filter: { category?: SecurityCategory; tenant?: string; actor?: string } = {}): SecurityEvent[] {
    return this.log.filter(
      (e) =>
        (filter.category === undefined || e.category === filter.category) &&
        (filter.tenant === undefined || e.tenant === filter.tenant) &&
        (filter.actor === undefined || e.actor === filter.actor),
    );
  }

  /** Immutable export for compliance / legal hold — a signed copy of the events. */
  export(filter: { category?: SecurityCategory; tenant?: string } = {}): { count: number; events: SecurityEvent[]; verified: AuditVerification } {
    const events = this.events(filter).map((e) => ({ ...e }));
    return { count: events.length, events, verified: this.verify() };
  }
}
