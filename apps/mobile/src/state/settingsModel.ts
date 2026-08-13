/**
 * Settings view-model (Mobile M1-13) — PURE builders for the Settings sheet, so
 * the display rows unit-test in plain Node. Values come from the pinned session
 * (provider.session) plus the desktop's session.hello response.
 */
import type { CompanionSession } from '../lib/sealedClient';

/** The desktop's session.hello response shape. */
export interface SessionHello {
  desktopName: string;
  orgName: string;
  user: string;
  deviceId: string;
  protocolVersion: number;
}

export interface SettingRow {
  label: string;
  value: string;
}

/** "host:port" for the paired desktop. */
export function formatEndpoint(session: Pick<CompanionSession, 'host' | 'port'>): string {
  return `${session.host}:${session.port}`;
}

/** The rows shown in Settings, in display order. hello enriches (user, protocol). */
export function settingsRows(
  session: CompanionSession,
  hello: SessionHello | null,
  appVersion: string,
): SettingRow[] {
  const rows: SettingRow[] = [
    { label: 'Desktop', value: hello?.desktopName || session.desktopName },
    { label: 'Organization', value: hello?.orgName || session.orgName },
  ];
  if (hello?.user) rows.push({ label: 'Signed in as', value: hello.user });
  rows.push({ label: 'This device', value: session.deviceId });
  rows.push({ label: 'Connection', value: formatEndpoint(session) });
  rows.push({ label: 'App version', value: appVersion });
  rows.push({ label: 'Protocol', value: hello ? `v${hello.protocolVersion}` : '—' });
  return rows;
}
