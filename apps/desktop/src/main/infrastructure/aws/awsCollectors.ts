/**
 * AWS DomainCollectors (P6.1). Each collector discovers ONE AWS resource type via the P6.0 `DomainCollector`
 * contract — it fetches one page of an AWS list/describe API (via the signed transport), maps each item into
 * a `CloudResource` with its typed relationships, and returns a `DiscoveryPage` with the AWS pagination token
 * as the incremental cursor. The Discovery Engine drives the paging, persists the cursor, degrades a domain
 * on 403/404, and sinks the resources into the Resource Store + Resource Graph. Nothing here is a runtime.
 *
 * Region: AWS resources are regional; a collector uses `ctx.region ?? defaultRegion` (global services ignore
 * it). Multi-region fan-out is a documented enhancement (§Known Limitations). The pagination token is
 * run-scoped (a fresh run restarts the snapshot — an AWS list is current-state, so re-walk + store-dedup is
 * the correct incremental model, matching the P6.0 full-list pattern).
 */
import {
  makeResource,
  parseDiscoveryCursor,
  toDiscoveryCursor,
  type DomainCollector,
  type InfrastructureDomain,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { asArray, awsJsonRpc, awsQuery, awsRestJson, awsRestXml, xmlGet } from './awsClient';
import type { DiscoveryHttp } from '@neuropause/shared';

/** The default region when an account isn't scoped to one (overridden per discovery run). */
export const AWS_DEFAULT_REGION = (process.env.NEUROPAUSE_AWS_REGION ?? '').trim() || 'us-east-1';

type Rec = Record<string, unknown>;
type MappedResource = {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  tags?: Record<string, string>;
  attributes?: Record<string, string | number | boolean | null>;
  relationships?: ResourceRelationship[];
};

interface AwsCollectorSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  /** Sign against us-east-1 and ignore the run region (IAM/S3/Route53). */
  global?: boolean;
  host: (region: string) => string;
  fetchPage: (http: DiscoveryHttp, host: string, token: string | null) => Promise<{ items: Rec[]; nextToken: string | null }>;
  map: (item: Rec) => MappedResource;
}

/** Build a `DomainCollector` from a spec — cursor handling, mapping, and `makeResource` are uniform. */
function makeCollector(spec: AwsCollectorSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const region = spec.global ? 'us-east-1' : (ctx.region ?? AWS_DEFAULT_REGION);
      const host = spec.host(region);
      const c = parseDiscoveryCursor(ctx.cursor);
      // Run-scoped token: a fresh run restarts the snapshot (an AWS list is current-state).
      const token = c && c.runAt === ctx.now ? (c.token ?? null) : null;
      const { items, nextToken } = await spec.fetchPage(ctx.http, host, token);
      const resources = items.map((item) => {
        const m = spec.map(item);
        return makeResource({
          platformId: ctx.platformId,
          provider: 'aws',
          accountId: ctx.accountId,
          domain: spec.domain,
          resourceType: spec.resourceType,
          region,
          now: ctx.now,
          nativeId: m.nativeId,
          name: m.name,
          status: m.status,
          health: m.health,
          tags: m.tags,
          attributes: m.attributes,
          relationships: m.relationships,
        });
      });
      return { resources, cursor: nextToken ? toDiscoveryCursor({ token: nextToken, runAt: ctx.now }) : null, hasMore: !!nextToken };
    },
  };
}

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const s = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];

/** EC2 `tagSet.item[]` → the Name tag (or null). */
function ec2Name(item: Rec, fallback: string): string {
  const tags = asArray<Rec>(xmlGet(item, 'tagSet.item'));
  const name = tags.find((t) => s(t.key) === 'Name');
  return s(name?.value) ?? fallback;
}
function ec2Tags(item: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of asArray<Rec>(xmlGet(item, 'tagSet.item'))) {
    const k = s(t.key);
    if (k) out[k] = s(t.value) ?? '';
  }
  return out;
}

/* ── query-protocol page fetchers ────────────────────────────────────────────── */

