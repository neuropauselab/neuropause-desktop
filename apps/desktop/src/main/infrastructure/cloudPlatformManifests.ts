/**
 * The Cloud Platform CATALOG (P6 — Cloud & Infrastructure Control Plane).
 *
 * Metadata-only declarations of the cloud/infrastructure platforms the control plane KNOWS ABOUT — the
 * infrastructure analog of `CONNECTOR_MANIFESTS`. A manifest declares a platform's identity, the auth
 * mechanism it will reuse, the infrastructure domains it can expose, and its account model. It is NOT an
 * implementation: there is deliberately NO discovery adapter / collector / provider-API code here. The
 * discovery adapters (which call AWS / Azure / GCP APIs) are built in P6.1 and registered into the platform
 * registry; until then the Cloud Platform Center lists these as "not configured" cards from this catalog.
 *
 * Declaring the catalog is architecture (the platform + domain model); building the discovery adapters is not.
 */
import type { CloudPlatformManifest } from '@neuropause/shared';

export const CLOUD_PLATFORM_MANIFESTS: CloudPlatformManifest[] = [
  {
    id: 'aws',
    name: 'Amazon Web Services',
    provider: 'aws',
    description: 'Discover AWS accounts across compute, networking, storage, databases, IAM, containers, serverless, and cost.',
    website: 'https://aws.amazon.com',
    docsUrl: 'https://docs.aws.amazon.com',
    brandColor: '#FF9900',
    version: '0.1.0',
    authKind: 'iam_role',
    domains: ['identity', 'compute', 'networking', 'storage', 'databases', 'containers', 'serverless', 'messaging', 'monitoring', 'security', 'cost', 'certificates', 'dns', 'secrets'],
    multiAccount: true,
    accountNoun: 'Account',
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    provider: 'azure',
    description: 'Discover Azure subscriptions across compute, networking, storage, databases, identity, containers, and cost.',
    website: 'https://azure.microsoft.com',
    docsUrl: 'https://learn.microsoft.com/azure',
    brandColor: '#0078D4',
    version: '0.1.0',
    authKind: 'oauth2',
    domains: ['identity', 'compute', 'networking', 'storage', 'databases', 'containers', 'serverless', 'monitoring', 'security', 'cost', 'certificates', 'dns', 'secrets'],
    multiAccount: true,
    accountNoun: 'Subscription',
  },
  {
    id: 'gcp',
    name: 'Google Cloud',
    provider: 'gcp',
    description: 'Discover GCP projects across compute, networking, storage, databases, IAM, GKE, and cost.',
    website: 'https://cloud.google.com',
    docsUrl: 'https://cloud.google.com/docs',
    brandColor: '#4285F4',
    version: '0.1.0',
    authKind: 'service_account',
    domains: ['identity', 'compute', 'networking', 'storage', 'databases', 'containers', 'serverless', 'monitoring', 'security', 'cost', 'dns', 'secrets'],
    multiAccount: true,
    accountNoun: 'Project',
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    provider: 'kubernetes',
    description: 'Discover Kubernetes clusters across nodes, pods, deployments, services, and namespaces.',
    website: 'https://kubernetes.io',
    docsUrl: 'https://kubernetes.io/docs',
    brandColor: '#326CE5',
    version: '0.1.0',
    authKind: 'kubeconfig',
    domains: ['compute', 'containers', 'networking', 'storage', 'identity', 'secrets'],
    multiAccount: true,
    accountNoun: 'Cluster',
  },
  {
    id: 'docker',
    name: 'Docker',
    provider: 'docker',
    description: 'Discover Docker hosts across containers, images, networks, and volumes.',
    website: 'https://www.docker.com',
    docsUrl: 'https://docs.docker.com',
    brandColor: '#2496ED',
    version: '0.1.0',
    authKind: 'api_key',
    domains: ['containers', 'compute', 'networking', 'storage'],
    multiAccount: true,
    accountNoun: 'Host',
  },
  {
    id: 'vmware',
    name: 'VMware vSphere',
    provider: 'vmware',
    description: 'Discover VMware vSphere across virtual machines, hosts, clusters, datastores, and networks.',
    website: 'https://www.vmware.com',
    docsUrl: 'https://developer.vmware.com',
    brandColor: '#607078',
    version: '0.1.0',
    authKind: 'api_key',
    domains: ['compute', 'storage', 'networking'],
    multiAccount: true,
    accountNoun: 'vCenter',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    provider: 'cloudflare',
    description: 'Discover Cloudflare accounts across DNS, certificates, networking, and security.',
    website: 'https://www.cloudflare.com',
    docsUrl: 'https://developers.cloudflare.com',
    brandColor: '#F38020',
    version: '0.1.0',
    authKind: 'api_key',
    domains: ['dns', 'certificates', 'networking', 'security'],
    multiAccount: true,
    accountNoun: 'Account',
  },
];

/** Catalog lookup by id. */
export const PLATFORM_BY_ID: Record<string, CloudPlatformManifest> = Object.fromEntries(
  CLOUD_PLATFORM_MANIFESTS.map((m) => [m.id, m]),
);
