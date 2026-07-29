/**
 * Operator Deployment SDK — an honest descriptor of the operator workflow's capabilities. It advertises
 * only real in-process workflow steps; it never advertises a deployment, cluster, or customer that exists.
 */
export interface OperatorCapabilityDescriptor {
  step: string;
  capability: string;
  live: boolean;
}

const CAPABILITIES: OperatorCapabilityDescriptor[] = [
  { step: '1', capability: 'Deployment wizard', live: true },
  { step: '2', capability: 'Environment validator (STOP → PENDING - OPERATOR ACTION REQUIRED)', live: true },
  { step: '3', capability: 'Deployment executor (approval + validation gated; never fabricates success)', live: true },
  { step: '4', capability: 'Live validation (machine-readable, pending)', live: true },
  { step: '5', capability: 'Automatic rollback (plan only)', live: true },
  { step: '6', capability: 'Evidence package (never auto-promoted)', live: true },
  { step: '7', capability: 'Operator dashboard (Pending/Running/Succeeded/Failed/Verified)', live: true },
  { step: '8', capability: 'Operator documentation (6 guides)', live: true },
];

export class OperatorDeploymentSDK {
  capabilities(): OperatorCapabilityDescriptor[] {
    return [...CAPABILITIES];
  }
  liveCapabilityCount(): number {
    return CAPABILITIES.filter((c) => c.live).length;
  }
}
