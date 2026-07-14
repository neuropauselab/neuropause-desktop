/**
 * P6.10 — the IaC PLAN analyzer: Terraform action classification (create/update/delete/replace/no-op/read +
 * resource_drift → drift), config-derived dependency ordering; Pulumi step-op classification with the decomposed
 * replacement family collapsing to one `replace` and `refresh` → drift; normalized counts + apply/destroy topo.
 * Pure-node.
 */
import { describe, expect, it } from 'vitest';
import { analyzePlan, classifyPulumiOp, classifyTerraformActions } from './iacPlan';

describe('classifyTerraformActions', () => {
  it('maps every action array onto the taxonomy', () => {
    expect(classifyTerraformActions(['no-op'])).toBe('no-op');
    expect(classifyTerraformActions(['create'])).toBe('create');
    expect(classifyTerraformActions(['update'])).toBe('update');
    expect(classifyTerraformActions(['delete'])).toBe('delete');
    expect(classifyTerraformActions(['read'])).toBe('read');
    expect(classifyTerraformActions(['forget'])).toBe('delete');
    expect(classifyTerraformActions(['delete', 'create'])).toBe('replace');
    expect(classifyTerraformActions(['create', 'delete'])).toBe('replace');
  });
});

describe('analyzePlan — Terraform', () => {
  const plan = {
    format_version: '1.2',
    resource_changes: [
      { address: 'aws_instance.web', type: 'aws_instance', provider_name: 'registry.terraform.io/hashicorp/aws', change: { actions: ['update'], before: { size: 't3.micro' }, after: { size: 't3.small' } } },
      { address: 'aws_instance.new', type: 'aws_instance', provider_name: 'registry.terraform.io/hashicorp/aws', change: { actions: ['create'], before: null, after: {} } },
      { address: 'aws_instance.old', type: 'aws_instance', provider_name: 'registry.terraform.io/hashicorp/aws', change: { actions: ['delete'], before: {}, after: null } },
      { address: 'aws_db.main', type: 'aws_db_instance', provider_name: 'registry.terraform.io/hashicorp/aws', change: { actions: ['delete', 'create'], replace_paths: [['engine']], before: {}, after: {} } },
      { address: 'aws_ami.x', type: 'aws_ami', provider_name: 'registry.terraform.io/hashicorp/aws', change: { actions: ['no-op'] } },
    ],
    resource_drift: [
      { address: 'aws_sg.web', type: 'aws_security_group', provider_name: 'registry.terraform.io/hashicorp/aws', change: { actions: ['update'], before: { desc: 'a' }, after: { desc: 'b' } } },
    ],
    configuration: {
      root_module: {
        resources: [
          { address: 'aws_instance.web', mode: 'managed', type: 'aws_instance', name: 'web', expressions: { vpc_security_group_ids: { references: ['aws_sg.web.id', 'aws_sg.web'] } } },
          { address: 'aws_sg.web', mode: 'managed', type: 'aws_security_group', name: 'web', expressions: {} },
        ],
      },
    },
  };

  it('normalizes actions incl. replace + drift, with counts', () => {
    const cs = analyzePlan(plan, 'terraform');
    const byAddr = Object.fromEntries(cs.changes.map((c) => [c.address, c]));
    expect(byAddr['aws_instance.web'].action).toBe('update');
    expect(byAddr['aws_instance.new'].action).toBe('create');
    expect(byAddr['aws_instance.old'].action).toBe('delete');
    expect(byAddr['aws_db.main'].action).toBe('replace');
    expect(byAddr['aws_db.main'].replacePaths).toEqual(['engine']);
    expect(byAddr['aws_sg.web'].action).toBe('drift');
    expect(byAddr['aws_sg.web'].fromDrift).toBe(true);
    expect(cs.counts).toMatchObject({ create: 1, update: 1, delete: 1, replace: 1, drift: 1, 'no-op': 1, total: 6 });
  });

  it('derives dependencies from configuration references and orders deps first', () => {
    const cs = analyzePlan(plan, 'terraform');
    const web = cs.changes.find((c) => c.address === 'aws_instance.web')!;
    expect(web.dependsOn).toEqual(['aws_sg.web']); // 'aws_sg.web.id' reduced to the resource address
    expect(cs.applyOrder.indexOf('aws_sg.web')).toBeLessThan(cs.applyOrder.indexOf('aws_instance.web'));
    expect(cs.destroyOrder[0]).toBe(cs.applyOrder[cs.applyOrder.length - 1]);
  });

  it('resolves count/for_each dependencies at INSTANCE granularity (block-level config → indexed instances)', () => {
    const counted = {
      resource_changes: [
        { address: 'aws_instance.web[0]', type: 'aws_instance', change: { actions: ['create'] } },
        { address: 'aws_subnet.main[0]', type: 'aws_subnet', change: { actions: ['create'] } },
      ],
      configuration: { root_module: { resources: [
        { address: 'aws_instance.web', expressions: { subnet_id: { references: ['aws_subnet.main[0].id', 'aws_subnet.main'] } } },
        { address: 'aws_subnet.main' },
      ] } },
    };
    const cs = analyzePlan(counted, 'terraform');
    const web = cs.changes.find((c) => c.address === 'aws_instance.web[0]')!;
    expect(web.dependsOn).toEqual(['aws_subnet.main[0]']); // block dep expanded to the present instance
    expect(cs.applyOrder.indexOf('aws_subnet.main[0]')).toBeLessThan(cs.applyOrder.indexOf('aws_instance.web[0]'));
  });
});

