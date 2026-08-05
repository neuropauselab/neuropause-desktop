/**
 * Backend runtime composition (NCEA 10.2C) — ADDITIVE demonstrator.
 *
 * Registers real backend services into the shared Enterprise Runtime so they
 * compose through ONE lifecycle and ONE event bus instead of ad-hoc wiring.
 * Uses the in-memory device repository here (production wires the Postgres repo).
 * `app.ts` is intentionally left unchanged — the full startup cutover is staged
 * in the migration guide, since it touches a running service whose integration
 * tests need live infrastructure.
 */
import {
  createEnterpriseRuntime,
  type EnterpriseRuntime,
  type EnterpriseRuntimeOptions,
  type ServiceDefinition,
} from '@neuropause/runtime';
import { busPublisher } from '../platform/events';
import { createMemoryDeviceRepository } from '../devices/memoryRepository';
import { registerDevice, listDevices, type DeviceServiceDeps } from '../devices/service';
import type { Device, RegisterDeviceInput } from '../devices/types';

export interface DevicesRuntimeService {
  register(input: RegisterDeviceInput): Promise<Device>;
  list(orgId: string, userId: string): Promise<Device[]>;
}

export interface BackendRuntimeDeps {
  getMemberRole: (orgId: string, userId: string) => Promise<string | null>;
}

/** Compose an Enterprise Runtime with backend services registered. */
export function composeBackendRuntime(
  deps: BackendRuntimeDeps,
  options: EnterpriseRuntimeOptions = {},
): EnterpriseRuntime {
  const devices: ServiceDefinition = {
    name: 'devices',
    init: (ctx) => {
      // Domain events flow onto the runtime's single event bus.
      const serviceDeps: DeviceServiceDeps = {
        repo: createMemoryDeviceRepository(),
        getMemberRole: deps.getMemberRole,
        publish: busPublisher(ctx.events.bus()),
      };
      const service: DevicesRuntimeService = {
        register: (input) => registerDevice(serviceDeps, input),
        list: (orgId, userId) => listDevices(serviceDeps, orgId, userId),
      };
      return service;
    },
    health: () => ({ status: 'ok', ready: true }),
  };

  return createEnterpriseRuntime({ ...options, services: [devices] });
}
