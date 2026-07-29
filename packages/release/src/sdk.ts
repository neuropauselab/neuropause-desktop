/**
 * Release SDK. A thin, typed surface describing how to drive the release platform: capability
 * descriptors and copy-pasteable code samples. Generates snippets in-process (live-verified); performs
 * no I/O and contacts no external system.
 */
export type SdkCapability = 'runtime' | 'packaging' | 'rc-validation' | 'ga-gate' | 'release-management' | 'automation' | 'customer-ops' | 'support' | 'license' | 'marketplace' | 'analytics' | 'executive-dashboard';

export interface SdkDescriptor {
  capability: SdkCapability;
  accessor: string;
  summary: string;
}

const DESCRIPTORS: SdkDescriptor[] = [
  { capability: 'runtime', accessor: 'runtime()', summary: 'Register a version and drive the release lifecycle.' },
  { capability: 'packaging', accessor: 'packaging()', summary: 'Build package descriptors with real checksums (reuses production installer).' },
  { capability: 'rc-validation', accessor: 'rcValidation()', summary: 'Validate the RC via the reused Sprint-4 end-to-end validation.' },
  { capability: 'ga-gate', accessor: 'gaGate()', summary: 'Evidence-based Go/No-Go with a real executive approver; never GA in the real world.' },
  { capability: 'release-management', accessor: 'releaseManagement()', summary: 'Schedule/promote, plus hotfix/patch/LTS registries and release notes.' },
  { capability: 'automation', accessor: 'automation()', summary: 'Run packaging → sign → validate → verify.' },
  { capability: 'customer-ops', accessor: 'customerOperations()', summary: 'Customer registry + deployment/license inventory (reused).' },
  { capability: 'support', accessor: 'support()', summary: 'Tickets/escalation via reused operations incidents.' },
  { capability: 'license', accessor: 'licenses()', summary: 'Trial/Community/Professional/Enterprise via reused commercial licensing.' },
  { capability: 'marketplace', accessor: 'marketplace()', summary: 'Distribution channels; never live until a real publication URL.' },
  { capability: 'analytics', accessor: 'analytics()', summary: 'Real-data-only dashboards; commercial metrics reported pending.' },
  { capability: 'executive-dashboard', accessor: 'executiveDashboard()', summary: 'Operational snapshot; live tiles only where a real source exists.' },
];

export class ReleaseSDK {
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
      `import { createReleasePlatform } from '@neuropause/release';`,
      `const release = createReleasePlatform(runtime, { reliability, commercial, operations, production });`,
      `const api = release.${d.accessor};`,
      `// ${d.summary}`,
    ].join('\n');
  }
  count(): number {
    return DESCRIPTORS.length;
  }
}
