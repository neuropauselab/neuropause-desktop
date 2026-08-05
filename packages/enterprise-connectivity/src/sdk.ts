/**
 * Enterprise-Connectivity SDK. A thin, typed surface describing how to drive the connectivity layer:
 * capability descriptors + copy-pasteable code samples. Generates snippets in-process (live-verified);
 * performs no I/O and contacts no external system.
 */
export type SdkCapability = 'connectors' | 'identity' | 'catalog' | 'ai' | 'sync' | 'mapping' | 'context' | 'search' | 'monitoring';

export interface SdkDescriptor {
  capability: SdkCapability;
  accessor: string;
  summary: string;
}

const DESCRIPTORS: SdkDescriptor[] = [
  { capability: 'connectors', accessor: 'connectors()', summary: 'Register/configure/verify connectors; active only after configure + verify.' },
  { capability: 'identity', accessor: 'identity()', summary: 'Entra/Google/Okta/Auth0 federation; SCIM provisioning via reused security.' },
  { capability: 'catalog', accessor: 'catalog()', summary: 'Represented systems + entities across five connector categories.' },
  { capability: 'ai', accessor: 'aiProviders()', summary: 'Provider routing/failover; external AI usage never fabricated.' },
  { capability: 'sync', accessor: 'synchronization()', summary: 'Real diff engine (reused); refused until the connector is configured.' },
  { capability: 'mapping', accessor: 'dataMapping()', summary: 'Schema/field mapping via the reused transformation engine.' },
  { capability: 'context', accessor: 'workspaceContext()', summary: 'Unified context from ACTIVE connectors only.' },
  { capability: 'search', accessor: 'search()', summary: 'Search over represented metadata; active connectors only.' },
  { capability: 'monitoring', accessor: 'monitoring()', summary: 'Connector/sync/AI dashboards; OAuth + API errors reported pending.' },
];

export class EnterpriseConnectivitySDK {
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
      `import { createEnterpriseConnectivity } from '@neuropause/enterprise-connectivity';`,
      `const ec = createEnterpriseConnectivity(runtime, { integrationPlatform, security, aiRuntime });`,
      `const api = ec.${d.accessor};`,
      `// ${d.summary}`,
    ].join('\n');
  }
  count(): number {
    return DESCRIPTORS.length;
  }
}
