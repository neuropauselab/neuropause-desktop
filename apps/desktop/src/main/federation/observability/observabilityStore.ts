/**
 * The observability historical store: the source for historical reporting — a
 * rolling usage time series and the security event log. Seeded with two weeks of
 * daily points and a few representative security events; both can be appended at
 * runtime. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { SecurityEvent, SecuritySeverity, UsagePoint } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';

const log = createLogger('federation-observability');

interface ObsFile {
  usage: UsagePoint[];
  security: SecurityEvent[];
  seeded: boolean;
}

export class ObservabilityStore extends EventEmitter {
  private usage: UsagePoint[] = [];
  private security: SecurityEvent[] = [];

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<ObsFile>;
      this.usage = data.usage ?? [];
      this.security = data.security ?? [];
      if (!data.seeded || this.usage.length === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Observability history ready', { usagePoints: this.usage.length, security: this.security.length });
  }

  private applySeed(): void {
    // The 14-day usage curve and the named security events (Okta, Aperture Capital, …) below are fabricated
    // demo history. A production install starts with an empty usage series and security log and fills them from
    // real runtime activity, so gate the fixtures behind the demo-seed flag (persist the empty seeded state).
    if (!demoSeedsEnabled()) {
      this.schedulePersist();
      return;
    }
    const now = Date.now();
    const day = 86_400_000;
    for (let i = 13; i >= 0; i -= 1) {
      const at = new Date(now - i * day).toISOString();
      const base = 4000 + (13 - i) * 220;
      this.usage.push({
        at,
        apiRequests: base + ((i * 37) % 600),
        syncOps: 120 + ((i * 13) % 90),
        workerJobs: 30 + ((i * 7) % 24),
        events: 200 + ((i * 19) % 140),
      });
    }
    const sec = (daysAgo: number, category: string, severity: SecuritySeverity, source: string, detail: string): void => {
      this.security.push({ id: `sec_${randomUUID()}`, at: new Date(now - daysAgo * day).toISOString(), category, severity, source, detail });
    };
    sec(0.2, 'auth', 'info', 'identity', 'New SSO connection enabled (Okta).');
    sec(1, 'access', 'warning', 'federation', 'Delegated approval requested by Aperture Capital.');
    sec(2, 'integrity', 'info', 'exchange', 'Artifact signature verified before import.');
    sec(4, 'access', 'warning', 'governance', 'Cross-org run blocked pending approval.');
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: ObsFile = { usage: this.usage.slice(-90), security: this.security.slice(0, 200), seeded: true };
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Observability persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  usageSeries(): UsagePoint[] {
    return this.usage.slice(-30);
  }
  securityEvents(): SecurityEvent[] {
    return this.security.slice(0, 50);
  }

  recordSecurity(input: { category: string; severity: SecuritySeverity; source: string; detail: string }): SecurityEvent {
    const event: SecurityEvent = { id: `sec_${randomUUID()}`, at: new Date().toISOString(), ...input };
    this.security = [event, ...this.security].slice(0, 200);
    this.schedulePersist();
    this.emit('changed');
    return event;
  }
}
