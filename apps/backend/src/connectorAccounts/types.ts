/**
 * Connector accounts — cloud-side records of a user's connected SaaS accounts.
 * Metadata only (provider, external account id, display name, health); no OAuth
 * tokens. One record per (org, user, provider); reconnecting upserts it.
 */
export type ConnectorStatus = 'connected' | 'revoked' | 'error';

export interface ConnectorAccount {
  id: string;
  orgId: string;
  userId: string;
  /** Desktop connector id, e.g. 'github' | 'notion' | 'slack' | 'google-calendar'. */
  provider: string;
  externalAccountId: string | null;
  displayName: string | null;
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RecordConnectorInput {
  orgId: string;
  userId: string;
  provider: string;
  externalAccountId?: string | null;
  displayName?: string | null;
}

export interface ConnectorAccountRepository {
  /** Insert or, if one already exists for (org, user, provider), update it. */
  upsert(input: RecordConnectorInput): Promise<ConnectorAccount>;
  getById(id: string): Promise<ConnectorAccount | null>;
  listByOrg(orgId: string): Promise<ConnectorAccount[]>;
  listByUser(orgId: string, userId: string): Promise<ConnectorAccount[]>;
  setStatus(id: string, status: ConnectorStatus): Promise<ConnectorAccount | null>;
  remove(id: string): Promise<boolean>;
}
