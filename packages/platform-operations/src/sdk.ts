/**
 * Platform-Operations SDK. A thin, typed surface describing how to drive the control plane: capability
 * descriptors and copy-pasteable code samples. Generates snippets in-process (live-verified); performs
 * no I/O and contacts no external system.
 */
export type SdkCapability = 'cloud' | 'kubernetes' | 'databases' | 'api' | 'networking' | 'identity' | 'ai-ops' | 'cicd' | 'monitoring' | 'operations-center' | 'backup' | 'deployment' | 'validation';

export interface SdkDescriptor {
  capability: SdkCapability;
  accessor: string;
  summary: string;
}

const DESCRIPTORS: SdkDescriptor[] = [
  { capability: 'cloud', accessor: 'cloud()', summary: 'Environment/cluster inventory (reuses infra; 0 running nodes until real).' },
  { capability: 'kubernetes', accessor: 'kubernetes()', summary: 'K8s descriptors; reuses deploy manifest assets.' },
  { capability: 'databases', accessor: 'databases()', summary: 'DB descriptors (health unknown until a real probe); backup via production.' },
  { capability: 'api', accessor: 'api()', summary: 'API endpoint registry across REST/GraphQL/WebSocket (descriptors).' },
  { capability: 'networking', accessor: 'networking()', summary: 'DNS/TLS/LB descriptors; domain reported NOT live.' },
  { capability: 'identity', accessor: 'identity()', summary: 'Real identity/MFA/session via reused security.' },
  { capability: 'ai-ops', accessor: 'aiOps()', summary: 'AI provider routing/failover; providers represented.' },
  { capability: 'cicd', accessor: 'cicd()', summary: 'Pipelines; build/release reuse the Sprint-6 release automation.' },
  { capability: 'monitoring', accessor: 'monitoring()', summary: 'Prometheus/Grafana/Loki/OTel descriptors + dashboards.' },
  { capability: 'operations-center', accessor: 'operationsCenter()', summary: 'Health snapshot + incident center (reuses operations).' },
  { capability: 'backup', accessor: 'backupRecovery()', summary: 'Backups + DR validation (reuse production + reliability).' },
  { capability: 'deployment', accessor: 'deploymentAutomation()', summary: 'Rolling/canary/blue-green/rollback; artifacts via release.' },
  { capability: 'validation', accessor: 'validation()', summary: 'Production validation via the reused end-to-end trace.' },
];

export class PlatformOpsSDK {
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
      `import { createPlatformOperations } from '@neuropause/platform-operations';`,
      `const ops = createPlatformOperations(runtime, { infrastructure, deploy, reliability, release, operations, production, security });`,
      `const api = ops.${d.accessor};`,
      `// ${d.summary}`,
    ].join('\n');
  }
  count(): number {
    return DESCRIPTORS.length;
  }
}
