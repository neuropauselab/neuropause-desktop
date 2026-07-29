/**
 * EPIC 1 (gate) — Prerequisite Gate. Before any provisioning is prepared, the operator must supply the
 * cloud provider, cloud credentials reference, domain, container registry, DNS zone, TLS authority,
 * secrets manager, and an explicit approval. If ANY is missing the gate STOPS and returns
 * 'PENDING - OPERATOR INPUT REQUIRED' with the exact missing inputs. Nothing downstream runs until the
 * gate is satisfied. Inputs are references/identifiers — the gate never handles secret values.
 */
import { PENDING_OPERATOR_INPUT, REQUIRED_INPUTS, type RequiredInput } from './constants';
import type { OperatorInputs } from './types';

export interface PrerequisiteResult {
  ready: boolean;
  missing: RequiredInput[];
  status: 'READY' | typeof PENDING_OPERATOR_INPUT;
}

function present(inputs: OperatorInputs, key: RequiredInput): boolean {
  if (key === 'approval') return Boolean(inputs.approval && inputs.approval.approved === true);
  const v = inputs[key as Exclude<RequiredInput, 'approval'>];
  return typeof v === 'string' ? v.length > 0 : Boolean(v);
}

export class PrerequisiteGate {
  /** The full gate — every required input plus an explicit approval. */
  check(inputs: OperatorInputs): PrerequisiteResult {
    const missing = REQUIRED_INPUTS.filter((k) => !present(inputs, k));
    return missing.length === 0 ? { ready: true, missing: [], status: 'READY' } : { ready: false, missing, status: PENDING_OPERATOR_INPUT };
  }

  /** Which of a specific subset of inputs a phase is missing (finer-grained PENDING reporting). */
  missingFor(inputs: OperatorInputs, requirements: RequiredInput[]): RequiredInput[] {
    return requirements.filter((k) => !present(inputs, k));
  }
}
