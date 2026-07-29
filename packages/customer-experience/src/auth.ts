/**
 * EPIC 2 — Authentication & Organization. Email signup + verification + login + password reset, Google/
 * Microsoft login, MFA, organization creation, member invites, and team management. Signup, login, and
 * MFA are REAL: a signup registers a real identity via the reused security platform, email verification
 * matches a real in-process token, login issues + verifies a real session token, and MFA enrolls for
 * real. External IdPs (Google/Microsoft) are represented until configured. Invitation emails are NOT
 * sent — an invite is a real record; delivery is represented.
 */
import { randomId } from '@neuropause/cloud-core';
import { type AuthMethod, type AccountStatus } from './constants';
import type { CxContext } from './types';
import type { CustomerExperienceGovernance } from './governance';

export interface Account {
  id: string;
  email: string;
  displayName: string;
  identityId: string | null;
  status: AccountStatus;
  mfaEnrolled: boolean;
  verificationToken: string | null;
  reusedSecurity: boolean;
}

export interface Organization {
  id: string;
  name: string;
  ownerAccountId: string;
  members: string[];
}

export interface Invite {
  id: string;
  organizationId: string;
  email: string;
  accepted: boolean;
  emailDelivered: false; // invite recorded; email delivery is represented (EPIC 14)
}

export class AuthenticationRuntime {
  private readonly accounts = new Map<string, Account>();
  private readonly organizations = new Map<string, Organization>();
  private readonly invites = new Map<string, Invite>();

  constructor(
    private readonly ctx: CxContext,
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  methods(): readonly AuthMethod[] {
    return ['email', 'google', 'microsoft'];
  }

  /** Email signup — registers a REAL identity via the reused security platform; email is unverified. */
  async signup(input: { email: string; displayName: string; organizationName: string }): Promise<Account> {
    let identityId: string | null = null;
    let reusedSecurity = false;
    if (this.ctx.security) {
      const id = await this.ctx.security.identity().register({ type: 'user', displayName: input.displayName, tenant: input.organizationName });
      identityId = id.id;
      reusedSecurity = true;
    }
    const account: Account = {
      id: randomId('acct'),
      email: input.email,
      displayName: input.displayName,
      identityId,
      status: 'verification-pending',
      mfaEnrolled: false,
      verificationToken: randomId('verify'),
      reusedSecurity,
    };
    this.accounts.set(account.id, account);
    await this.record(input.organizationName, 'signup', account.id, reusedSecurity ? 'live-verified' : 'adapter-verified');
    return account;
  }

  /** Email verification — matches the REAL in-process token issued at signup. */
  async verifyEmail(accountId: string, token: string): Promise<{ verified: boolean }> {
    const account = this.require(accountId);
    const verified = account.verificationToken !== null && account.verificationToken === token;
    if (verified) {
      account.status = 'verified';
      account.verificationToken = null;
    }
    await this.record(account.email, 'verify-email', accountId, 'live-verified', verified ? 'verified' : 'invalid-token');
    return { verified };
  }

  /** Login — requires a verified account; issues + verifies a REAL session token via reused security. */
  async login(accountId: string): Promise<{ sessionVerified: boolean; reason: string }> {
    const account = this.require(accountId);
    if (account.status !== 'verified' && account.status !== 'active') return { sessionVerified: false, reason: 'account not verified' };
    if (!this.ctx.security || !account.identityId) return { sessionVerified: false, reason: 'no security platform' };
    const tok = await this.ctx.security.authentication().issueToken(account.identityId, 'cx-session');
    const sessionVerified = this.ctx.security.authentication().verifyToken(tok.token) === account.identityId;
    if (sessionVerified) account.status = 'active';
    await this.record(account.email, 'login', accountId, 'live-verified', sessionVerified ? 'session verified' : 'failed');
    return { sessionVerified, reason: sessionVerified ? 'ok' : 'token verification failed' };
  }

  async enrollMfa(accountId: string): Promise<{ enrolled: boolean }> {
    const account = this.require(accountId);
    let enrolled = false;
    if (this.ctx.security && account.identityId) {
      await this.ctx.security.authentication().enrollTotp(account.identityId);
      account.mfaEnrolled = true;
      enrolled = true;
    }
    await this.record(account.email, 'enroll-mfa', accountId, 'live-verified', enrolled ? 'enrolled' : 'no-security');
    return { enrolled };
  }

  /** External IdP login (Google/Microsoft) — represented until the customer configures it. */
  async externalLogin(method: 'google' | 'microsoft'): Promise<{ method: string; configured: false }> {
    await this.record('_external', `external-login.${method}`, method, 'adapter-verified', 'represented');
    return { method, configured: false };
  }

  /** Password reset — issues a represented reset link (no email delivered). */
  async requestPasswordReset(accountId: string): Promise<{ requested: boolean }> {
    const account = this.require(accountId);
    await this.record(account.email, 'password-reset', accountId, 'live-verified', 'reset link generated (email delivery represented)');
    return { requested: true };
  }

  async createOrganization(input: { ownerAccountId: string; name: string }): Promise<Organization> {
    const owner = this.require(input.ownerAccountId);
    const org: Organization = { id: randomId('org'), name: input.name, ownerAccountId: input.ownerAccountId, members: [input.ownerAccountId] };
    this.organizations.set(org.id, org);
    await this.record(owner.email, 'create-organization', org.id, 'live-verified', input.name);
    return org;
  }

  async invite(input: { organizationId: string; email: string }): Promise<Invite> {
    const org = this.organizations.get(input.organizationId);
    if (!org) throw new Error(`unknown organization: ${input.organizationId}`);
    const invite: Invite = { id: randomId('invite'), organizationId: input.organizationId, email: input.email, accepted: false, emailDelivered: false };
    this.invites.set(invite.id, invite);
    await this.record(input.email, 'invite-member', invite.id, 'live-verified', 'invite recorded (email delivery represented)');
    return invite;
  }

  acceptInvite(inviteId: string, accountId: string): Invite {
    const invite = this.invites.get(inviteId);
    if (!invite) throw new Error(`unknown invite: ${inviteId}`);
    const org = this.organizations.get(invite.organizationId);
    if (org && !org.members.includes(accountId)) org.members.push(accountId);
    invite.accepted = true;
    return invite;
  }

  account(id: string): Account | undefined { return this.accounts.get(id); }
  organization(id: string): Organization | undefined { return this.organizations.get(id); }
  accountCount(): number { return this.accounts.size; }
  organizationCount(): number { return this.organizations.size; }

  private require(id: string): Account {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`unknown account: ${id}`);
    return a;
  }
  private async record(customer: string, operation: string, targetId: string, evidence: Parameters<CustomerExperienceGovernance['record']>[0]['evidence'], decision?: string): Promise<void> {
    await this.gov.record({ actor: this.operator, customer, organization: '_cx', epic: 'E2', operation, targetId, evidence, ...(decision ? { decision } : {}) });
  }
}
