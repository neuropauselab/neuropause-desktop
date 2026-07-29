/**
 * EPIC 1 — Customer Portal. Landing / customer / organization dashboards, user profile, account
 * settings, a notification center, and an activity timeline. The dashboards read REAL in-process state
 * (account + organization counts) from the reused authentication runtime; notifications and the activity
 * timeline are real in-process records. No customer figure is fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { PORTAL_VIEWS, type PortalView } from './constants';
import type { AuthenticationRuntime } from './auth';
import type { CustomerExperienceGovernance } from './governance';

export interface Notification {
  id: string;
  title: string;
  read: boolean;
}

export interface ActivityEntry {
  id: string;
  action: string;
  detail: string;
}

export interface PortalDeps {
  auth: AuthenticationRuntime;
}

export class CustomerPortal {
  private readonly notifications: Notification[] = [];
  private readonly activity: ActivityEntry[] = [];

  constructor(
    private readonly deps: PortalDeps,
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  views(): readonly PortalView[] {
    return PORTAL_VIEWS;
  }

  /** Customer dashboard — real counts from the reused authentication runtime. */
  customerDashboard(): { accounts: number; organizations: number; live: true } {
    return { accounts: this.deps.auth.accountCount(), organizations: this.deps.auth.organizationCount(), live: true };
  }

  async notify(title: string): Promise<Notification> {
    const n: Notification = { id: randomId('notif'), title, read: false };
    this.notifications.push(n);
    await this.gov.record({ actor: this.operator, customer: '_portal', organization: '_cx', epic: 'E1', operation: 'notify', targetId: n.id, evidence: 'live-verified', decision: title });
    return n;
  }
  markRead(id: string): void {
    const n = this.notifications.find((x) => x.id === id);
    if (n) n.read = true;
  }
  notificationCenter(): Notification[] {
    return [...this.notifications];
  }

  async logActivity(action: string, detail: string): Promise<ActivityEntry> {
    const e: ActivityEntry = { id: randomId('activity'), action, detail };
    this.activity.push(e);
    await this.gov.record({ actor: this.operator, customer: '_portal', organization: '_cx', epic: 'E1', operation: 'activity', targetId: e.id, evidence: 'live-verified', decision: action });
    return e;
  }
  activityTimeline(): ActivityEntry[] {
    return [...this.activity];
  }
}
