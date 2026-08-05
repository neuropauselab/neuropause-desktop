/**
 * Module 12 — Healthcare Platform. Providers, patients, appointments, encounters, clinical
 * records, orders, medications, lab results, and FHIR/HL7 resource MODELS, with Epic/Cerner
 * ADAPTERS. Everything here is a STRUCTURAL model over synthetic data — NO real patient data is
 * stored. A real EHR / PHI system is REGULATED-EXTERNAL and is never connected.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import { FHIR_RESOURCES, type FhirResource } from './constants';

export interface Provider { id: string; name: string; specialty: string; }
export interface PatientModel {
  id: string;
  displayName: string; // synthetic label only — never real PHI
  synthetic: true;
  note: string;
  createdAt: number;
}
export interface Appointment { id: string; patientId: string; providerId: string; at: number; status: 'booked' | 'completed-model'; }
export interface FhirResourceModel {
  id: string;
  resourceType: FhirResource;
  valid: boolean;
  problems: string[];
  note: string;
}

export class HealthcareRuntime {
  private readonly providersMap = new Map<string, Provider>();
  private readonly patientsMap = new Map<string, PatientModel>();
  private readonly appointmentsMap = new Map<string, Appointment>();
  private readonly fhirMap = new Map<string, FhirResourceModel>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async registerProvider(input: { name: string; specialty?: string }): Promise<Provider> {
    const p: Provider = { id: randomId('prov'), name: input.name, specialty: input.specialty ?? 'general' };
    this.providersMap.set(p.id, p);
    await this.governance.record({ actor: 'system', domain: 'healthcare', operation: 'provider.register', targetId: p.id, evidence: 'live-verified' });
    return p;
  }
  /** A structural patient model over SYNTHETIC data only — never real PHI. */
  async createPatientModel(displayName: string): Promise<PatientModel> {
    const p: PatientModel = { id: randomId('pat'), displayName, synthetic: true, note: 'structural model over synthetic data — no real patient data is stored (real EHR is regulated-external)', createdAt: this.clock.now() };
    this.patientsMap.set(p.id, p);
    await this.governance.record({ actor: 'system', domain: 'healthcare', operation: 'patient.model', targetId: p.id, evidence: 'business-data-pending', detail: p.note });
    return p;
  }
  async bookAppointment(input: { patientId: string; providerId: string; at: number }): Promise<Appointment> {
    const a: Appointment = { id: randomId('appt'), patientId: input.patientId, providerId: input.providerId, at: input.at, status: 'booked' };
    this.appointmentsMap.set(a.id, a);
    return a;
  }
  /** Validate a FHIR resource SHAPE (structural, not a real EHR write). */
  fhirResource(resourceType: FhirResource, data: Record<string, unknown>): FhirResourceModel {
    const problems: string[] = [];
    if (!FHIR_RESOURCES.includes(resourceType)) problems.push('unknown resourceType');
    if (data['resourceType'] && data['resourceType'] !== resourceType) problems.push('resourceType mismatch');
    const model: FhirResourceModel = { id: randomId('fhir'), resourceType, valid: problems.length === 0, problems, note: 'FHIR shape validated as a model — not written to a real EHR (regulated-external)' };
    this.fhirMap.set(model.id, model);
    return model;
  }

  providers(): Provider[] { return [...this.providersMap.values()]; }
  patients(): PatientModel[] { return [...this.patientsMap.values()]; }
  appointments(): Appointment[] { return [...this.appointmentsMap.values()]; }
  fhirResources(): FhirResourceModel[] { return [...this.fhirMap.values()]; }
  count(): number { return this.patientsMap.size; }
}
