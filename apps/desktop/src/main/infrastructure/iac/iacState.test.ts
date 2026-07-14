/**
 * P6.10 — the IaC STATE parser: Terraform v4 address derivation (module/count/for_each/data), dependency
 * extraction, provider FQN parsing, output shaping, sensitive-attribute redaction, flavor voting; Pulumi URN
 * parsing, provider-ref resolution, stack-output extraction, secret-signature redaction; and the huge-state bound.
 * Pure-node — no live backend.
 */
import { describe, expect, it } from 'vitest';
import { MAX_RESOURCES, parsePulumiState, parsePulumiUrn, parseTerraformProvider, parseTerraformState } from './iacState';

describe('parseTerraformState', () => {
  const state = {
    version: 4,
    terraform_version: '1.9.5',
    serial: 7,
    lineage: 'lin-1',
    outputs: {
      ip: { value: '10.0.0.5', type: 'string' },
      pw: { value: 's3cr3t', type: 'string', sensitive: true },
    },
    resources: [
      {
        mode: 'managed', type: 'aws_instance', name: 'web', provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [{ attributes: { id: 'i-0abc', instance_type: 't3.micro', password: 'S3', tags: { a: 'b' } }, sensitive_attributes: [[{ type: 'get_attr', value: 'password' }]], dependencies: ['aws_security_group.web'] }],
      },
      { mode: 'managed', type: 'aws_security_group', name: 'web', provider: 'provider["registry.terraform.io/hashicorp/aws"]', instances: [{ attributes: { id: 'sg-1' } }] },
      { mode: 'managed', type: 'aws_instance', name: 'app', module: 'module.app', provider: 'provider["registry.terraform.io/hashicorp/aws"]', instances: [{ index_key: 0, attributes: { id: 'i-1' } }] },
      { mode: 'data', type: 'aws_ami', name: 'ubuntu', provider: 'provider["registry.terraform.io/hashicorp/aws"]', instances: [{ attributes: { id: 'ami-9' } }] },
    ],
  };

  it('parses version keys + flavor (terraform by default registry host)', () => {
    const m = parseTerraformState(state);
    expect(m.flavor).toBe('terraform');
    expect(m.serial).toBe(7);
    expect(m.lineage).toBe('lin-1');
    expect(m.providers).toEqual(['registry.terraform.io/hashicorp/aws']);
  });

  it('derives addresses (root / module+count / data)', () => {
    const addrs = parseTerraformState(state).resources.map((r) => r.address).sort();
    expect(addrs).toEqual(['aws_instance.web', 'aws_security_group.web', 'data.aws_ami.ubuntu', 'module.app.aws_instance.app[0]'].sort());
  });

  it('extracts dependencies and redacts sensitive attributes', () => {
    const web = parseTerraformState(state).resources.find((r) => r.address === 'aws_instance.web')!;
    expect(web.dependencies).toEqual(['aws_security_group.web']);
    expect(web.attributes.instance_type).toBe('t3.micro');
    expect('password' in web.attributes).toBe(false); // sensitive → dropped
    expect('tags' in web.attributes).toBe(false); // non-scalar → dropped
  });

  it('shapes outputs with sensitivity + type', () => {
    const outs = parseTerraformState(state).outputs;
    expect(outs).toEqual([
      { name: 'ip', sensitive: false, type: 'string' },
      { name: 'pw', sensitive: true, type: 'string' },
    ]);
  });

  it('votes opentofu when the registry host is registry.opentofu.org', () => {
    const tofu = { version: 4, resources: [{ mode: 'managed', type: 'random_id', name: 'x', provider: 'provider["registry.opentofu.org/hashicorp/random"]', instances: [{ attributes: { id: '1' } }] }] };
    expect(parseTerraformState(tofu).flavor).toBe('opentofu');
    expect(parseTerraformState(tofu, 'terraform').flavor).toBe('terraform'); // an explicit hint wins
  });

  it('bounds a huge state deterministically (address-sorted keep + droppedCount)', () => {
    const many = { version: 4, resources: Array.from({ length: MAX_RESOURCES + 5 }, (_, i) => ({ mode: 'managed', type: 'null_resource', name: `n${String(i).padStart(6, '0')}`, provider: 'provider["registry.terraform.io/hashicorp/null"]', instances: [{ attributes: { id: String(i) } }] })) };
    const m = parseTerraformState(many);
    expect(m.resources).toHaveLength(MAX_RESOURCES);
    expect(m.truncated).toBe(true);
    expect(m.droppedCount).toBe(5);
  });
});

