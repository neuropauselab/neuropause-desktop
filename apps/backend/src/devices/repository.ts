/**
 * Postgres DeviceRepository — production implementation, using the shared `query`
 * helper (same style as organizations/repository.ts). Exercised by the integration
 * suite (requires a real Postgres).
 */
import type { Device, DeviceRepository, DeviceTrustStatus, RegisterDeviceInput } from './types';
import { query } from '../db/pool';

interface DeviceRow {
  org_id: string;
  device_id: string;
  user_id: string;
  name: string;
  platform: string;
  os: string;
  arch: string;
  app_version: string;
  trust_status: DeviceTrustStatus;
  last_seen: Date;
  registered_at: Date;
}

const COLS =
  'org_id, device_id, user_id, name, platform, os, arch, app_version, trust_status, last_seen, registered_at';

function mapRow(r: DeviceRow): Device {
  return {
    orgId: r.org_id,
    deviceId: r.device_id,
    userId: r.user_id,
    name: r.name,
    platform: r.platform,
    os: r.os,
    arch: r.arch,
    appVersion: r.app_version,
    trustStatus: r.trust_status,
    lastSeen: r.last_seen.toISOString(),
    registeredAt: r.registered_at.toISOString(),
  };
}

export function createPgDeviceRepository(): DeviceRepository {
  return {
    async upsert(input: RegisterDeviceInput): Promise<Device> {
      // Re-registration updates identity + lastSeen but preserves the original
      // registered_at and trust_status (ON CONFLICT keeps the existing values).
      const { rows } = await query<DeviceRow>(
        `INSERT INTO devices (${COLS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'trusted', now(), now())
         ON CONFLICT (org_id, device_id) DO UPDATE SET
           name = EXCLUDED.name,
           platform = EXCLUDED.platform,
           os = EXCLUDED.os,
           arch = EXCLUDED.arch,
           app_version = EXCLUDED.app_version,
           last_seen = now()
         RETURNING ${COLS}`,
        [
          input.orgId,
          input.deviceId,
          input.userId,
          input.name,
          input.platform,
          input.os,
          input.arch,
          input.appVersion,
        ],
      );
      return mapRow(rows[0]);
    },

    async listByOrg(orgId: string): Promise<Device[]> {
      const { rows } = await query<DeviceRow>(
        `SELECT ${COLS} FROM devices WHERE org_id = $1 ORDER BY last_seen DESC`,
        [orgId],
      );
      return rows.map(mapRow);
    },

    async get(orgId: string, deviceId: string): Promise<Device | null> {
      const { rows } = await query<DeviceRow>(
        `SELECT ${COLS} FROM devices WHERE org_id = $1 AND device_id = $2`,
        [orgId, deviceId],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async touch(
      orgId: string,
      deviceId: string,
      appVersion: string,
      lastSeen: string,
    ): Promise<Device | null> {
      const { rows } = await query<DeviceRow>(
        `UPDATE devices SET app_version = $3, last_seen = $4
         WHERE org_id = $1 AND device_id = $2 RETURNING ${COLS}`,
        [orgId, deviceId, appVersion, lastSeen],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async setTrust(
      orgId: string,
      deviceId: string,
      status: DeviceTrustStatus,
    ): Promise<Device | null> {
      const { rows } = await query<DeviceRow>(
        `UPDATE devices SET trust_status = $3
         WHERE org_id = $1 AND device_id = $2 RETURNING ${COLS}`,
        [orgId, deviceId, status],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async remove(orgId: string, deviceId: string): Promise<void> {
      await query(`DELETE FROM devices WHERE org_id = $1 AND device_id = $2`, [orgId, deviceId]);
    },
  };
}
