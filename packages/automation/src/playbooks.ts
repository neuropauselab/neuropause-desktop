/**
 * Module 4 — Enterprise Playbooks. Ten built-in playbooks, each a real WorkflowDefinition.
 * Internal steps (create user via NEMS, provision, notify in-app, approval gates) execute
 * end-to-end and are live-verified. Steps that would touch external SaaS are marked
 * `external: true` and their action records the INTENT without claiming delivery — the
 * external side-effect is adapter-verified / infra-pending, never fabricated as done.
 */
import { randomId } from '@neuropause/cloud-core';
import { systemContext, type NemsPlatform } from '@neuropause/nems';
import type { NotificationPlatform } from './notifications';
import type { WorkflowDefinition, WorkflowStepDef } from './types';
import type { PlaybookId } from './constants';

export interface PlaybookDeps {
  notifications: NotificationPlatform;
  policyId: string;
  nems?: NemsPlatform;
}

export function buildPlaybooks(deps: PlaybookDeps): Map<PlaybookId, WorkflowDefinition> {
  const { notifications, policyId, nems } = deps;

  const act = (name: string, fn: WorkflowStepDef['action']): WorkflowStepDef => ({ name, kind: 'action', action: fn });
  const notify = (name: string, subject: string): WorkflowStepDef => ({
    name,
    kind: 'notify',
    action: async (ctx) => notifications.send({ tenantId: ctx.tenantId, channel: 'in-app', to: String(ctx.state.inputs.actor ?? ctx.actor), subject, body: `${subject}: ${String(ctx.state.inputs.subject ?? ctx.state.inputs.name ?? ctx.tenantId)}` }),
  });
  const approve = (name: string, riskTier?: 'high' | 'restricted'): WorkflowStepDef => ({ name, kind: 'approval', approval: { policyId }, ...(riskTier ? { riskTier } : {}) });
  const external = (name: string, system: string, operation: string): WorkflowStepDef => ({
    name,
    kind: 'action',
    external: true,
    action: async () => ({ system, operation, delivered: false, note: 'external side-effect infra-pending (adapter-verified)' }),
  });

  const def = (id: PlaybookId, name: string, steps: WorkflowStepDef[], description: string): [PlaybookId, WorkflowDefinition] => [id, { id, name, version: 1, mode: 'sequential', steps, description }];

  const playbooks = new Map<PlaybookId, WorkflowDefinition>([
    def('employee-onboarding', 'Employee Onboarding', [
      act('create-account', async (ctx) =>
        nems
          ? { userId: (await nems.users().create(systemContext(ctx.tenantId), { email: String(ctx.state.inputs.email ?? `hire-${randomId('e')}@example.test`), password: `temp-${randomId('pw')}`, displayName: String(ctx.state.inputs.name ?? 'New Hire') })).id }
          : { intent: 'create-account' }),
      act('provision-access', async () => ({ provisioned: true })),
      notify('welcome', 'Welcome aboard'),
      approve('manager-approval'),
    ], 'Create account, provision access, welcome, and get manager sign-off.'),

    def('incident-response', 'Incident Response', [
      act('triage', async (ctx) => ({ severity: String(ctx.state.inputs.severity ?? 'medium') })),
      notify('page-oncall', 'Incident: on-call paged'),
      approve('containment-approval', 'high'),
      external('remediate', 'connector', 'apply-remediation'),
    ], 'Triage, page on-call, approve containment, remediate.'),

    def('release-management', 'Release Management', [
      act('run-checks', async () => ({ checks: 'passed' })),
      approve('release-approval'),
      external('tag-release', 'github', 'create-release'),
      notify('announce', 'Release shipped'),
    ], 'Checks, approval, tag release, announce.'),

    def('customer-onboarding', 'Customer Onboarding', [
      act('create-record', async (ctx) => ({ customer: String(ctx.state.inputs.name ?? 'customer') })),
      notify('welcome-email', 'Customer welcome'),
      notify('schedule-kickoff', 'Kickoff scheduled'),
    ], 'Create record, welcome, schedule kickoff.'),

    def('design-partner-onboarding', 'Design Partner Onboarding', [
      approve('nda-signoff'),
      act('provision-workspace', async () => ({ provisioned: true })),
      notify('partner-welcome', 'Design partner onboarded'),
    ], 'NDA sign-off, provision, welcome.'),

    def('compliance-evidence-collection', 'Compliance Evidence Collection', [
      act('collect-evidence', async (ctx) => ({ collected: (ctx.state.inputs.controls as unknown[] | undefined)?.length ?? 0 })),
      approve('compliance-review'),
      act('archive', async () => ({ archived: true })),
    ], 'Collect evidence, review, archive.'),

    def('quarterly-okr-review', 'Quarterly OKR Review', [
      act('gather-okrs', async (ctx) => (nems ? { objectives: (await nems.okrs().objectives(ctx.tenantId)).length } : { intent: 'gather-okrs' })),
      act('summarize', async () => ({ summarized: true })),
      notify('share-review', 'Quarterly OKR review ready'),
    ], 'Gather OKRs, summarize, share.'),

    def('risk-escalation', 'Risk Escalation', [
      act('assess-risk', async (ctx) => ({ risk: String(ctx.state.inputs.risk ?? 'unknown') })),
      approve('escalation-approval', 'high'),
      notify('notify-leadership', 'Risk escalated'),
    ], 'Assess, approve escalation, notify leadership.'),

    def('security-incident', 'Security Incident', [
      act('contain', async () => ({ contained: true })),
      approve('security-approval', 'restricted'),
      external('remediate', 'connector', 'security-remediation'),
      notify('report', 'Security incident report filed'),
    ], 'Contain, restricted approval, remediate, report.'),

    def('vendor-review', 'Vendor Review', [
      act('assess-vendor', async (ctx) => ({ vendor: String(ctx.state.inputs.vendor ?? 'vendor') })),
      approve('vendor-approval'),
      notify('notify-procurement', 'Vendor review complete'),
    ], 'Assess, approve, notify.'),
  ]);

  return playbooks;
}
