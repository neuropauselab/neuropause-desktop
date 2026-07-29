/**
 * Deployment Orchestrator SDK — a small, honest descriptor of the launch layer's capabilities. It
 * exposes only what the platform really provides (deployment READINESS, not claimed deployment); it never
 * advertises a customer, government deployment, contract, or revenue that does not exist.
 */
export interface LaunchCapabilityDescriptor {
  epic: string;
  capability: string;
  live: boolean;
}

const CAPABILITIES: LaunchCapabilityDescriptor[] = [
  { epic: 'E1', capability: 'Deployment orchestrator + lifecycle + validation', live: true },
  { epic: 'E2', capability: 'Pilot program (customers represented)', live: true },
  { epic: 'E3', capability: 'Government deployment templates (templates only)', live: true },
  { epic: 'E4', capability: 'Enterprise rollout framework', live: true },
  { epic: 'E5', capability: 'GA program go/no-go (reused Release gate)', live: true },
  { epic: 'E6', capability: 'Customer success operations (measured data only)', live: true },
  { epic: 'E7', capability: 'Commercial registry (contracts/revenue represented)', live: true },
  { epic: 'E8', capability: 'Partner ecosystem (agreements represented)', live: true },
  { epic: 'E9', capability: 'Government readiness models', live: true },
  { epic: 'E10', capability: 'Launch Operations Center', live: true },
  { epic: 'E11', capability: 'Training & enablement (assets represented)', live: true },
  { epic: 'E13', capability: 'Business launch-readiness scoring (composed)', live: true },
];

export class DeploymentOrchestratorSDK {
  capabilities(): LaunchCapabilityDescriptor[] {
    return [...CAPABILITIES];
  }
  liveCapabilityCount(): number {
    return CAPABILITIES.filter((c) => c.live).length;
  }
}
