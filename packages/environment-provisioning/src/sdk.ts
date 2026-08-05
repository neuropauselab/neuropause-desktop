/**
 * Environment Provisioning SDK — an honest descriptor of the provisioning-orchestration capabilities and
 * their evidence level. It advertises only real in-process orchestration; it never advertises a cloud
 * account, cluster, or deployment that exists.
 */
export interface ProvisioningCapabilityDescriptor {
  epic: string;
  capability: string;
  live: boolean;
}

const CAPABILITIES: ProvisioningCapabilityDescriptor[] = [
  { epic: 'E1', capability: 'Cloud provisioning runtime (preview/provision/rollback)', live: true },
  { epic: 'E1', capability: 'Prerequisite gate (PENDING - OPERATOR INPUT REQUIRED)', live: true },
  { epic: 'E2', capability: 'Infrastructure provisioning planner (Terraform)', live: true },
  { epic: 'E3', capability: 'Kubernetes provisioning planner', live: true },
  { epic: 'E4', capability: 'Database provisioning planner', live: true },
  { epic: 'E5', capability: 'DNS & TLS provisioning planner', live: true },
  { epic: 'E6', capability: 'Secrets provisioning planner (references only)', live: true },
  { epic: 'E7', capability: 'Deployment orchestrator (Helm)', live: true },
  { epic: 'E8', capability: 'Monitoring provisioning planner', live: true },
  { epic: 'E9', capability: 'Acceptance validator (machine-readable, pending)', live: true },
  { epic: 'E10', capability: 'Evidence promotion (never auto-promoted)', live: true },
  { epic: 'E11', capability: 'Operations dashboard (Pending/Provisioning/Failed/Verified)', live: true },
];

export class EnvironmentProvisioningSDK {
  capabilities(): ProvisioningCapabilityDescriptor[] {
    return [...CAPABILITIES];
  }
  liveCapabilityCount(): number {
    return CAPABILITIES.filter((c) => c.live).length;
  }
}