/** A query-protocol list: POST form, navigate `respRoot.listPath` for items + `respRoot.tokenField`. */
function queryPager(action: string, version: string, respRoot: string, listPath: string, tokenParam: string, tokenField: string) {
  return async (http: DiscoveryHttp, host: string, token: string | null): Promise<{ items: Rec[]; nextToken: string | null }> => {
    const params: Record<string, string> = {};
    if (token) params[tokenParam] = token;
    const root = await awsQuery(http, host, action, version, params);
    const items = asArray<Rec>(xmlGet(root, `${respRoot}.${listPath}`));
    const nextToken = s(xmlGet(root, `${respRoot}.${tokenField}`));
    return { items, nextToken };
  };
}

/* ── the collectors ──────────────────────────────────────────────────────────── */

const IDENTITY: AwsCollectorSpec[] = [
  {
    id: 'aws_iam_users', domain: 'identity', label: 'IAM Users', resourceType: 'iam_user', global: true,
    host: () => 'iam.amazonaws.com',
    fetchPage: queryPager('ListUsers', '2010-05-08', 'ListUsersResponse', 'ListUsersResult.Users.member', 'Marker', 'ListUsersResult.Marker'),
    map: (u) => ({ nativeId: s(u.UserId) ?? s(u.UserName) ?? '', name: s(u.UserName) ?? 'user', attributes: { arn: s(u.Arn), path: s(u.Path) } }),
  },
  {
    id: 'aws_iam_roles', domain: 'identity', label: 'IAM Roles', resourceType: 'iam_role', global: true,
    host: () => 'iam.amazonaws.com',
    fetchPage: queryPager('ListRoles', '2010-05-08', 'ListRolesResponse', 'ListRolesResult.Roles.member', 'Marker', 'ListRolesResult.Marker'),
    map: (r) => ({ nativeId: s(r.RoleId) ?? s(r.RoleName) ?? '', name: s(r.RoleName) ?? 'role', attributes: { arn: s(r.Arn), path: s(r.Path) } }),
  },
  {
    id: 'aws_iam_policies', domain: 'identity', label: 'IAM Policies', resourceType: 'iam_policy', global: true,
    host: () => 'iam.amazonaws.com',
    fetchPage: queryPager('ListPolicies', '2010-05-08', 'ListPoliciesResponse', 'ListPoliciesResult.Policies.member', 'Marker', 'ListPoliciesResult.Marker'),
    map: (p) => ({ nativeId: s(p.PolicyId) ?? s(p.PolicyName) ?? '', name: s(p.PolicyName) ?? 'policy', attributes: { arn: s(p.Arn), attachmentCount: Number(s(p.AttachmentCount) ?? 0) } }),
  },
];

