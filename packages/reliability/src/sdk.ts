/**
 * EPIC 17 — Reliability SDK. A thin, typed surface describing how to drive the reliability platform:
 * capability descriptors and copy-pasteable code samples. It generates outlines/snippets in-process
 * (live-verified); it performs no I/O and contacts no external system.
 */
export type SdkCapability =
  | 'validation'
  | 'end-to-end'
  | 'performance'
  | 'load'
  | 'chaos'
  | 'recovery'
  | 'security'
  | 'compliance'
  | 'reliability'
  | 'slo'
  | 'release-candidate';

export interface SdkDescriptor {
  capability: SdkCapability;
  accessor: string;
  summary: string;
}

const DESCRIPTORS: SdkDescriptor[] = [
  { capability: 'validation', accessor: 'validation()', summary: 'Register and run production validation suites.' },
  { capability: 'end-to-end', accessor: 'endToEnd()', summary: 'Run real cross-subsystem execution traces.' },
  { capability: 'performance', accessor: 'performance()', summary: 'Measure throughput/latency/capacity via the reused monitor.' },
  { capability: 'load', accessor: 'loadTesting()', summary: 'Run measured load/stress/endurance tests.' },
  { capability: 'chaos', accessor: 'chaos()', summary: 'Inject controlled faults into an in-process sandbox.' },
  { capability: 'recovery', accessor: 'recovery()', summary: 'Validate backup/DB/config/rollback/restart/connector recovery.' },
  { capability: 'security', accessor: 'hardening()', summary: 'Run real static/secret/config scans; represent external scanners.' },
  { capability: 'compliance', accessor: 'compliance()', summary: 'Generate compliance evidence packages (never certifies).' },
  { capability: 'reliability', accessor: 'reliabilityEngineering()', summary: 'Compute availability/MTTR/MTBF/score from incidents.' },
  { capability: 'slo', accessor: 'slo()', summary: 'Define SLOs and compute error budgets.' },
  { capability: 'release-candidate', accessor: 'releaseCandidate()', summary: 'Aggregate gates into an RC decision (never GA).' },
];

export class ReliabilitySDK {
  capabilities(): SdkDescriptor[] {
    return [...DESCRIPTORS];
  }

  descriptor(capability: SdkCapability): SdkDescriptor | undefined {
    return DESCRIPTORS.find((d) => d.capability === capability);
  }

  /** A copy-pasteable snippet for a capability. */
  sample(capability: SdkCapability): string {
    const d = this.descriptor(capability);
    if (!d) throw new Error(`unknown capability: ${capability}`);
    return [
      `import { createReliabilityPlatform } from '@neuropause/reliability';`,
      `const reliability = createReliabilityPlatform(runtime, { operations, production, security });`,
      `const api = reliability.${d.accessor};`,
      `// ${d.summary}`,
    ].join('\n');
  }

  count(): number {
    return DESCRIPTORS.length;
  }
}
