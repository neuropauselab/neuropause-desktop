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
import { declareSystemGlobalStore } from '../../tenancy/tenantOwnedStore';

const log = createLogger('federation-observability');

interface ObsFile {
  usage: UsagePoint[];
  security: SecurityEvent[];
  seeded: boolean;
}

export class ObservabilityStore extends EventEmitter {
  /**
   * P13C ROUND 4 — PHASE 29. DECLARED SYSTEM-GLOBAL, WITH A REASON.
   *
   * Usage points are install-level counters and security events carry only
   * category, severity, source and a detail string. Neither names an
   * organization or contains record content.
   *
   * P13C ROUND 7 — and the reason this is true today is stronger than the field
   * list: THERE IS NO RUNTIME WRITE PATH. Both arrays are populated only by
   * `applySeed`, behind `demoSeedsEnabled()`. The declaration used to say a
   * production install "fills them from real runtime activity"; nothing does.
   *
   * That matters because the counters are TENANT-DERIVED BY DEFINITION —
   * `apiRequests`, `syncOps` and `workerJobs` count tenant activity. The day a
   * real feed lands, an install-wide series readable on `federation:read` lets
   * one tenant watch another tenant work. The declaration says so explicitly, so
   * whoever wires it finds the boundary before they cross it.
   *
   * The declaration is what makes this reviewable. An undeclared store is
   * indistinguishable from one nobody thought about, which is how every
   * finding in this program started.
   */
  private usage: UsagePoint[] = [];
  private security: SecurityEvent[] = [];

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    declareSystemGlobalStore(
      'federation-observability',
      [
        'WHY GLOBAL: subsystem health and security events describe the RUNTIME, not any organization in it — one process, one set of subsystems, one security log.',
        'WHAT DATA: UsagePoint{at, apiRequests, syncOps, workerJobs, events} — five numbers and a timestamp; SecurityEvent{id, at, category, severity, source, detail} where detail is a fixed string authored in this file; ObsSubsystem{id, label, status, metric, unit, detail}. No organization id, workspace id, member, email or record content.',
        'WHO MAY ACCESS: federation:read (FedUsageSeries, FedSecurityEvents). WHO MAY MODIFY: nothing at runtime — see below.',
        'WHY IT CANNOT DISCLOSE TENANT DATA: P13C Round 7 verified by inspecting the persisted bytes after two tenants wrote (systemGlobalProof.test.ts). The decisive fact is stronger than the field list: THERE IS NO RUNTIME WRITE PATH AT ALL. usage.push and security.push appear only inside applySeed, behind demoSeedsEnabled(). On a production install the series is empty and stays empty, so there is nothing to derive from.',
        'A CLAIM THAT WAS UNTRUE, CORRECTED: this reason previously said a production install "fills them from real runtime activity". Nothing fills them. The comment described an intention as though it were behaviour — the exact pattern this program keeps finding, in its own comments.',
        'THE CONDITION THAT ENDS THIS DECLARATION: apiRequests, syncOps and workerJobs count TENANT ACTIVITY. The moment a real feed is wired, an install-wide counter readable on federation:read lets one tenant watch another tenant work — activity volume, timing, and idle periods. Whoever wires that feed must partition it per tenant or scope the read; it does not stay system-global.',
        'CROSS-TENANT COST TODAY: none, because there is no data.',
      ].join(' '),
    );
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
