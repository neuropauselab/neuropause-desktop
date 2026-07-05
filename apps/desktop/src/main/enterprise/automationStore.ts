/**
 * Automation Store (Module 9 — Automation Builder persistence).
 *
 * Persists user automation rules (Trigger → Condition → Action). Mirrors the
 * existing DecisionStore JSON pattern (injected path, atomic write, 0o600) and is
 * Electron-free by construction, so it unit-tests without a runtime. Validation is
 * delegated to the shared automationEngine — no duplicated rule logic.
 */
import { promises as fs, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  validateAutomationRule,
  type AutomationRule,
  type AutomationStatus,
} from '@neuropause/shared';

interface AutomationFile {
  rules: AutomationRule[];
}

const MAX_RULES = 500;

export class AutomationStore {
  private rules: AutomationRule[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AutomationFile>;
      this.rules = Array.isArray(parsed.rules) ? parsed.rules : [];
    } catch {
      this.rules = [];
    }
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const file: AutomationFile = { rules: this.rules };
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** All rules, newest first. */
  all(): AutomationRule[] {
    this.load();
    return [...this.rules].sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  }

  get(id: string): AutomationRule | null {
    this.load();
    return this.rules.find((r) => r.id === id) ?? null;
  }

  /**
   * Create or replace a rule (deduped by id). Rejects invalid rules using the
   * shared engine validator — returns the validation issues instead of persisting.
   */
  async save(
    rule: AutomationRule,
  ): Promise<{ ok: true; rule: AutomationRule } | { ok: false; issues: string[] }> {
    this.load();
    const validation = validateAutomationRule(rule);
    if (!validation.valid) {
      return { ok: false, issues: validation.issues.map((i) => i.message) };
    }
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
    if (this.rules.length > MAX_RULES) {
      this.rules.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      this.rules = this.rules.slice(-MAX_RULES);
    }
    await this.persist();
    return { ok: true, rule };
  }

  /** Update a rule's status (active/paused/draft/error). Returns null if missing. */
  async setStatus(
    id: string,
    status: AutomationStatus,
    nowIso: string,
  ): Promise<AutomationRule | null> {
    this.load();
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return null;
    rule.status = status;
    rule.updatedAt = nowIso;
    await this.persist();
    return rule;
  }

  /** Delete a rule. Returns true if something was removed. */
  async remove(id: string): Promise<boolean> {
    this.load();
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    const removed = this.rules.length < before;
    if (removed) await this.persist();
    return removed;
  }

  /** Count of rules by status, for the Automations overview. */
  summary(): { total: number; active: number; paused: number; draft: number } {
    this.load();
    return {
      total: this.rules.length,
      active: this.rules.filter((r) => r.status === 'active').length,
      paused: this.rules.filter((r) => r.status === 'paused').length,
      draft: this.rules.filter((r) => r.status === 'draft').length,
    };
  }
}
