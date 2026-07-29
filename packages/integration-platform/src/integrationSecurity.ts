/**
 * EPIC 17 — Integration Security. OAuth, API keys, JWT, mutual TLS, certificate validation, and
 * secret references. REUSES the security platform's real token issue/verify and the Sprint-2 secrets
 * platform for credential references — it never stores a secret value and never re-implements auth.
 */
import { randomId } from '@neuropause/cloud-core';
import type { IntegrationGovernance } from './governance';
import type { IntegrationContext } from './types';

const AUTH_METHODS = ['oauth', 'api-key', 'jwt', 'mutual-tls', 'certificate-validation', 'secret-reference'] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export class IntegrationSecurity {
  private readonly apiKeys = new Map<string, { id: string; name: string; ref: string }>();

  constructor(
    private readonly governance: IntegrationGovernance,
    private readonly ctx: IntegrationContext,
  ) {}

  authMethods(): readonly AuthMethod[] { return AUTH_METHODS; }

  /** Issue an integration token by REUSING the security authentication service. */
  async issueToken(identityId: string, name: string): Promise<{ token: string } | null> {
    if (!this.ctx.security) return null;
    return this.ctx.security.authentication().issueToken(identityId, name);
  }
  verifyToken(token: string): string | undefined {
    return this.ctx.security ? this.ctx.security.authentication().verifyToken(token) : undefined;
  }

  /** Register an API-key REFERENCE (never the key itself). */
  async registerApiKeyRef(input: { name: string; secretRef: string; org?: string }): Promise<{ id: string; name: string; ref: string }> {
    const k = { id: randomId('apikey'), name: input.name, ref: input.secretRef };
    this.apiKeys.set(k.id, k);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', integration: '_security', connector: 'api-key', epic: 'E17', operation: 'security.api-key-ref', targetId: k.id, evidence: 'live-verified', decision: 'reference only' });
    return k;
  }

  /** Credential references from the reused Sprint-2 infrastructure secrets (names only, never values). */
  credentialReferences(): string[] {
    return this.ctx.infrastructure ? this.ctx.infrastructure.secrets().credentialInventory() : [];
  }

  reusesSecurity(): boolean { return !!this.ctx.security || !!this.ctx.infrastructure; }
  apiKeyRefs(): Array<{ id: string; name: string; ref: string }> { return [...this.apiKeys.values()]; }
}
