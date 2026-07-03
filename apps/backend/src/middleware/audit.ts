import type { Request } from 'express';
import { query } from '../db/pool';
import { logger } from '../config/logger';

/**
 * Writes a row to the append-only audit_log. Audit writes must never break the
 * request they describe, so failures are logged and swallowed.
 */
export async function audit(
  req: Request | null,
  action: string,
  detail: Record<string, unknown> = {},
  userId: string | null = null,
): Promise<void> {
  try {
    const ip = req?.ip ?? null;
    await query('INSERT INTO audit_log (user_id, action, detail, ip) VALUES ($1, $2, $3, $4)', [
      userId,
      action,
      JSON.stringify(detail),
      ip,
    ]);
  } catch (err) {
    logger.warn({ err, action }, 'Failed to write audit log entry');
  }
}