describe('parseTerraformProvider', () => {
  it('splits a provider ref into FQN + short name', () => {
    expect(parseTerraformProvider('provider["registry.terraform.io/hashicorp/aws"]')).toEqual({ fqn: 'registry.terraform.io/hashicorp/aws', name: 'aws' });
    expect(parseTerraformProvider('provider["registry.terraform.io/hashicorp/aws"].us_east_1').name).toBe('aws');
  });
});

describe('parsePulumiUrn', () => {
  it('parses stack / project / own-type / name (type ancestry → last $-segment)', () => {
    expect(parsePulumiUrn('urn:pulumi:prod::web::aws:s3/bucket:Bucket::assets')).toEqual({ stack: 'prod', project: 'web', type: 'aws:s3/bucket:Bucket', name: 'assets' });
    expect(parsePulumiUrn('urn:pulumi:prod::web::pulumi:pulumi:Stack$aws:s3/bucket:Bucket::assets').type).toBe('aws:s3/bucket:Bucket');
  });
});

describe('parsePulumiState', () => {
  const deployment = {
    version: 3,
    deployment: {
      manifest: { version: 'v3.115.0' },
      resources: [
        { urn: 'urn:pulumi:prod::web::pulumi:pulumi:Stack::web-prod', custom: false, type: 'pulumi:pulumi:Stack', outputs: { bucketName: 'b-1', token: { '4dabf18193072939515e22adb298388d': 'sig', ciphertext: 'zzz' } } },
        { urn: 'urn:pulumi:prod::web::pulumi:providers:aws::default_6', custom: true, id: 'uuid-1', type: 'pulumi:providers:aws', inputs: { region: 'us-east-1' } },
        { urn: 'urn:pulumi:prod::web::aws:s3/bucket:Bucket::assets', custom: true, id: 'b-1', type: 'aws:s3/bucket:Bucket', outputs: { arn: 'arn:aws:s3:::b-1' }, parent: 'urn:pulumi:prod::web::pulumi:pulumi:Stack::web-prod', provider: 'urn:pulumi:prod::web::pulumi:providers:aws::default_6::uuid-1' },
        { urn: 'urn:pulumi:prod::web::aws:s3/bucketPolicy:BucketPolicy::pol', custom: true, id: 'b-1', type: 'aws:s3/bucketPolicy:BucketPolicy', parent: 'urn:pulumi:prod::web::aws:s3/bucket:Bucket::assets', dependencies: ['urn:pulumi:prod::web::aws:s3/bucket:Bucket::assets'] },
      ],
    },
  };

  it('normalizes resources with mode, provider pkg, parent + dependencies', () => {
    const m = parsePulumiState(deployment);
    expect(m.flavor).toBe('pulumi');
    expect(m.writerVersion).toBe('v3.115.0');
    const bucket = m.resources.find((r) => r.type === 'aws:s3/bucket:Bucket')!;
    expect(bucket.mode).toBe('managed');
    expect(bucket.providerName).toBe('aws');
    expect(bucket.parentAddress).toContain('pulumi:pulumi:Stack');
    expect(bucket.attributes.arn).toBe('arn:aws:s3:::b-1');
    const policy = m.resources.find((r) => r.type === 'aws:s3/bucketPolicy:BucketPolicy')!;
    expect(policy.dependencies).toEqual(['urn:pulumi:prod::web::aws:s3/bucket:Bucket::assets']);
  });

  it('extracts stack outputs from the root Stack resource and redacts the secret signature', () => {
    const m = parsePulumiState(deployment);
    expect(m.outputs.map((o) => o.name).sort()).toEqual(['bucketName', 'token']);
    expect(m.outputs.find((o) => o.name === 'token')!.sensitive).toBe(true);
    // the ciphertext value never surfaces as an attribute anywhere
    expect(JSON.stringify(m)).not.toContain('zzz');
  });
});
