/**
 * EPIC 7 — Security Hardening. Static-analysis, secret, and configuration scans run for REAL over the
 * source tree (reading actual files, matching real patterns) — so a clean result is a measured fact,
 * not an assertion. Dependency, container, image, supply-chain, and runtime scanning are performed by
 * EXTERNAL tools (Snyk/Trivy/Grype/CodeQL/…) and are represented as adapter-verified until the
 * customer configures them; this package never claims to have run a scanner it did not run. When the
 * deploy foundation is wired in, its real asset catalog enumerates the Docker/K8s images that an
 * external scanner would target.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { type Clock } from '@neuropause/cloud-core';
import type { SecurityScanKind } from './constants';
import type { ReliabilityContext, ReliabilityEvidenceLevel } from './types';
import type { ReliabilityGovernance } from './governance';

export interface SecurityFinding {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

export interface SecurityScanResult {
  kind: SecurityScanKind;
  executed: boolean;
  evidence: ReliabilityEvidenceLevel;
  filesScanned: number;
  findings: SecurityFinding[];
  represented: string[];
  note: string;
  at: number;
}

interface Rule {
  rule: string;
  re: RegExp;
  skipIf?: RegExp;
}

const SECRET_RULES: Rule[] = [
  { rule: 'private-key-header', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'hardcoded-credential', re: /\b(password|secret|apikey|api_key)\b\s*[:=]\s*["'`][^"'`]{8,}["'`]/i, skipIf: /vault:|env:|ref:|process\.env|Ref\b|example|placeholder/i },
];

const STATIC_RULES: Rule[] = [
  { rule: 'eval-call', re: /\beval\s*\(/ },
  { rule: 'function-constructor', re: /\bnew Function\s*\(/ },
  { rule: 'child-process', re: /child_process|execSync\s*\(/ },
];

export class SecurityHardening {
  private readonly roots: string[];

  constructor(
    private readonly clock: Clock,
    private readonly ctx: ReliabilityContext,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
    roots?: string[],
  ) {
    // Resolve relative to this module so scans are independent of the process working directory.
    this.roots = roots ?? [__dirname];
  }

  /** The monorepo root, derived from this module's location (…/packages/reliability/src). */
  private monoRoot(): string {
    return resolve(__dirname, '..', '..', '..');
  }

  /** Run a hardening scan. static-analysis/secret/configuration execute for real; the rest are represented. */
  async scan(kind: SecurityScanKind, org?: string): Promise<SecurityScanResult> {
    const organisation = org ?? this.org;
    let base: Omit<SecurityScanResult, 'at'>;
    if (kind === 'secret') {
      base = this.runFileScan(kind, SECRET_RULES);
    } else if (kind === 'static-analysis') {
      base = this.runFileScan(kind, STATIC_RULES);
    } else if (kind === 'configuration') {
      base = this.runConfigScan();
    } else {
      base = this.represent(kind);
    }
    const result: SecurityScanResult = { ...base, at: this.clock.now() };
    await this.gov.record({
      operator: this.operator,
      org: organisation,
      capability: 'Security Hardening',
      epic: 'E7',
      operation: `scan.${kind}`,
      targetId: kind,
      evidence: result.evidence,
      decision: result.executed ? `${result.findings.length} finding(s) over ${result.filesScanned} file(s)` : 'represented — external scanner required',
    });
    return result;
  }

  private runFileScan(kind: SecurityScanKind, rules: Rule[]): Omit<SecurityScanResult, 'at'> {
    const files = this.roots.flatMap((r) => (existsSync(r) ? this.walk(r) : []));
    const findings: SecurityFinding[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        for (const rule of rules) {
          if (rule.re.test(line) && !(rule.skipIf && rule.skipIf.test(line))) {
            findings.push({ file: file.replace(`${this.monoRoot()}/`, ''), line: idx + 1, rule: rule.rule, excerpt: line.trim().slice(0, 80) });
          }
        }
      });
    }
    return {
      kind,
      executed: true,
      evidence: 'live-verified',
      filesScanned: files.length,
      findings,
      represented: [],
      note: `Real ${kind} scan over ${files.length} source file(s); ${findings.length} finding(s).`,
    };
  }

  private runConfigScan(): Omit<SecurityScanResult, 'at'> {
    const findings: SecurityFinding[] = [];
    const base = resolve(this.monoRoot(), 'tsconfig.base.json');
    let filesScanned = 0;
    if (existsSync(base)) {
      filesScanned = 1;
      const text = readFileSync(base, 'utf8');
      if (!/"strict"\s*:\s*true/.test(text)) findings.push({ file: 'tsconfig.base.json', line: 0, rule: 'strict-mode-off', excerpt: 'strict must be true' });
      if (!/"noUnusedLocals"\s*:\s*true/.test(text)) findings.push({ file: 'tsconfig.base.json', line: 0, rule: 'no-unused-locals-off', excerpt: 'noUnusedLocals must be true' });
    }
    return {
      kind: 'configuration',
      executed: true,
      evidence: 'live-verified',
      filesScanned,
      findings,
      represented: [],
      note: `Real configuration scan of tsconfig.base.json; ${findings.length} misconfiguration(s).`,
    };
  }

  private represent(kind: SecurityScanKind): Omit<SecurityScanResult, 'at'> {
    const targets: string[] = [];
    if ((kind === 'container' || kind === 'image') && this.ctx.deploy) {
      try {
        const assets = this.ctx.deploy.assets().list();
        for (const a of assets) {
          if (a.kind === 'dockerfile' || a.kind === 'compose' || a.kind === 'k8s-manifest' || a.kind === 'helm-chart') targets.push(a.path);
        }
      } catch {
        /* asset enumeration best-effort */
      }
    }
    return {
      kind,
      executed: false,
      evidence: 'adapter-verified',
      filesScanned: 0,
      findings: [],
      represented: targets.length ? targets : [`${kind} scanning requires an external scanner (adapter-verified until configured)`],
      note: `${kind} scanning is performed by an external tool and is adapter-verified until configured; no scan was fabricated.`,
    };
  }

  private walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...this.walk(full));
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
    }
    return out;
  }
}
