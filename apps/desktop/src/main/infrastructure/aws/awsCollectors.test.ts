/**
 * P6.1 — the AWS DomainCollectors: XML/JSON parsing, per-protocol discovery (query-XML, JSON-RPC, REST-JSON,
 * REST-XML), pagination, run-scoped incremental cursor, relationship mapping, and Resource Graph projection.
 * Pure-node; the SigV4 transport is faked (canned AWS responses), so the mapping logic is fully covered.
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResourceId,
  toDiscoveryCursor,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { AWS_COLLECTORS } from './awsCollectors';
import { parseXml, asArray, xmlGet } from './awsXml';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => AWS_COLLECTORS.find((c) => c.id === id)!;

/** A fake signed transport routing by AWS Action (query body) / X-Amz-Target (json-rpc) / URL path (rest). */
function fakeAws(router: (req: DiscoveryRequest) => { status?: number; text: string }): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const r = router(req);
      if (r.status && r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
      return { status: r.status ?? 200, headers: {}, text: r.text };
    },
  };
}
const ctx = (http: DiscoveryHttp, cursor: string | null = null, region = 'us-east-1'): DiscoveryContext =>
  ({ platformId: 'aws', accountId: '111', region, cursor, now: NOW, http });

describe('AWS XML parser', () => {
  it('parses nested + repeated elements, collapsing leaves and arraying repeats', () => {
    const x = parseXml('<R><Users><member><Name>a</Name></member><member><Name>b</Name></member></Users><Truncated>false</Truncated></R>');
    const members = asArray<Record<string, unknown>>(xmlGet(x, 'R.Users.member'));
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.Name)).toEqual(['a', 'b']);
    expect(xmlGet(x, 'R.Truncated')).toBe('false');
  });
  it('a single child is a scalar/object (asArray normalizes)', () => {
    const x = parseXml('<R><Buckets><Bucket><Name>only</Name></Bucket></Buckets></R>');
    expect(asArray(xmlGet(x, 'R.Buckets.Bucket'))).toHaveLength(1);
  });
  it('decodes entities', () => {
    expect(xmlGet(parseXml('<R><V>a &amp; b &lt;c&gt;</V></R>'), 'R.V')).toBe('a & b <c>');
  });
});

