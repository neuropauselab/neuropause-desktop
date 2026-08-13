/**
 * The Companion Gateway as a BackgroundService (Mobile M1-03). ServiceManager
 * owns a hardcoded list of services and calls start()/stop() synchronously; the
 * gateway's real behavior is injected by initCompanion via `bind`, so this
 * singleton can sit in that list before the runtime is wired. start() only
 * kicks off the async listen — it never blocks the manager.
 */
import type { BackgroundService } from '../services/serviceManager';

export interface CompanionGatewayController {
  startIfEnabled(): void | Promise<void>;
  stop(): void | Promise<void>;
}

class CompanionGatewayService implements BackgroundService {
  readonly name = 'companion-gateway';
  private controller: CompanionGatewayController | null = null;

  bind(controller: CompanionGatewayController): void {
    this.controller = controller;
  }

  start(): void {
    void this.controller?.startIfEnabled();
  }

  stop(): void {
    void this.controller?.stop();
  }
}

export const companionGatewayService = new CompanionGatewayService();
