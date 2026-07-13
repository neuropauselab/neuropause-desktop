/**
 * P6.1 — AWS automation actions (HIGH PRIVILEGE).
 *
 * Six confirmation-gated mutations against the AWS Cloud Platform, each a single signed provider call over the
 * SAME transport discovery uses (the per-protocol helpers in `awsClient`): Start/Stop/Reboot an EC2 instance,
 * Reboot an RDS database, Rotate a Secrets Manager secret, and Invalidate a CloudFront distribution. Every one
 * is `mutates: true` + `risk: 'high'`, so the executor refuses it without an explicit human confirmation and
 * AI can never reach it. Discovery runs read-only; these actions are the only writes, and AWS IAM enforces
 * whether the credential profile is actually permitted to run them (least privilege, provider-side).
 */
import { asArray, awsJsonRpc, awsQuery, awsRestXml, xmlGet, AWS_REGION_RE } from './awsClient';
import { reqStr, optStr, InfraActionInputError, type InfraAction, type InfraActionContext, type InfraActionParams } from '../actionSdk';

/** Reject a malformed region BEFORE it is interpolated into a signing host — a crafted region must never be
 *  able to redirect a signed request (Authorization + session token) off AWS. Defense-in-depth with the
 *  transport-layer `isAwsHost` guard. */
function region(r: string): string {
  if (!AWS_REGION_RE.test(r)) throw new InfraActionInputError(`Invalid AWS region "${r}"`);
  return r;
}
const ec2Host = (r: string): string => `ec2.${region(r)}.amazonaws.com`;
const EC2_VERSION = '2016-11-15';