const COMPUTE: AwsCollectorSpec[] = [
  {
    id: 'aws_ec2_instances', domain: 'compute', label: 'EC2 Instances', resourceType: 'ec2_instance',
    host: (r) => `ec2.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const params: Record<string, string> = {};
      if (token) params.NextToken = token;
      const root = await awsQuery(http, host, 'DescribeInstances', '2016-11-15', params);
      const reservations = asArray<Rec>(xmlGet(root, 'DescribeInstancesResponse.reservationSet.item'));
      const items = reservations.flatMap((res) => asArray<Rec>(xmlGet(res, 'instancesSet.item')));
      return { items, nextToken: s(xmlGet(root, 'DescribeInstancesResponse.nextToken')) };
    },
    map: (i) => {
      const state = s(xmlGet(i, 'instanceState.name'));
      const sgs = asArray<Rec>(xmlGet(i, 'groupSet.item'));
      return {
        nativeId: s(i.instanceId) ?? '',
        name: ec2Name(i, s(i.instanceId) ?? 'instance'),
        status: state,
        health: state === 'running' ? 'healthy' : state === 'terminated' ? 'critical' : state === 'stopped' ? 'degraded' : 'unknown',
        tags: ec2Tags(i),
        attributes: { instanceType: s(i.instanceType), az: s(xmlGet(i, 'placement.availabilityZone')), privateIp: s(i.privateIpAddress), publicIp: s(i.ipAddress) },
        relationships: [
          ...rel('member_of', s(i.subnetId)),
          ...rel('hosted_by', s(i.vpcId)),
          ...sgs.flatMap((g) => rel('protected_by', s(g.groupId))),
          // The instance DECLARES `attached_to` its EBS volumes (dependent → dependency): a volume is the
          // single-point-of-failure for the instance's data, so the edge points INTO the volume (matching the
          // P6 convention where the depended-upon resource is the edge target and accrues blast radius).
          ...asArray<Rec>(xmlGet(i, 'blockDeviceMapping.item')).flatMap((bd) => rel('attached_to', s(xmlGet(bd, 'ebs.volumeId')))),
        ],
      };
    },
  },
  {
    id: 'aws_autoscaling_groups', domain: 'compute', label: 'Auto Scaling Groups', resourceType: 'autoscaling_group',
    host: (r) => `autoscaling.${r}.amazonaws.com`,
    fetchPage: queryPager('DescribeAutoScalingGroups', '2011-01-01', 'DescribeAutoScalingGroupsResponse', 'DescribeAutoScalingGroupsResult.AutoScalingGroups.member', 'NextToken', 'DescribeAutoScalingGroupsResult.NextToken'),
    map: (g) => ({
      nativeId: s(g.AutoScalingGroupName) ?? '',
      name: s(g.AutoScalingGroupName) ?? 'asg',
      attributes: { min: Number(s(g.MinSize) ?? 0), max: Number(s(g.MaxSize) ?? 0), desired: Number(s(g.DesiredCapacity) ?? 0), arn: s(g.AutoScalingGroupARN) },
      relationships: asArray<Rec>(xmlGet(g, 'Instances.member')).flatMap((inst) => rel('runs_on', s(inst.InstanceId))),
    }),
  },
];

const NETWORKING: AwsCollectorSpec[] = [
  {
    id: 'aws_vpcs', domain: 'networking', label: 'VPCs', resourceType: 'vpc',
    host: (r) => `ec2.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const params: Record<string, string> = {};
      if (token) params.NextToken = token;
      const root = await awsQuery(http, host, 'DescribeVpcs', '2016-11-15', params);
      return { items: asArray<Rec>(xmlGet(root, 'DescribeVpcsResponse.vpcSet.item')), nextToken: s(xmlGet(root, 'DescribeVpcsResponse.nextToken')) };
    },
    map: (v) => ({ nativeId: s(v.vpcId) ?? '', name: ec2Name(v, s(v.vpcId) ?? 'vpc'), status: s(v.state), tags: ec2Tags(v), attributes: { cidr: s(v.cidrBlock), isDefault: s(v.isDefault) === 'true' } }),
  },
  {
    id: 'aws_subnets', domain: 'networking', label: 'Subnets', resourceType: 'subnet',
    host: (r) => `ec2.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const params: Record<string, string> = {};
      if (token) params.NextToken = token;
      const root = await awsQuery(http, host, 'DescribeSubnets', '2016-11-15', params);
      return { items: asArray<Rec>(xmlGet(root, 'DescribeSubnetsResponse.subnetSet.item')), nextToken: s(xmlGet(root, 'DescribeSubnetsResponse.nextToken')) };
    },
    map: (n) => ({ nativeId: s(n.subnetId) ?? '', name: ec2Name(n, s(n.subnetId) ?? 'subnet'), status: s(n.state), tags: ec2Tags(n), attributes: { cidr: s(n.cidrBlock), az: s(n.availabilityZone) }, relationships: rel('member_of', s(n.vpcId)) }),
  },
  {
    id: 'aws_security_groups', domain: 'networking', label: 'Security Groups', resourceType: 'security_group',
    host: (r) => `ec2.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const params: Record<string, string> = {};
      if (token) params.NextToken = token;
      const root = await awsQuery(http, host, 'DescribeSecurityGroups', '2016-11-15', params);
      return { items: asArray<Rec>(xmlGet(root, 'DescribeSecurityGroupsResponse.securityGroupInfo.item')), nextToken: s(xmlGet(root, 'DescribeSecurityGroupsResponse.nextToken')) };
    },
    map: (g) => ({ nativeId: s(g.groupId) ?? '', name: s(g.groupName) ?? s(g.groupId) ?? 'sg', tags: ec2Tags(g), attributes: { description: s(g.groupDescription) }, relationships: rel('member_of', s(g.vpcId)) }),
  },
  {
    id: 'aws_route_tables', domain: 'networking', label: 'Route Tables', resourceType: 'route_table',
    host: (r) => `ec2.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const params: Record<string, string> = {};
      if (token) params.NextToken = token;
      const root = await awsQuery(http, host, 'DescribeRouteTables', '2016-11-15', params);
      return { items: asArray<Rec>(xmlGet(root, 'DescribeRouteTablesResponse.routeTableSet.item')), nextToken: s(xmlGet(root, 'DescribeRouteTablesResponse.nextToken')) };
    },
    map: (t) => ({ nativeId: s(t.routeTableId) ?? '', name: ec2Name(t, s(t.routeTableId) ?? 'rtb'), tags: ec2Tags(t), relationships: rel('member_of', s(t.vpcId)) }),
  },
  {
    id: 'aws_load_balancers', domain: 'networking', label: 'Load Balancers', resourceType: 'load_balancer',
    host: (r) => `elasticloadbalancing.${r}.amazonaws.com`,
    fetchPage: queryPager('DescribeLoadBalancers', '2015-12-01', 'DescribeLoadBalancersResponse', 'DescribeLoadBalancersResult.LoadBalancers.member', 'Marker', 'DescribeLoadBalancersResult.NextMarker'),
    map: (lb) => ({
      nativeId: s(lb.LoadBalancerArn) ?? s(lb.LoadBalancerName) ?? '',
      name: s(lb.LoadBalancerName) ?? 'elb',
      status: s(xmlGet(lb, 'State.Code')),
      attributes: { dnsName: s(lb.DNSName), scheme: s(lb.Scheme), type: s(lb.Type) },
      relationships: [
        ...rel('hosted_by', s(lb.VpcId)),
        ...asArray<Rec>(xmlGet(lb, 'AvailabilityZones.member')).flatMap((az) => rel('member_of', s(az.SubnetId))),
      ],
    }),
  },
];

const STORAGE: AwsCollectorSpec[] = [
  {
    id: 'aws_s3_buckets', domain: 'storage', label: 'S3 Buckets', resourceType: 's3_bucket', global: true,
    host: () => 's3.amazonaws.com',
    fetchPage: async (http) => {
      const root = await awsRestXml(http, 'GET', 'https://s3.amazonaws.com/');
      return { items: asArray<Rec>(xmlGet(root, 'ListAllMyBucketsResult.Buckets.Bucket')), nextToken: null };
    },
    map: (b) => ({ nativeId: s(b.Name) ?? '', name: s(b.Name) ?? 'bucket', attributes: { createdAt: s(b.CreationDate) } }),
  },
  {
    id: 'aws_ebs_volumes', domain: 'storage', label: 'EBS Volumes', resourceType: 'ebs_volume',
    host: (r) => `ec2.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const params: Record<string, string> = {};
      if (token) params.NextToken = token;
      const root = await awsQuery(http, host, 'DescribeVolumes', '2016-11-15', params);
      return { items: asArray<Rec>(xmlGet(root, 'DescribeVolumesResponse.volumeSet.item')), nextToken: s(xmlGet(root, 'DescribeVolumesResponse.nextToken')) };
    },
    map: (v) => {
      const state = s(v.status);
      // The attachment is captured as context (which instance holds it), NOT as an edge: the instance is the
      // dependent and declares `attached_to` → this volume, so declaring the reverse here would invert the
      // dependency (and create a 2-cycle). Blast radius therefore correctly ranks the volume as the SPOF.
      const attachedTo = s(asArray<Rec>(xmlGet(v, 'attachmentSet.item'))[0]?.instanceId);
      return {
        nativeId: s(v.volumeId) ?? '',
        name: ec2Name(v, s(v.volumeId) ?? 'vol'),
        status: state,
        health: state === 'in-use' || state === 'available' ? 'healthy' : state === 'error' ? 'critical' : 'unknown',
        tags: ec2Tags(v),
        attributes: { size: Number(s(v.size) ?? 0), type: s(v.volumeType), encrypted: s(v.encrypted) === 'true', attachedTo },
      };
    },
  },
  {
    id: 'aws_efs', domain: 'storage', label: 'EFS File Systems', resourceType: 'efs_filesystem',
    host: (r) => `elasticfilesystem.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const url = new URL(`https://${host}/2015-02-01/file-systems`);
      if (token) url.searchParams.set('Marker', token);
      const root = await awsRestJson(http, 'GET', url.toString());
      return { items: asArray<Rec>(root.FileSystems), nextToken: s(root.NextMarker) };
    },
    map: (f) => ({ nativeId: s(f.FileSystemId) ?? '', name: s(f.Name) ?? s(f.FileSystemId) ?? 'efs', status: s(f.LifeCycleState), health: s(f.LifeCycleState) === 'available' ? 'healthy' : 'unknown', attributes: { encrypted: f.Encrypted === true, mountTargets: Number(s(f.NumberOfMountTargets) ?? 0) } }),
  },
];

