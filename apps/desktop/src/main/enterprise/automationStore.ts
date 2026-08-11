/**
 * Automation Store (Module 9 — Automation Builder persistence).
 *
 * Persists user automation rules (Trigger → Condition → Action). Mirrors the
 * existing DecisionStore JSON pattern (injected path, atomic write, 0o600) and is
 * Electron-free by construction, so it unit-tests without a runtime. Validation is
 * delegated to the shared automationEngine — no duplicated rule logic.
 */
import { promises as fs, readFileSync } from 'node:fs';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';
import { dirname } from 'node:path';
import {
  validateAutomationRule,
  type AutomationRule,
  type AutomationStatus,
} from '@neuropause/shared';

/**
 * P13C ROUND 10 — the structural scope declaration. See tenancy/storeScope.ts.
 *
 * The file passed the scope gate on `new TenantOwnership(...)` alone, which
 * takes no retention argument — the hole all three of Round 9's proven HIGH
 * findings sat in. Read against the code rather than against the fix comment.
 */
declareStoreScope({
  name: 'automation-rules',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  /** `remove` is the owner deleting its own rule; the cap runs under the same caller. */
  retentionAuthority: 'OWNER',
  retention:
    'Two removals, both per owner. (1) The MAX_RULES=500 cap goes through ' +
    '`TenantOwnership.pruneOwn`, which filters to `scope.tenantId`, drops that tenant\'s oldest by ' +
    '`createdAt` and returns every other tenant\'s rows untouched; an unresolved scope prunes ' +
    'NOTHING rather than pruning globally. It was an install-wide 500 that let one tenant choose ' +
    "which of another's live automations was destroyed (Round 2 — H1). (2) `remove(id)` resolves " +
    'through the scoped `get(id)` first, so a foreign id is "not found" rather than "found and ' +
    'deleted". `save` refuses to replace a row it does not own, which is the write-side half.',
  reason:
    'An AutomationRule is a live business object — trigger, conditions and the actions it will ' +
    'execute — and `runById` EXECUTES one. Ownership is stamped from the resolved tenant at save ' +
    'and never taken from the payload.',
});

interface AutomationFile {
  rules: AutomationRule[];
}

const MAX_RULES = 500;

export class AutomationStore {
  /**
   * P13C Round 2 — H1. THE TENANT BOUNDARY.
   *
   * `AutomationRule` had no owner and this store had no seam, so `all()`
   * returned every organization's rules through a channel that was on the
   * PUBLIC allowlist, `save()` overwrote by bare payload id, `runById()`
   * EXECUTED another tenant's rule, and an install-wide `MAX_RULES` let one
   * tenant evict another's live automations.
   *
   * The seam is composed rather than inherited because the five stores fixed in
   * this round share no base class; see `TenantOwnership`.
   */
  private readonly tenancy = new TenantOwnership('automation-rules');
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

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    this.load();
    return this.tenancy.countOwnership(this.rules);
  }

  /** The CALLER'S rules, newest first. Was every rule on the install. */
  all(): AutomationRule[] {
    this.load();
    return this.tenancy
      .onlyMine(this.rules)
      .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  }

  /** The rule, IF it is the caller's. A foreign id reads as absent. */
  get(id: string): AutomationRule | null {
    this.load();
    const rule = this.rules.find((r) => r.id === id) ?? null;
    return rule !== null && this.tenancy.mine(rule) ? rule : null;
  }

  /**
   * Rules owned by a NAMED tenant — for the event producer only.
   *
   * The producer dispatches on a platform event, which carries its own tenant
   * (Program 13B stamps it), so it must select by the EVENT's owner rather than
   * by whoever is on screen. Before this it fanned every install rule against
   * every tenant's events, which is how another tenant's record data could
   * leave the machine through a rule its owner never wrote.
   */
  activeRulesForTenant(tenantId: string): AutomationRule[] {
    this.load();
    if (!tenantId) return [];
    return this.rules.filter((r) => r.status === 'active' && r.tenantId === tenantId);
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
    /**
     * Ownership comes from the resolved tenant, never from the payload — and an
     * EXISTING rule may only be replaced by its owner. Without that second
     * check `save` was a write-side IDOR: a caller who knew an id could
     * overwrite another tenant's rule, including its trigger and actions.
     */
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0 && !this.tenancy.mine(this.rules[idx]!)) {
      return { ok: false, issues: ['That automation rule does not exist.'] };
    }
    const owned = this.tenancy.stamp(rule);
    if (idx >= 0) this.rules[idx] = owned;
    else this.rules.push(owned);
    // Retention is PER TENANT: an install-wide cap let one tenant choose which
    // of another's live rules was destroyed.
    this.rules = this.tenancy.pruneOwn(this.rules, MAX_RULES, (a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
    await this.persist();
    return { ok: true, rule: owned };
  }

  /** Update a rule's status (active/paused/draft/error). Returns null if missing. */
  async setStatus(
    id: string,
    status: AutomationStatus,
    nowIso: string,
  ): Promise<AutomationRule | null> {
    this.load();
    // Scoped: a foreign id is "not found", not "found and mutated".
    const rule = this.get(id);
    if (!rule) return null;
    rule.status = status;
    rule.updatedAt = nowIso;
    await this.persist();
    return rule;
  }

  /** The CALLER'S active rules — the interactive runner's working set. */
  activeRules(): AutomationRule[] {
    this.load();
    return this.tenancy.onlyMine(this.rules).filter((r) => r.status === 'active');
  }

  /** Record the outcome of a run onto the rule (lastRun). Returns the rule. */
  async recordRun(
    id: string,
    result: { at: string; ok: boolean; message?: string },
  ): Promise<AutomationRule | null> {
    this.load();
    // Scoped: a foreign id is "not found", not "found and mutated".
    const rule = this.get(id);
    if (!rule) return null;
    rule.lastRun = result;
    rule.updatedAt = result.at;
    if (!result.ok) rule.status = 'error';
    await this.persist();
    return rule;
  }

  /** Delete a rule. Returns true if something was removed. */
  async remove(id: string): Promise<boolean> {
    this.load();
    if (this.get(id) === null) return false; // not the caller's ⇒ nothing to delete
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    const removed = this.rules.length < before;
    if (removed) await this.persist();
    return removed;
  }

  /** Count of rules by status, for the Automations overview. */
  summary(): { total: number; active: number; paused: number; draft: number } {
    this.load();
    // Scoped: an install-wide count tells one tenant how much another automates.
    const mine = this.tenancy.onlyMine(this.rules);
    return {
      total: mine.length,
      active: mine.filter((r) => r.status === 'active').length,
      paused: mine.filter((r) => r.status === 'paused').length,
      draft: mine.filter((r) => r.status === 'draft').length,
    };
  }
}
