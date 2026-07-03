/**
 * Telemetry — strictly opt-in and disabled by default. When enabled, anonymous
 * usage events are appended to a local JSONL file. Nothing leaves the device
 * (there is no telemetry endpoint); this is the on-device event layer that a
 * future, consented uploader could read.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('telemetry');

interface Settings {
  enabled: boolean;
}

class Telemetry {
  readonly name = 'telemetry';
  private enabled = false;

  private settingsPath(): string {
    return join(app.getPath('userData'), 'telemetry.json');
  }

  start(): void {
    void this.loadSettings();
  }
  stop(): void {
    /* nothing to tear down */
  }

  private async loadSettings(): Promise<void> {
    try {
      const s = JSON.parse(await fs.readFile(this.settingsPath(), 'utf8')) as Settings;
      this.enabled = !!s.enabled;
    } catch {
      this.enabled = false; // default off
    }
    log.info('Telemetry initialized', { enabled: this.enabled });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await fs.writeFile(this.settingsPath(), JSON.stringify({ enabled }), { mode: 0o600 });
  }

  track(event: string, props: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, props })}\n`;
    const path = join(app.getPath('userData'), 'telemetry.log');
    void fs.appendFile(path, line).catch(() => undefined);
  }
}

export const telemetry = new Telemetry();