const DATABASES: AwsCollectorSpec[] = [
  {
    id: 'aws_rds_instances', domain: 'databases', label: 'RDS Instances', resourceType: 'rds_instance',
    host: (r) => `rds.${r}.amazonaws.com`,
    fetchPage: queryPager('DescribeDBInstances', '2014-10-31', 'DescribeDBInstancesResponse', 'DescribeDBInstancesResult.DBInstances.DBInstance', 'Marker', 'DescribeDBInstancesResult.Marker'),
    map: (db) => {
      const state = s(db.DBInstanceStatus);
      return {
        nativeId: s(db.DBInstanceIdentifier) ?? '',
        name: s(db.DBInstanceIdentifier) ?? 'db',
        status: state,
        health: state === 'available' ? 'healthy' : state === 'failed' ? 'critical' : 'unknown',
        attributes: { engine: s(db.Engine), class: s(db.DBInstanceClass), multiAz: db.MultiAZ === true || s(db.MultiAZ) === 'true', arn: s(db.DBInstanceArn) },
        relationships: [
          ...rel('hosted_by', s(xmlGet(db, 'DBSubnetGroup.VpcId'))),
          ...asArray<Rec>(xmlGet(db, 'VpcSecurityGroups.member')).flatMap((g) => rel('protected_by', s(g.VpcSecurityGroupId))),
        ],
      };
    },
  },
];

