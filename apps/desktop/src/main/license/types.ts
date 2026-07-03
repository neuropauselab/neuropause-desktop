/**
 * Ports for the license validator. The transport is injected so the validator is
 * unit-testable with a stub; the HTTP implementation lives in transport.ts.
 *
 * Note: this module validates the org's PRODUCT license (its subscription
 * entitlement, issued by the backend at GET /license/:orgId). It is unrelated to
 * the ecosystem BillingStore's `License` ledger, which tracks marketplace app
 * purchases inside the local ecosystem simulation.
 */
import type { OrgLicense } from '@neuropause/shared';

export interface LicenseTransport {
  /** Fetch the org's current license status from the backend. */
  fetchLicense(orgId: string): Promise<OrgLicense>;
}
