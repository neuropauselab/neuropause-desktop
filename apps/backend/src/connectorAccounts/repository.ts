/** Postgres ConnectorAccountRepository. Exercised by the integration suite. */
import { query } from '../db/pool';
import type {
  ConnectorAccount,
  ConnectorStatus,
  ConnectorAccountRepository,
  RecordConnectorInput,
} from './types';

interface Row {
  id: string;
  org_id: string;
  user_id: string;
  provider: string;
  external_account_id: string | null;
  display_name: string | null;
  status: ConnectorStatus;
  created_at: Date;
  updated_at: Date;
}
const COLS =
  'id, org_id, user_id, provider, external_account_id, display_name, status, created_at, updated_at';

const toAccount = (r: Row): ConnectorAccount => ({
  id: r.id,
  orgId: r.org_id,
  userId: r.user_id,
  provider: r.provider,
  externalAccountId: r.external_account_id,
  displayName: r.display_name,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export function createPgConnectorAccountRepository(): ConnectorAccountRepository {
  return {
    async upsert(input: RecordConnectorInput) {
      const { rows } = await query<Row>(
        `INSERT INTO connector_accounts (org_id, user_id, provider, external_account_id, display_name, status)
         VALUES ($1, $2, $3, $4, $5, 'connected')
         ON CONFLICT (org_id, user_id, provider)
         DO UPDATE SET external_account_id = COALESCE(EXCLUDED.external_account_id, connector_accounts.external_account_id),
                       display_name = COALESCE(EXCLUDED.display_name, connector_accounts.display_name),
                       status = 'connected'
         RETURNING ${COLS}`,
        [
          input.orgId,
          input.userId,
          input.provider,
          input.externalAccountId ?? null,
          input.displayName ?? null,
        ],
      );
      return toAccount(rows[0]!);
    },
    async getById(id) {
      const { rows } = await query<Row>(`SELECT ${COLS} FROM connector_accounts WHERE id = $1`, [
        id,
      ]);
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async listByOrg(orgId) {
      const { rows } = await query<Row>(
        `SELECT ${COLS} FROM connector_accounts WHERE org_id = $1 ORDER BY created_at ASC`,
        [orgId],
      );
      return rows.map(toAccount);
    },
    async listByUser(orgId, userId) {
      const { rows } = await query<Row>(
        `SELECT ${COLS} FROM connector_accounts WHERE org_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
        [orgId, userId],
      );
      return rows.map(toAccount);
    },
    async setStatus(id, status: ConnectorStatus) {
      const { rows } = await query<Row>(
        `UPDATE connector_accounts SET status = $2 WHERE id = $1 RETURNING ${COLS}`,
        [id, status],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async remove(id) {
      const { rowCount } = await query('DELETE FROM connector_accounts WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