const CONTAINERS: AwsCollectorSpec[] = [
  {
    id: 'aws_eks_clusters', domain: 'containers', label: 'EKS Clusters', resourceType: 'eks_cluster',
    host: (r) => `eks.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const url = new URL(`https://${host}/clusters`);
      if (token) url.searchParams.set('nextToken', token);
      const root = await awsRestJson(http, 'GET', url.toString());
      const items = asArray<string>(root.clusters).map((name) => ({ name }));
      return { items, nextToken: s(root.nextToken) };
    },
    map: (c) => ({ nativeId: s(c.name) ?? '', name: s(c.name) ?? 'cluster' }),
  },
  {
    id: 'aws_ecs_clusters', domain: 'containers', label: 'ECS Clusters', resourceType: 'ecs_cluster',
    host: (r) => `ecs.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const root = await awsJsonRpc(http, host, 'AmazonEC2ContainerServiceV20141113.ListClusters', token ? { nextToken: token } : {});
      const items = asArray<string>(root.clusterArns).map((arn) => ({ arn }));
      return { items, nextToken: s(root.nextToken) };
    },
    map: (c) => ({ nativeId: s(c.arn) ?? '', name: (s(c.arn) ?? 'cluster').split('/').pop() ?? 'cluster' }),
  },
];

const SERVERLESS: AwsCollectorSpec[] = [
  {
    id: 'aws_lambda_functions', domain: 'serverless', label: 'Lambda Functions', resourceType: 'lambda_function',
    host: (r) => `lambda.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const url = new URL(`https://${host}/2015-03-31/functions/`);
      if (token) url.searchParams.set('Marker', token);
      const root = await awsRestJson(http, 'GET', url.toString());
      return { items: asArray<Rec>(root.Functions), nextToken: s(root.NextMarker) };
    },
    map: (fn) => ({
      nativeId: s(fn.FunctionArn) ?? s(fn.FunctionName) ?? '',
      name: s(fn.FunctionName) ?? 'function',
      status: s(fn.State),
      attributes: { runtime: s(fn.Runtime), memory: Number(s(fn.MemorySize) ?? 0), timeout: Number(s(fn.Timeout) ?? 0) },
      relationships: rel('hosted_by', s(xmlGet(fn, 'VpcConfig.VpcId'))),
    }),
  },
];

