/**
 * Customer-Deployment SDK. A thin, typed surface describing how to drive the deployment platform:
 * capability descriptors and copy-pasteable code samples. Generates snippets in-process (live-verified);
 * performs no I/O and contacts no external system.
 */
export type SdkCapability =
  | 'runtime'
  | 'onboarding'
  | 'configuration'
  | 'identity'
  | 'integration'
  | 'migration'
  | 'provisioning'
  | 'workspace'
  | 'ai-workforce'
  | 'acceptance'
  | 'uat'
  | 'hypercare'
  | 'readiness-gate';

export interface SdkDescriptor {
  capability: SdkCapability;
  accessor: string;
  summary: string;
}

const DESCRIPTORS: SdkDescriptor[] = [
  { capability: 'runtime', accessor: 'runtime()', summary: 'Register customers/tenants/environments and drive the deployment lifecycle.' },
  { capability: 'onboarding', accessor: 'onboarding()', summary: 'Apply org identity, default roles (real), and default AI config.' },
  { capability: 'configuration', accessor: 'configuration()', summary: 'Apply business/industry modules, identity provider, storage, feature flags.' },
  { capability: 'identity', accessor: 'identityFederation()', summary: 'Federate a directory and sync users through the reused identity platform.' },
  { capability: 'integration', accessor: 'integrationActivation()', summary: 'Activate adapters — active only with credentials AND verification.' },
  { capability: 'migration', accessor: 'migration()', summary: 'Plan/validate/dry-run a migration over real sample records; never fabricate data.' },
  { capability: 'provisioning', accessor: 'provisioning()', summary: 'Provision users with real identity, role, permission, and license.' },
  { capability: 'workspace', accessor: 'workspaceActivation()', summary: 'Activate dashboards/workspaces via the reused workplace runtime.' },
  { capability: 'ai-workforce', accessor: 'aiWorkforce()', summary: 'Enable only licensed AI workers via the reused workforce platform.' },
  { capability: 'acceptance', accessor: 'acceptance()', summary: 'Run operational acceptance via the reused end-to-end validation.' },
  { capability: 'uat', accessor: 'uat()', summary: 'Run UAT with a sign-off workflow that never fabricates approval.' },
  { capability: 'hypercare', accessor: 'hypercare()', summary: 'Track issues via reused operations incidents; SLA via reused SLOs.' },
  { capability: 'readiness-gate', accessor: 'readinessGate()', summary: 'Evidence-based Go/No-Go — pilot ceiling, never GA.' },
];

export class CustomerDeploymentSDK {
  capabilities(): SdkDescriptor[] {
    return [...DESCRIPTORS];
  }
  descriptor(capability: SdkCapability): SdkDescriptor | undefined {
    return DESCRIPTORS.find((d) => d.capability === capability);
  }
  sample(capability: SdkCapability): string {
    const d = this.descriptor(capability);
    if (!d) throw new Error(`unknown capability: ${capability}`);
    return [
      `import { createCustomerDeploymentPlatform } from '@neuropause/customer-deployment';`,
      `const cd = createCustomerDeploymentPlatform(runtime, { security, reliability, integrationPlatform });`,
      `const api = cd.${d.accessor};`,
      `// ${d.summary}`,
    ].join('\n');
  }
  count(): number {
    return DESCRIPTORS.length;
  }
}
