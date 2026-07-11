/**
 * P3.0 Increment 5 — drift guard. The shared route manifest (the SDK generator's
 * input) must exactly equal the live registry's route index (the OpenAPI's input),
 * so the SDK, the OpenAPI, and the runtime always describe the same API.
 */
import { describe, expect, it } from 'vitest';
import { ENTERPRISE_API_ROUTE_MANIFEST } from '@neuropause/shared';
import { enterpriseApiRouteIndex } from './apiGateway';

describe('enterprise API manifest', () => {
  it('matches the live route index exactly (no drift between SDK, OpenAPI, and runtime)', () => {
    expect(enterpriseApiRouteIndex()).toEqual([...ENTERPRISE_API_ROUTE_MANIFEST]);
  });
});