const MONITORING: AwsCollectorSpec[] = [
  {
    id: 'aws_cloudwatch_alarms', domain: 'monitoring', label: 'CloudWatch Alarms', resourceType: 'cloudwatch_alarm',
    host: (r) => `monitoring.${r}.amazonaws.com`,
    fetchPage: queryPager('DescribeAlarms', '2010-08-01', 'DescribeAlarmsResponse', 'DescribeAlarmsResult.MetricAlarms.member', 'NextToken', 'DescribeAlarmsResult.NextToken'),
    map: (a) => {
      const state = s(a.StateValue);
      return {
        nativeId: s(a.AlarmArn) ?? s(a.AlarmName) ?? '',
        name: s(a.AlarmName) ?? 'alarm',
        status: state,
        health: state === 'ALARM' ? 'critical' : state === 'OK' ? 'healthy' : 'unknown',
        attributes: { metric: s(a.MetricName), namespace: s(a.Namespace) },
      };
    },
  },
  {
    id: 'aws_cloudtrail_trails', domain: 'monitoring', label: 'CloudTrail Trails', resourceType: 'cloudtrail_trail',
    host: (r) => `cloudtrail.${r}.amazonaws.com`,
    fetchPage: async (http, host) => {
      const root = await awsJsonRpc(http, host, 'com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.DescribeTrails', {});
      return { items: asArray<Rec>(root.trailList), nextToken: null };
    },
    map: (t) => ({ nativeId: s(t.TrailARN) ?? s(t.Name) ?? '', name: s(t.Name) ?? 'trail', attributes: { bucket: s(t.S3BucketName), multiRegion: t.IsMultiRegionTrail === true }, relationships: rel('backed_by', s(t.S3BucketName)) }),
  },
];

const SECURITY_DOMAINS: AwsCollectorSpec[] = [
  {
    id: 'aws_secrets', domain: 'secrets', label: 'Secrets', resourceType: 'secret',
    host: (r) => `secretsmanager.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const root = await awsJsonRpc(http, host, 'secretsmanager.ListSecrets', token ? { NextToken: token } : {});
      return { items: asArray<Rec>(root.SecretList), nextToken: s(root.NextToken) };
    },
    map: (sec) => ({ nativeId: s(sec.ARN) ?? s(sec.Name) ?? '', name: s(sec.Name) ?? 'secret', attributes: { rotationEnabled: sec.RotationEnabled === true, kmsKeyId: s(sec.KmsKeyId) } }),
  },
  {
    id: 'aws_acm_certificates', domain: 'certificates', label: 'ACM Certificates', resourceType: 'acm_certificate',
    host: (r) => `acm.${r}.amazonaws.com`,
    fetchPage: async (http, host, token) => {
      const root = await awsJsonRpc(http, host, 'CertificateManager.ListCertificates', token ? { NextToken: token } : {});
      return { items: asArray<Rec>(root.CertificateSummaryList), nextToken: s(root.NextToken) };
    },
    map: (c) => ({ nativeId: s(c.CertificateArn) ?? '', name: s(c.DomainName) ?? 'certificate', status: s(c.Status), health: s(c.Status) === 'ISSUED' ? 'healthy' : s(c.Status) === 'EXPIRED' ? 'critical' : 'unknown', attributes: { type: s(c.Type), inUse: c.InUse === true } }),
  },
  {
    id: 'aws_route53_zones', domain: 'dns', label: 'Route 53 Hosted Zones', resourceType: 'hosted_zone', global: true,
    host: () => 'route53.amazonaws.com',
    fetchPage: async (http, _host, token) => {
      const url = new URL('https://route53.amazonaws.com/2013-04-01/hostedzone');
      if (token) url.searchParams.set('marker', token);
      const root = await awsRestXml(http, 'GET', url.toString());
      return { items: asArray<Rec>(xmlGet(root, 'ListHostedZonesResponse.HostedZones.HostedZone')), nextToken: s(xmlGet(root, 'ListHostedZonesResponse.NextMarker')) };
    },
    map: (z) => ({ nativeId: s(z.Id) ?? '', name: s(z.Name) ?? 'zone', attributes: { private: xmlGet(z, 'Config.PrivateZone') === 'true', records: Number(s(z.ResourceRecordSetCount) ?? 0) } }),
  },
];

/** Every AWS collector, across the twelve infrastructure domains. */
export const AWS_COLLECTORS: DomainCollector[] = [
  ...IDENTITY,
  ...COMPUTE,
  ...NETWORKING,
  ...STORAGE,
  ...DATABASES,
  ...CONTAINERS,
  ...SERVERLESS,
  ...MONITORING,
  ...SECURITY_DOMAINS,
].map(makeCollector);
