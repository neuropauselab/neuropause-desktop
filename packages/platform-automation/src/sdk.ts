/**
 * Platform Automation SDK — an honest descriptor of what the automation layer generates and its evidence
 * level. It advertises only real in-process generators/engines; it never advertises a cloud resource,
 * cluster, or deployment that exists.
 */
export interface AutomationCapabilityDescriptor {
  epic: string;
  capability: string;
  live: boolean;
}

const CAPABILITIES: AutomationCapabilityDescriptor[] = [
  { epic: 'E1', capability: 'Automation engine (preview + approval-gated execute)', live: true },
  { epic: 'E2', capability: 'Terraform generator (plans only)', live: true },
  { epic: 'E3', capability: 'Kubernetes manifest generator', live: true },
  { epic: 'E4', capability: 'Database provisioning descriptors', live: true },
  { epic: 'E5', capability: 'DNS & TLS automation (represented)', live: true },
  { epic: 'E6', capability: 'Secrets automation (references only)', live: true },
  { epic: 'E7', capability: 'Monitoring automation + dashboards', live: true },
  { epic: 'E8', capability: 'Backup & DR automation', live: true },
  { epic: 'E9', capability: 'CI/CD GitHub Actions (approval-gated deploy)', live: true },
  { epic: 'E10', capability: 'Production validation reports (pending)', live: true },
  { epic: 'E11', capability: 'Evidence packages (never auto-promoted)', live: true },
  { epic: 'E12', capability: 'Operations dashboard', live: true },
];

export class PlatformAutomationSDK {
  capabilities(): AutomationCapabilityDescriptor[] {
    return [...CAPABILITIES];
  }
  liveCapabilityCount(): number {
    return CAPABILITIES.filter((c) => c.live).length;
  }
}