describe('classifyPulumiOp', () => {
  it('maps ops, collapsing the replacement family', () => {
    expect(classifyPulumiOp('same')).toBe('no-op');
    expect(classifyPulumiOp('create')).toBe('create');
    expect(classifyPulumiOp('refresh')).toBe('drift');
    expect(classifyPulumiOp('create-replacement')).toBe('replace');
    expect(classifyPulumiOp('delete-replaced')).toBe('replace');
    expect(classifyPulumiOp('discard')).toBe('ignore');
  });
});

describe('analyzePlan — Pulumi', () => {
  const U = (n: string, t = 'aws:s3/bucket:Bucket') => `urn:pulumi:prod::web::${t}::${n}`;
  const preview = {
    steps: [
      { op: 'same', urn: U('A') },
      { op: 'create', urn: U('B'), newState: { type: 'aws:s3/bucket:Bucket', dependencies: [] } },
      { op: 'update', urn: U('C', 'aws:ec2/instance:Instance'), newState: { type: 'aws:ec2/instance:Instance', dependencies: [U('B')] }, diffReasons: ['size'] },
      { op: 'create-replacement', urn: U('D', 'aws:rds/instance:Instance'), newState: { type: 'aws:rds/instance:Instance' } },
      { op: 'delete-replaced', urn: U('D', 'aws:rds/instance:Instance') },
      { op: 'replace', urn: U('D', 'aws:rds/instance:Instance'), replaceReasons: ['engine'] },
      { op: 'refresh', urn: U('E'), oldState: {}, newState: {} },
      { op: 'read', urn: U('F') },
    ],
  };

  it('collapses a decomposed replacement to one change and maps refresh → drift', () => {
    const cs = analyzePlan(preview, 'pulumi');
    const byAddr = Object.fromEntries(cs.changes.map((c) => [c.address, c]));
    expect(byAddr[U('A')].action).toBe('no-op');
    expect(byAddr[U('B')].action).toBe('create');
    expect(byAddr[U('C', 'aws:ec2/instance:Instance')].action).toBe('update');
    expect(byAddr[U('D', 'aws:rds/instance:Instance')].action).toBe('replace'); // 3 steps → 1
    expect(byAddr[U('D', 'aws:rds/instance:Instance')].replacePaths).toEqual(['engine']);
    expect(byAddr[U('E')].action).toBe('drift');
    expect(byAddr[U('F')].action).toBe('read');
    expect(cs.counts).toMatchObject({ create: 1, update: 1, replace: 1, drift: 1, read: 1, 'no-op': 1, total: 6 });
  });

  it('reads dependencies + type from the Pulumi step state', () => {
    const cs = analyzePlan(preview, 'pulumi');
    const c = cs.changes.find((x) => x.address === U('C', 'aws:ec2/instance:Instance'))!;
    expect(c.type).toBe('aws:ec2/instance:Instance');
    expect(c.provider).toBe('aws');
    expect(c.dependsOn).toEqual([U('B')]);
  });
});
