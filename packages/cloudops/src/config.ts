/**
 * Module 6 — Configuration Platform. Environment variables, secret-backed values, config
 * templates, version history, and configuration policies. Secret-backed values are stored
 * encrypted at rest in the REUSED Wave 2 EncryptedSecretVault (real AES-256-GCM) — this module
 * adds no new crypto. Plain env vars and templates are in-process registry data.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { EncryptedSecretVault } from '@neuropause/connectivity';
import type { Envelope } from '@neuropause/security';
import type { CloudOpsGovernance } from './governance';
import type { ConfigEntry } from './types';

export interface ConfigTemplate {
  name: string;
  requiredKeys: string[];
}

export interface ConfigPolicy {
  environmentId: string;
  requiredKeys: string[];
}

export interface ConfigPolicyResult {
  environmentId: string;
  passed: boolean;
  missing: string[];
}

export class ConfigurationPlatform {
  private readonly entries = new Map<string, ConfigEntry>();
  private readonly history = new Map<string, ConfigEntry[]>();
  private readonly templates = new Map<string, ConfigTemplate>();
  private readonly policies = new Map<string, ConfigPolicy>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
    private readonly vault: EncryptedSecretVault,
  ) {}

  private key(environmentId: string, key: string): string {
    return `${environmentId}::${key}`;
  }

  private async upsert(environmentId: string, key: string, secret: boolean, value?: string): Promise<ConfigEntry> {
    const k = this.key(environmentId, key);
    const prev = this.entries.get(k);
    const entry: ConfigEntry = {
      id: prev?.id ?? `cfg_${k}`,
      environmentId,
      key,
      secret,
      version: prev ? prev.version + 1 : 1,
      updatedAt: this.clock.now(),
      ...(secret ? {} : { value: value ?? '' }),
    };
    this.entries.set(k, entry);
    const hist = this.history.get(k) ?? [];
    hist.push(entry);
    this.history.set(k, hist);
    await this.governance.record({ actor: 'system', operation: secret ? 'config.setSecret' : 'config.setEnv', targetId: entry.id, evidence: 'live-verified', scope: environmentId, detail: key });
    return entry;
  }

  /** A plain environment variable — stored in-process. */
  async setEnv(environmentId: string, key: string, value: string): Promise<ConfigEntry> {
    return this.upsert(environmentId, key, false, value);
  }

  /** A secret-backed value — the value is encrypted at rest in the reused vault. */
  async setSecret(environmentId: string, key: string, value: string): Promise<ConfigEntry> {
    await this.vault.put(environmentId, key, value); // real AES-256-GCM envelope encryption
    return this.upsert(environmentId, key, true, undefined);
  }

  /** Decrypt a secret-backed value through the reused vault. */
  async reveal(environmentId: string, key: string): Promise<string | undefined> {
    return this.vault.reveal({ scope: environmentId, key });
  }

  /** Proof of at-rest encryption: the stored ciphertext envelope (never plaintext). */
  ciphertext(environmentId: string, key: string): Envelope | undefined {
    return this.vault.ciphertext(environmentId, key);
  }

  registerTemplate(template: ConfigTemplate): ConfigTemplate {
    this.templates.set(template.name, template);
    return template;
  }
  getTemplate(name: string): ConfigTemplate | undefined {
    return this.templates.get(name);
  }

  definePolicy(policy: ConfigPolicy): ConfigPolicy {
    this.policies.set(policy.environmentId, policy);
    return policy;
  }

  /** Real in-process evaluation: are all required keys present for the environment? */
  evaluatePolicy(environmentId: string): ConfigPolicyResult {
    const policy = this.policies.get(environmentId);
    const present = new Set(this.list(environmentId).map((e) => e.key));
    const missing = policy ? policy.requiredKeys.filter((k) => !present.has(k)) : [];
    return { environmentId, passed: missing.length === 0, missing };
  }

  get(environmentId: string, key: string): ConfigEntry | undefined {
    return this.entries.get(this.key(environmentId, key));
  }
  list(environmentId: string): ConfigEntry[] {
    return [...this.entries.values()].filter((e) => e.environmentId === environmentId);
  }
  versions(environmentId: string, key: string): ConfigEntry[] {
    return [...(this.history.get(this.key(environmentId, key)) ?? [])];
  }
  count(): number {
    return this.entries.size;
  }
}
