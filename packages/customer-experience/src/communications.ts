/**
 * EPIC 14 — Customer Communications. Welcome, password-reset, invitation, license, and release-
 * notification emails. Each message is COMPOSED for real (subject + body), but delivery is REPRESENTED:
 * no email is actually sent until an email provider is configured. `delivered` is hard-coded false, and
 * a test asserts it.
 */
import { randomId } from '@neuropause/cloud-core';
import { EMAIL_KINDS, type EmailKind } from './constants';
import type { CustomerExperienceGovernance } from './governance';

export interface EmailMessage {
  id: string;
  kind: EmailKind;
  to: string;
  subject: string;
  body: string;
  delivered: false; // composed only — delivery requires a configured email provider
}

const SUBJECT: Record<EmailKind, string> = {
  welcome: 'Welcome to NeuroPause',
  'password-reset': 'Reset your NeuroPause password',
  invitation: 'You have been invited to a NeuroPause organization',
  license: 'Your NeuroPause license',
  'release-notification': 'A new NeuroPause release is available',
};

export class CustomerCommunications {
  private readonly outbox: EmailMessage[] = [];

  constructor(
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  kinds(): readonly EmailKind[] {
    return EMAIL_KINDS;
  }

  /** Compose a message. It is queued in a represented outbox — NOT delivered. */
  async compose(input: { kind: EmailKind; to: string; body?: string }): Promise<EmailMessage> {
    if (!EMAIL_KINDS.includes(input.kind)) throw new Error(`unknown email kind: ${input.kind}`);
    const message: EmailMessage = {
      id: randomId('email'),
      kind: input.kind,
      to: input.to,
      subject: SUBJECT[input.kind],
      body: input.body ?? `${SUBJECT[input.kind]} — represented content; this email is not delivered until an email provider is configured.`,
      delivered: false,
    };
    this.outbox.push(message);
    await this.gov.record({ actor: this.operator, customer: input.to, organization: '_cx', epic: 'E14', operation: `compose.${input.kind}`, targetId: message.id, evidence: 'adapter-verified', decision: 'composed (delivery represented)' });
    return message;
  }

  /** Delivery is never confirmed here — a real email provider is required. */
  deliveryConfigured(): boolean {
    return false;
  }
  outboxList(kind?: EmailKind): EmailMessage[] {
    return kind ? this.outbox.filter((m) => m.kind === kind) : [...this.outbox];
  }
  deliveredCount(): number {
    return 0;
  }
}
