/**
 * P6.1 — AWS automation actions + the confirmation-gated executor.
 *
 * Each action is exercised through the real `InfraActionExecutor` against a fake signed transport (canned
 * provider responses), proving: the confirmation gate refuses a mutation without `confirmed` (and never
 * touches the provider), the per-protocol request is built correctly (host / region / body / target), the
 * response is mapped to a non-sensitive summary, region resolution (param overrides account, global services
 * ignore it), the started→completed|failed audit fan-out, and error classification (a 403 becomes a
 * least-privilege message). Pure-node; no live AWS.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { AWS_ACTIONS } from './awsActions';

const NOW = '2026-07-13T00:00:00.000Z';

function harness(router: (req: DiscoveryRequest) => { text?: string; error?: Error }, region = 'eu-west-1') {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      if (r.error) throw r.error;
      return { status: 200, headers: {}, text: r.text ?? '' };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => region, ownsAccount: () => true, /* P13C R7 — these suites act AS the owning tenant; cross-tenant refusal is asserted in infrastructureTenancy.test.ts */ now: () => NOW },
    AWS_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);

describe('InfraActionExecutor — confirmation gate (the hard AI-can-never-mutate guarantee)', () => {
  it('refuses a mutating action without confirmation and NEVER calls the provider', async () => {
    const { exec, events, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('aws', '111', 'aws_ec2_stop', { instanceId: 'i-1' }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0); // provider never touched
    expect(events).toHaveLength(0); // not even a started event
  });

  it('an unknown action id fails closed', async () => {
    const { exec } = harness(() => ({ text: '' }));
    const res = await exec.execute('aws', '111', 'aws_nope', {}, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Unknown action');
  });

  it('a missing required field fails with a clear message (provider not called)', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('aws', '111', 'aws_ec2_start', {}, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Missing required field "instanceId"');
    expect(requests).toHaveLength(0);
  });

  it('a crafted region is REJECTED before any host is built (no signed request escapes AWS)', async () => {
    // Region is interpolated into the signing host; a value like `evil.com/x` would otherwise make the host
    // resolve to `ec2.evil.com` and ship the Authorization header + session token off-AWS. It must fail closed.
    const { exec, requests, events } = harness(() => ({ text: '<x/>' }));
    const res = await exec.execute('aws', '111', 'aws_ec2_stop', { instanceId: 'i-1', region: 'evil.com/x' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Invalid AWS region');
    expect(requests).toHaveLength(0); // provider transport never invoked
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('accepts a well-formed GovCloud region', async () => {
    const page = '<StopInstancesResponse><instancesSet><item><instanceId>i-1</instanceId><currentState><name>stopping</name></currentState><previousState><name>running</name></previousState></item></instancesSet></StopInstancesResponse>';
    const { exec, requests } = harness(() => ({ text: page }));
    const res = await exec.execute('aws', '111', 'aws_ec2_stop', { instanceId: 'i-1', region: 'us-gov-west-1' }, true);
    expect(res.ok).toBe(true);
    expect(new URL(requests[0].url).hostname).toBe('ec2.us-gov-west-1.amazonaws.com');
  });
});

describe('AWS EC2 actions (query protocol)', () => {
  it('Start maps previous → current state, honors the region param, and audits started→completed', async () => {
    const page = '<StartInstancesResponse><instancesSet><item><instanceId>i-1</instanceId><currentState><name>pending</name></currentState><previousState><name>stopped</name></previousState></item></instancesSet></StartInstancesResponse>';
    const { exec, events, requests } = harness(() => ({ text: page }));
    const res = await exec.execute('aws', '111', 'aws_ec2_start', { instanceId: 'i-1', region: 'us-west-2' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toBe('EC2 i-1: stopped → pending');
    expect(res.data).toMatchObject({ instanceId: 'i-1', previousState: 'stopped', currentState: 'pending' });
    expect(new URL(requests[0].url).hostname).toBe('ec2.us-west-2.amazonaws.com'); // param overrides account region
    expect(requests[0].body).toContain('Action=StartInstances');
    expect(requests[0].body).toContain('InstanceId.1=i-1');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('Stop maps to the stopping transition', async () => {
    const page = '<StopInstancesResponse><instancesSet><item><instanceId>i-2</instanceId><currentState><name>stopping</name></currentState><previousState><name>running</name></previousState></item></instancesSet></StopInstancesResponse>';
    const { exec, requests } = harness(() => ({ text: page }));
    const res = await exec.execute('aws', '111', 'aws_ec2_stop', { instanceId: 'i-2' }, true);
    expect(res.message).toBe('EC2 i-2: running → stopping');
    expect(requests[0].body).toContain('Action=StopInstances');
    expect(new URL(requests[0].url).hostname).toBe('ec2.eu-west-1.amazonaws.com'); // falls back to account region
  });

  it('Reboot issues RebootInstances and reports a request-accepted summary', async () => {
    const { exec, requests } = harness(() => ({ text: '<RebootInstancesResponse><return>true</return></RebootInstancesResponse>' }));
    const res = await exec.execute('aws', '111', 'aws_ec2_reboot', { instanceId: 'i-9' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Reboot requested for EC2 i-9');
    expect(requests[0].body).toContain('Action=RebootInstances');
  });
});

describe('AWS RDS + Secrets + CloudFront actions', () => {
  it('Reboot RDS (query) maps the DB status and targets the rds host', async () => {
    const resp = '<RebootDBInstanceResponse><RebootDBInstanceResult><DBInstance><DBInstanceIdentifier>db-1</DBInstanceIdentifier><DBInstanceStatus>rebooting</DBInstanceStatus></DBInstance></RebootDBInstanceResult></RebootDBInstanceResponse>';
    const { exec, requests } = harness(() => ({ text: resp }));
    const res = await exec.execute('aws', '111', 'aws_rds_reboot', { dbInstanceId: 'db-1' }, true);
    expect(res.message).toBe('RDS db-1: rebooting');
    expect(new URL(requests[0].url).hostname).toBe('rds.eu-west-1.amazonaws.com');
    expect(requests[0].body).toContain('DBInstanceIdentifier=db-1');
  });

  it('Rotate Secret (json-rpc) uses X-Amz-Target + SecretId and maps name/version', async () => {
    const { exec, requests } = harness(() => ({ text: JSON.stringify({ ARN: 'arn:aws:secretsmanager:eu-west-1:111:secret:db', Name: 'db-pass', VersionId: 'v-1' }) }));
    const res = await exec.execute('aws', '111', 'aws_secret_rotate', { secretId: 'prod/db' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Rotation started for secret db-pass');
    expect(res.data).toMatchObject({ name: 'db-pass', versionId: 'v-1' });
    expect(requests[0].headers?.['X-Amz-Target']).toBe('secretsmanager.RotateSecret');
    expect(new URL(requests[0].url).hostname).toBe('secretsmanager.eu-west-1.amazonaws.com');
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ SecretId: 'prod/db' });
  });

  it('Invalidate CloudFront (rest-xml, GLOBAL) posts a batch and ignores the run region', async () => {
    const { exec, requests } = harness(() => ({ text: '<Invalidation><Id>I2J0</Id><Status>InProgress</Status></Invalidation>' }));
    const res = await exec.execute('aws', '111', 'aws_cloudfront_invalidate', { distributionId: 'E123', paths: '/a, /b/*' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('CloudFront invalidation I2J0');
    expect(res.data).toMatchObject({ distributionId: 'E123', invalidationId: 'I2J0', status: 'InProgress', paths: 2 });
    const req = requests[0];
    expect(req.method).toBe('POST');
    expect(new URL(req.url).hostname).toBe('cloudfront.amazonaws.com'); // global — never regionalized
    expect(req.url).toContain('/2020-05-31/distribution/E123/invalidation');
    expect(req.body).toContain('<Quantity>2</Quantity>');
    expect(req.body).toContain('<Path>/a</Path>');
    expect(req.body).toContain('<Path>/b/*</Path>');
    expect(req.headers?.['x-amz-content-sha256']).toBeTruthy(); // REST-XML always sends the payload hash
  });

  it('Invalidate CloudFront defaults to purging /* when no paths are given', async () => {
    const { exec, requests } = harness(() => ({ text: '<Invalidation><Id>I9</Id><Status>InProgress</Status></Invalidation>' }));
    const res = await exec.execute('aws', '111', 'aws_cloudfront_invalidate', { distributionId: 'E9' }, true);
    expect(res.data).toMatchObject({ paths: 1 });
    expect(requests[0].body).toContain('<Quantity>1</Quantity>');
    expect(requests[0].body).toContain('<Path>/*</Path>');
  });
});

describe('InfraActionExecutor — audit + error classification', () => {
  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('AccessDenied', 403) }));
    const res = await exec.execute('aws', '111', 'aws_ec2_stop', { instanceId: 'i-1' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('the catalog lists exactly the six high-privilege actions, every one mutating + high risk', () => {
    const { exec } = harness(() => ({ text: '' }));
    const cat = exec.list('aws');
    expect(cat.map((a) => a.id).sort()).toEqual(
      ['aws_cloudfront_invalidate', 'aws_ec2_reboot', 'aws_ec2_start', 'aws_ec2_stop', 'aws_rds_reboot', 'aws_secret_rotate'].sort(),
    );
    expect(cat.every((a) => a.mutates && a.risk === 'high')).toBe(true);
    // Each action declares its target resource type + at least the id param.
    expect(cat.every((a) => a.targetResourceType && a.params.some((p) => p.required))).toBe(true);
  });
});