describe('AWS collectors — query protocol (EC2) with nested sets + pagination + relationships', () => {
  const page1 = `<DescribeInstancesResponse><reservationSet><item><instancesSet><item>
    <instanceId>i-123</instanceId><instanceType>t3.micro</instanceType>
    <instanceState><code>16</code><name>running</name></instanceState>
    <vpcId>vpc-1</vpcId><subnetId>subnet-1</subnetId>
    <groupSet><item><groupId>sg-1</groupId></item></groupSet>
    <tagSet><item><key>Name</key><value>web</value></item></tagSet>
  </item></instancesSet></item></reservationSet><nextToken>TOK2</nextToken></DescribeInstancesResponse>`;
  const page2 = `<DescribeInstancesResponse><reservationSet><item><instancesSet><item>
    <instanceId>i-456</instanceId><instanceState><name>stopped</name></instanceState><vpcId>vpc-1</vpcId><subnetId>subnet-1</subnetId>
  </item></instancesSet></item></reservationSet></DescribeInstancesResponse>`;

  it('maps an instance with its state, tags, and member_of/hosted_by/protected_by relationships', async () => {
    const http = fakeAws((req) => ({ text: (req.body ?? '').includes('NextToken=TOK2') ? page2 : page1 }));
    const p1 = await collector('aws_ec2_instances').collect(ctx(http));
    expect(p1.resources).toHaveLength(1);
    const e = p1.resources[0];
    expect(e.id).toBe(makeResourceId('aws', '111', 'ec2_instance', 'i-123'));
    expect(e.name).toBe('web'); // Name tag
    expect(e.status).toBe('running');
    expect(e.health).toBe('healthy');
    expect(e.relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual(['hosted_by:vpc-1', 'member_of:subnet-1', 'protected_by:sg-1']);
    expect(p1.hasMore).toBe(true);
  });

  it('paginates via nextToken (run-scoped) and drains', async () => {
    const http = fakeAws((req) => ({ text: (req.body ?? '').includes('NextToken=TOK2') ? page2 : page1 }));
    const p1 = await collector('aws_ec2_instances').collect(ctx(http));
    expect(JSON.parse(p1.cursor as string)).toEqual({ token: 'TOK2', runAt: NOW });
    const p2 = await collector('aws_ec2_instances').collect(ctx(http, p1.cursor));
    expect(p2.resources[0].nativeId).toBe('i-456');
    expect(p2.resources[0].health).toBe('degraded'); // stopped
    expect(p2.hasMore).toBe(false);
    expect(p2.cursor).toBeNull();
  });

  it('drops a STALE cross-run pagination token (a fresh run restarts the snapshot)', async () => {
    let sawToken = false;
    const http = fakeAws((req) => {
      if ((req.body ?? '').includes('NextToken=STALE')) sawToken = true;
      return { text: page1 };
    });
    // A cursor minted in a PRIOR run (runAt ≠ ctx.now) must not be replayed.
    await collector('aws_ec2_instances').collect(ctx(http, toDiscoveryCursor({ token: 'STALE', runAt: '2020-01-01T00:00:00.000Z' })));
    expect(sawToken).toBe(false);
  });
});

describe('AWS collectors — IAM (query, global, Marker pagination)', () => {
  it('discovers IAM users against the global endpoint', async () => {
    let host = '';
    const http = fakeAws((req) => {
      host = new URL(req.url).hostname;
      return { text: '<ListUsersResponse><ListUsersResult><Users><member><UserId>AIDA1</UserId><UserName>alice</UserName><Arn>arn:aws:iam::111:user/alice</Arn></member><member><UserId>AIDA2</UserId><UserName>bob</UserName></member></Users></ListUsersResult></ListUsersResponse>' };
    });
    const p = await collector('aws_iam_users').collect(ctx(http, null, 'eu-west-1'));
    expect(host).toBe('iam.amazonaws.com'); // global — ignores the run region
    expect(p.resources.map((r) => r.name)).toEqual(['alice', 'bob']);
    expect(p.resources[0].id).toBe(makeResourceId('aws', '111', 'iam_user', 'AIDA1'));
    expect(p.resources[0].attributes.arn).toBe('arn:aws:iam::111:user/alice');
  });
});

describe('AWS collectors — REST-JSON (Lambda) + JSON-RPC (Secrets Manager) + REST-XML (S3)', () => {
  it('Lambda functions (rest-json) map runtime + hosted_by VPC', async () => {
    const http = fakeAws(() => ({ text: JSON.stringify({ Functions: [{ FunctionName: 'fn1', FunctionArn: 'arn:aws:lambda:us-east-1:111:function:fn1', Runtime: 'nodejs20.x', State: 'Active', VpcConfig: { VpcId: 'vpc-1' } }] }) }));
    const p = await collector('aws_lambda_functions').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('arn:aws:lambda:us-east-1:111:function:fn1');
    expect(p.resources[0].attributes.runtime).toBe('nodejs20.x');
    expect(p.resources[0].relationships).toEqual([{ type: 'hosted_by', targetId: 'vpc-1' }]);
  });

  it('Secrets Manager (json-rpc) uses X-Amz-Target and NextToken', async () => {
    let target = '';
    const http = fakeAws((req) => {
      target = req.headers?.['X-Amz-Target'] ?? '';
      return { text: JSON.stringify({ SecretList: [{ ARN: 'arn:aws:secretsmanager:us-east-1:111:secret:db', Name: 'db-pass', RotationEnabled: true }] }) };
    });
    const p = await collector('aws_secrets').collect(ctx(http));
    expect(target).toBe('secretsmanager.ListSecrets');
    expect(p.resources[0].name).toBe('db-pass');
    expect(p.resources[0].attributes.rotationEnabled).toBe(true);
  });

  it('S3 buckets (rest-xml, global) map from ListAllMyBucketsResult', async () => {
    const http = fakeAws(() => ({ text: '<ListAllMyBucketsResult><Buckets><Bucket><Name>logs</Name><CreationDate>2020-01-01T00:00:00Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>' }));
    const p = await collector('aws_s3_buckets').collect(ctx(http));
    expect(p.resources[0].id).toBe(makeResourceId('aws', '111', 's3_bucket', 'logs'));
    expect(p.hasMore).toBe(false);
  });
});

describe('AWS collectors — Resource Graph projection with resolved relationships', () => {
  it('discovers VPC + subnet + instance + volume and the graph resolves every edge', async () => {
    const subnetHttp = fakeAws(() => ({ text: '<DescribeSubnetsResponse><subnetSet><item><subnetId>subnet-1</subnetId><vpcId>vpc-1</vpcId><cidrBlock>10.0.1.0/24</cidrBlock></item></subnetSet></DescribeSubnetsResponse>' }));
    const vpcHttp = fakeAws(() => ({ text: '<DescribeVpcsResponse><vpcSet><item><vpcId>vpc-1</vpcId><cidrBlock>10.0.0.0/16</cidrBlock></item></vpcSet></DescribeVpcsResponse>' }));
    const instHttp = fakeAws(() => ({ text: '<DescribeInstancesResponse><reservationSet><item><instancesSet><item><instanceId>i-1</instanceId><instanceState><name>running</name></instanceState><vpcId>vpc-1</vpcId><subnetId>subnet-1</subnetId><blockDeviceMapping><item><ebs><volumeId>vol-1</volumeId></ebs></item></blockDeviceMapping></item></instancesSet></item></reservationSet></DescribeInstancesResponse>' }));
    const volHttp = fakeAws(() => ({ text: '<DescribeVolumesResponse><volumeSet><item><volumeId>vol-1</volumeId><size>100</size><status>in-use</status><attachmentSet><item><instanceId>i-1</instanceId></item></attachmentSet></volumeSet></DescribeVolumesResponse>' }));

    const resources = [
      ...(await collector('aws_vpcs').collect(ctx(vpcHttp))).resources,
      ...(await collector('aws_subnets').collect(ctx(subnetHttp))).resources,
      ...(await collector('aws_ec2_instances').collect(ctx(instHttp))).resources,
      ...(await collector('aws_ebs_volumes').collect(ctx(volHttp))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(4);
    // subnet member_of vpc; instance member_of subnet + hosted_by vpc + attached_to volume = 4 edges.
    expect(model.edges).toHaveLength(4);
    const byType = model.edges.map((e) => e.type).sort();
    expect(byType).toEqual(['attached_to', 'hosted_by', 'member_of', 'member_of']);
    // The instance declares `attached_to` → volume, so the volume is a blast-radius target (its loss impacts
    // the instance that depends on it) — the SPOF ranking surfaces it.
    const volId = makeResourceId('aws', '111', 'ebs_volume', 'vol-1');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === volId)).toBe(true);
    // And the edge points instance → volume (dependent → dependency), never the reverse.
    expect(model.edges.find((e) => e.type === 'attached_to')).toMatchObject({
      from: makeResourceId('aws', '111', 'ec2_instance', 'i-1'),
      to: volId,
    });
  });
});

describe('AWS platform — one adapter, all domains', () => {
  it('the adapter exposes collectors across all twelve infrastructure domains', () => {
    const domains = new Set(AWS_COLLECTORS.map((c) => c.domain));
    for (const d of ['identity', 'compute', 'networking', 'storage', 'databases', 'containers', 'serverless', 'monitoring', 'secrets', 'certificates', 'dns'] as const) {
      expect(domains.has(d)).toBe(true);
    }
    expect(AWS_COLLECTORS.length).toBeGreaterThanOrEqual(20);
  });
});
