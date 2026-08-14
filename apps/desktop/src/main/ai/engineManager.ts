/**
 * EngineManager — lifecycle owner of the single AiEngine instance. The engine boots
 * synchronously on an environment-derived router (engineInstance.ts) so the app
 * never blocks at startup; EngineManager then asynchronously loads the persisted
 * config (AiConfigStore + Secure Vault) and reconfigures the engine in place via
 * setRouter — no restart, and the shared audit/usage/prompt state is preserved.
 *
 * reconfigure() is serialised through a promise queue, so concurrent config changes
 * cannot interleave a half-built router into the engine.
 */
import { aiEngine } from './engineInstance';
import { buildModelRouter, resolveProviderId } from './providerManager';
import type { AiProviderId } from './aiConfigStore';
import { onWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';
import { onTenantRecovery } from '../tenancy/tenantRecoveryHub';
import { createLogger } from '../logger';

const log = createLogger('ai-engine-manager');

export type AiRuntimeState = 'booting' | 'loading' | 'ready' | 'needs-setup' | 'error';

export interface AiRuntimeStatus {
  state: AiRuntimeState;
  provider: AiProviderId;
  configured: boolean;
}

class EngineManager {
  private state: AiRuntimeState = 'booting';
  private queue: Promise<void> = Promise.resolve();

  /** Load persisted config and reconfigure the engine. Safe to call repeatedly. */
  async init(): Promise<AiRuntimeStatus> {
    /**
     * P13C ROUND 34 — the route plan now depends on the ACTIVE TENANT's AI
     * preference (the D-1 clamp in `assembleRouteCandidates`), so a workspace
     * switch must rebuild the router the same way every other tenant-scoped
     * cache flushes on the hub. Registered once, here, because init() is the
     * one-shot composition entry; reconfigure() is serialised and cheap.
     */
    onWorkspaceSwitch(() => {
      void this.reconfigure();
    });
    /**
     * P13C ROUND 39 — GATE 26. The boot-time reconfigure RACES composition:
     * live-restart evidence showed it running inside the resolver's refused
     * window (6ms before "Tenant resolution RECOVERED"), so the D-1 clamp read
     * no preference row, the local candidate was dropped, and a local-only
     * user with a Connected Ollama got "No AI model" for the whole session.
     * Recovery is the missing third trigger, next to preference-set and
     * workspace-switch: when resolution comes back, rebuild on what the
     * tenant actually chose. reconfigure() is serialised and cheap.
     */
    onTenantRecovery(() => {
      void this.reconfigure();
    });
    await this.reconfigure();
    return this.status();
  }

  /** Rebuild the router from current config + Vault and swap it in (serialised). */
  reconfigure(): Promise<void> {
    this.queue = this.queue.then(async () => {
      this.state = 'loading';
      try {
        const router = await buildModelRouter();
        aiEngine.setRouter(router);
        this.state = router.isConfigured() ? 'ready' : 'needs-setup';
        log.info('AI engine configured', {
          provider: resolveProviderId().provider,
          configured: router.isConfigured(),
        });
      } catch (err) {
        this.state = 'error';
        // D-4 (round 35): keeping the prior router on failure is now SAFE —
        // if the first reconfigure fails, the retained router is the
        // fail-closed boot router (deterministic fallback, nothing external),
        // not the old bare env-keyed cloud client this line used to preserve.
        log.error('AI engine reconfigure failed', { message: (err as Error).message });
      }
    });
    return this.queue;
  }

  status(): AiRuntimeStatus {
    return {
      state: this.state,
      provider: resolveProviderId().provider,
      configured: aiEngine.isConfigured(),
    };
  }
}

export const engineManager = new EngineManager();
