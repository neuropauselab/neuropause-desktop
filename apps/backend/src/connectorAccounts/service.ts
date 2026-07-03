/**
 * Connector account service — recording, listing, and revoking cloud-side
 * connector records. Pure logic over the repository; stores no credentials.
 */
import type { ConnectorAccount, ConnectorAccountRepository, RecordConnectorInput } from './types';

export class ConnectorAccountError extends Error {
  constructor(
    public readonly code: 'invalid' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorAccountError';
  }
}

/** Record (or refresh) a connected account for a user. Never stores tokens. */
export async function recordConnectorAccount(
  repo: ConnectorAccountRepository,
  input: RecordConnectorInput,
): Promise<ConnectorAccount> {
  const provider = input.provider.trim().toLowerCase();
  if (!provider) throw new ConnectorAccountError('invalid', 'A connector provider is required.');
  return repo.upsert({ ...input, provider });
}

export async function listOrgConnectorAccounts(
  repo: ConnectorAccountRepository,
  orgId: string,
): Promise<ConnectorAccount[]> {
  return repo.listByOrg(orgId);
}

export async function listUserConnectorAccounts(
  repo: ConnectorAccountRepository,
  orgId: string,
  userId: string,
): Promise<ConnectorAccount[]> {
  return repo.listByUser(orgId, userId);
}

/** Mark a connector account revoked (e.g. the user disconnected it). */
export async function revokeConnectorAccount(
  repo: ConnectorAccountRepository,
  id: string,
): Promise<ConnectorAccount> {
  const updated = await repo.setStatus(id, 'revoked');
  if (!updated) throw new ConnectorAccountError('not_found', 'Connector account not found.');
  return updated;
}
