/**
 * Module 13 — Enterprise Forms. Dynamic forms, surveys, requests, and internal applications built
 * through a form builder that REUSES the Wave 9 low-code platform when present (no duplication).
 * Submissions are stored in-process — live-verified; start empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import type { IndustryPlatform } from './types';

export interface FormField {
  name: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'choice';
}
export interface WorkForm {
  id: string;
  name: string;
  kind: 'form' | 'survey' | 'request';
  fields: FormField[];
  createdAt: number;
}
export interface FormSubmission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  at: number;
}

export class FormRuntime {
  private readonly forms = new Map<string, WorkForm>();
  private readonly submissions: FormSubmission[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
    private readonly industry?: IndustryPlatform,
  ) {}

  async create(input: { name: string; kind?: WorkForm['kind']; fields: FormField[] }): Promise<WorkForm> {
    const f: WorkForm = { id: randomId('form'), name: input.name, kind: input.kind ?? 'form', fields: input.fields, createdAt: this.clock.now() };
    this.forms.set(f.id, f);
    // reuse the Wave 9 low-code form builder when available (composition, not duplication)
    if (this.industry) await this.industry.lowcode().buildForm({ name: input.name, objectName: input.name, fields: input.fields.map((x) => x.name) });
    await this.governance.record({ actor: 'system', module: 'forms', operation: `create.${f.kind}`, targetId: f.id, evidence: 'live-verified' });
    return f;
  }
  async submit(formId: string, data: Record<string, unknown>): Promise<FormSubmission> {
    if (!this.forms.has(formId)) throw new Error(`no form ${formId}`);
    const s: FormSubmission = { id: randomId('sub'), formId, data, at: this.clock.now() };
    this.submissions.push(s);
    await this.governance.record({ actor: 'system', module: 'forms', operation: 'submit', targetId: s.id, evidence: 'live-verified' });
    return s;
  }

  get(id: string): WorkForm | undefined { return this.forms.get(id); }
  list(): WorkForm[] { return [...this.forms.values()]; }
  submissionsFor(formId: string): FormSubmission[] { return this.submissions.filter((s) => s.formId === formId); }
  count(): number { return this.forms.size; }
}
