/** In-memory ConnectorAccountRepository for unit tests. */
import { randomUUID } from 'node:crypto';
import type {
  ConnectorAccount,
  ConnectorStatus,
  ConnectorAccountRepository,
  RecordConnectorInput,
} from './types';

export function createMemoryConnectorAccountRepository(): ConnectorAccountRepository {
  const byId = new Map<string, ConnectorAccount>();
  const now = (): string => new Date().toISOString();
  const key = (orgId: string, userId: string, provider: string): string =>
    `${orgId}::${userId}::${provider}`;
  const find = (orgId: string, userId: string, provider: string): ConnectorAccount | undefined =>
    [...byId.values()].find(
      (a) => key(a.orgId, a.userId, a.provider) === key(orgId, userId, provider),
    );

  return {
    async upsert(input: RecordConnectorInput) {
      const existing = find(input.orgId, input.userId, input.provider);
      if (existing) {
        const next: ConnectorAccount = {
          ...existing,
          externalAccountId: input.externalAccountId ?? existing.externalAccountId,
          displayName: input.displayName ?? existing.displayName,
          status: 'connected',
          updatedAt: now(),
        };
        byId.set(existing.id, next);
        return next;
      }
      const created: ConnectorAccount = {
        id: randomUUID(),
        orgId: input.orgId,
        userId: input.userId,
        provider: input.provider,
        externalAccountId: input.externalAccountId ?? null,
        displayName: input.displayName ?? null,
        status: 'connected',
        createdAt: now(),
        updatedAt: now(),
      };
      byId.set(created.id, created);
      return created;
    },
    async getById(id) {
      return byId.get(id) ?? null;
    },
    async listByOrg(orgId) {
      return [...byId.values()]
        .filter((a) => a.orgId === orgId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async listByUser(orgId, userId) {
      return [...byId.values()]
        .filter((a) => a.orgId === orgId && a.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async setStatus(id, status: ConnectorStatus) {
      const existing = byId.get(id);
      if (!existing) return null;
      const next = { ...existing, status, updatedAt: now() };
      byId.set(id, next);
      return next;
    },
    async remove(id) {
      return byId.delete(id);
    },
  };
}
