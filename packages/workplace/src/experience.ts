/**
 * Module 21 — Desktop Experience, Module 22 — Mobile Experience, Module 23 — Design System.
 * Desktop (multi-window/dock/tabs/split-view/drag-drop/offline/notifications/shortcuts) and mobile
 * (responsive/offline-sync/push/camera/biometrics) capabilities are REPRESENTED as descriptors —
 * adapter-verified via the Electron runtime / device, never operated here. The design system is an
 * in-process component + theme registry (live-verified) — no UI components are duplicated.
 */
import { randomId } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import type { EvidenceLevel } from './types';
import { DESIGN_THEMES, type DesignTheme } from './constants';

export const DESKTOP_CAPABILITIES = ['multi-window', 'dock', 'tabs', 'split-view', 'drag-and-drop', 'offline-mode', 'notifications', 'keyboard-shortcuts'] as const;
export const MOBILE_CAPABILITIES = ['responsive-layout', 'offline-sync', 'push-notifications', 'camera', 'biometrics'] as const;

export interface Capability {
  name: string;
  surface: 'desktop' | 'mobile';
  evidence: EvidenceLevel;
  note: string;
}
export interface UiComponent {
  id: string;
  name: string;
}

export class ExperienceRuntime {
  private readonly components = new Map<string, UiComponent>();

  constructor(private readonly governance: WorkspaceGovernance) {}

  desktopCapabilities(): Capability[] {
    return DESKTOP_CAPABILITIES.map((name) => ({ name, surface: 'desktop', evidence: 'adapter-verified', note: 'represented via the Electron runtime — adapter-verified until packaged' }));
  }
  mobileCapabilities(): Capability[] {
    return MOBILE_CAPABILITIES.map((name) => ({ name, surface: 'mobile', evidence: 'adapter-verified', note: 'represented as a device capability — adapter-verified until built' }));
  }

  async registerComponent(name: string): Promise<UiComponent> {
    const c: UiComponent = { id: randomId('ui'), name };
    this.components.set(name, c);
    await this.governance.record({ actor: 'system', module: 'design-system', operation: 'component.register', targetId: name, evidence: 'live-verified' });
    return c;
  }
  componentList(): UiComponent[] { return [...this.components.values()]; }
  themes(): readonly DesignTheme[] { return DESIGN_THEMES; }
}
