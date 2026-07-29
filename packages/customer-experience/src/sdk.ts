/**
 * Customer-Experience SDK. A thin, typed surface describing how to drive the customer-experience layer:
 * capability descriptors + copy-pasteable code samples. Generates snippets in-process (live-verified);
 * performs no I/O and contacts no external system.
 */
export type SdkCapability = 'portal' | 'auth' | 'licensing' | 'billing' | 'downloads' | 'updates' | 'onboarding' | 'documentation' | 'support' | 'success' | 'website' | 'analytics' | 'communications';

export interface SdkDescriptor {
  capability: SdkCapability;
  accessor: string;
  summary: string;
}

const DESCRIPTORS: SdkDescriptor[] = [
  { capability: 'portal', accessor: 'portal()', summary: 'Dashboards, notifications, activity timeline (real in-process state).' },
  { capability: 'auth', accessor: 'auth()', summary: 'Real signup/verify/login/MFA + organizations via reused security.' },
  { capability: 'licensing', accessor: 'licensing()', summary: 'Trial/Community/Professional/Enterprise via reused release + commercial.' },
  { capability: 'billing', accessor: 'billing()', summary: 'Stripe/Razorpay represented; a payment is never marked successful.' },
  { capability: 'downloads', accessor: 'downloads()', summary: 'Desktop installers with real checksums (reused packaging).' },
  { capability: 'updates', accessor: 'updates()', summary: 'Version check + rollback (reused release + reliability).' },
  { capability: 'onboarding', accessor: 'onboarding()', summary: 'Welcome wizard; checklist complete only when every step is done.' },
  { capability: 'documentation', accessor: 'documentation()', summary: 'Docs center reusing the release documentation generator.' },
  { capability: 'support', accessor: 'support()', summary: 'Tickets reusing operations incidents; knowledge search; feedback.' },
  { capability: 'success', accessor: 'customerSuccess()', summary: 'Health/adoption from real usage; null with no data.' },
  { capability: 'website', accessor: 'website()', summary: 'Site pages represented; NOT publicly live until deployed.' },
  { capability: 'analytics', accessor: 'analytics()', summary: 'Measured in-process counts; production metrics reported pending.' },
  { capability: 'communications', accessor: 'communications()', summary: 'Emails composed; delivery represented until a provider is configured.' },
];

export class CustomerExperienceSDK {
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
      `import { createCustomerExperience } from '@neuropause/customer-experience';`,
      `const cx = createCustomerExperience(runtime, { security, release, commercial, operations });`,
      `const api = cx.${d.accessor};`,
      `// ${d.summary}`,
    ].join('\n');
  }
  count(): number {
    return DESCRIPTORS.length;
  }
}