/** XML-escape a text value for a REST-XML request body. */
function xmlEscape(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Run a single-instance EC2 state transition (Start/Stop) and report previous → current state. */
async function ec2Transition(ctx: InfraActionContext, action: string, respRoot: string, instanceId: string): Promise<{ ok: boolean; summary: string; data: Record<string, string> }> {
  const root = await awsQuery(ctx.http, ec2Host(ctx.region), action, EC2_VERSION, { 'InstanceId.1': instanceId });
  const item = asArray<Record<string, unknown>>(xmlGet(root, `${respRoot}.instancesSet.item`))[0] ?? {};
  const current = String(xmlGet(item, 'currentState.name') ?? 'unknown');
  const previous = String(xmlGet(item, 'previousState.name') ?? 'unknown');
  return { ok: true, summary: `EC2 ${instanceId}: ${previous} → ${current}`, data: { instanceId, previousState: previous, currentState: current } };
}

export const AWS_ACTIONS: InfraAction[] = [
  {
    id: 'aws_ec2_start', label: 'Start EC2 Instance', platformId: 'aws', domain: 'compute',
    description: 'Starts a stopped EC2 instance.', mutates: true, risk: 'high', targetResourceType: 'ec2_instance',
    params: [
      { key: 'instanceId', label: 'Instance ID', required: true, hint: 'i-0123456789abcdef0' },
      { key: 'region', label: 'Region', required: false, hint: 'defaults to the account’s discovered region' },
    ],
    run: (ctx, p) => ec2Transition(ctx, 'StartInstances', 'StartInstancesResponse', reqStr(p, 'instanceId')),
  },
  {
    id: 'aws_ec2_stop', label: 'Stop EC2 Instance', platformId: 'aws', domain: 'compute',
    description: 'Stops a running EC2 instance.', mutates: true, risk: 'high', targetResourceType: 'ec2_instance',
    params: [
      { key: 'instanceId', label: 'Instance ID', required: true, hint: 'i-0123456789abcdef0' },
      { key: 'region', label: 'Region', required: false },
    ],
    run: (ctx, p) => ec2Transition(ctx, 'StopInstances', 'StopInstancesResponse', reqStr(p, 'instanceId')),
  },
  {
    id: 'aws_ec2_reboot', label: 'Reboot EC2 Instance', platformId: 'aws', domain: 'compute',
    description: 'Reboots an EC2 instance (a graceful OS restart).', mutates: true, risk: 'high', targetResourceType: 'ec2_instance',
    params: [
      { key: 'instanceId', label: 'Instance ID', required: true, hint: 'i-0123456789abcdef0' },
      { key: 'region', label: 'Region', required: false },
    ],
    run: async (ctx, p) => {
      const instanceId = reqStr(p, 'instanceId');
      await awsQuery(ctx.http, ec2Host(ctx.region), 'RebootInstances', EC2_VERSION, { 'InstanceId.1': instanceId });
      return { ok: true, summary: `Reboot requested for EC2 ${instanceId}`, data: { instanceId } };
    },
  },
  {
    id: 'aws_rds_reboot', label: 'Reboot RDS Instance', platformId: 'aws', domain: 'databases',
    description: 'Reboots an RDS database instance.', mutates: true, risk: 'high', targetResourceType: 'rds_instance',
    params: [
      { key: 'dbInstanceId', label: 'DB Instance Identifier', required: true, hint: 'my-database-1' },
      { key: 'region', label: 'Region', required: false },
    ],
    run: async (ctx, p) => {
      const dbId = reqStr(p, 'dbInstanceId');
      const root = await awsQuery(ctx.http, `rds.${region(ctx.region)}.amazonaws.com`, 'RebootDBInstance', '2014-10-31', { DBInstanceIdentifier: dbId });
      const status = String(xmlGet(root, 'RebootDBInstanceResponse.RebootDBInstanceResult.DBInstance.DBInstanceStatus') ?? 'rebooting');
      return { ok: true, summary: `RDS ${dbId}: ${status}`, data: { dbInstanceId: dbId, status } };
    },
  },
  {
    id: 'aws_secret_rotate', label: 'Rotate Secret', platformId: 'aws', domain: 'secrets',
    description: 'Starts rotation of a Secrets Manager secret (requires a rotation Lambda configured).', mutates: true, risk: 'high', targetResourceType: 'secret',
    params: [
      { key: 'secretId', label: 'Secret ID or ARN', required: true, hint: 'prod/db/password' },
      { key: 'region', label: 'Region', required: false },
    ],
    run: async (ctx, p) => {
      const secretId = reqStr(p, 'secretId');
      const res = await awsJsonRpc(ctx.http, `secretsmanager.${region(ctx.region)}.amazonaws.com`, 'secretsmanager.RotateSecret', { SecretId: secretId });
      const name = String(res.Name ?? secretId);
      const versionId = String(res.VersionId ?? '');
      return { ok: true, summary: `Rotation started for secret ${name}`, data: { secretId, name, versionId } };
    },
  },
  {
    id: 'aws_cloudfront_invalidate', label: 'Invalidate CloudFront Cache', platformId: 'aws', domain: 'networking',
    description: 'Creates a CloudFront invalidation to purge cached paths at the edge.', mutates: true, risk: 'high', targetResourceType: 'cloudfront_distribution',
    params: [
      { key: 'distributionId', label: 'Distribution ID', required: true, hint: 'E1A2B3C4D5E6F7' },
      { key: 'paths', label: 'Paths (comma-separated)', required: false, hint: 'defaults to /*' },
    ],
    run: async (ctx, p) => {
      const distributionId = reqStr(p, 'distributionId');
      const raw = optStr(p, 'paths') ?? '/*';
      const paths = raw.split(',').map((x) => x.trim()).filter(Boolean);
      if (paths.length === 0) paths.push('/*'); // a comma-only / whitespace input must still purge something valid
      const items = paths.map((path) => `<Path>${xmlEscape(path)}</Path>`).join('');
      // CloudFront requires a unique CallerReference per distribution; the execution instant makes it unique
      // (and re-invoking with the SAME reference + batch is idempotent AWS-side).
      const callerRef = `neuropause-${ctx.now}`;
      const body = `<?xml version="1.0" encoding="UTF-8"?><InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><CallerReference>${xmlEscape(callerRef)}</CallerReference><Paths><Quantity>${paths.length}</Quantity><Items>${items}</Items></Paths></InvalidationBatch>`;
      const root = await awsRestXml(ctx.http, 'POST', `https://cloudfront.amazonaws.com/2020-05-31/distribution/${encodeURIComponent(distributionId)}/invalidation`, body);
      const id = String(xmlGet(root, 'Invalidation.Id') ?? '');
      const status = String(xmlGet(root, 'Invalidation.Status') ?? 'InProgress');
      return { ok: true, summary: `CloudFront invalidation ${id || '(created)'} — ${status} for ${paths.length} path(s)`, data: { distributionId, invalidationId: id, status, paths: paths.length } };
    },
  },
];

/** Bind the AWS actions into an id→action map (used by the executor registration). */
export function awsActions(): InfraAction[] {
  return AWS_ACTIONS;
}

export type { InfraActionParams };
