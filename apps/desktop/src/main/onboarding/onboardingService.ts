/**
 * The onboarding service: owns persisted first-run state for this install —
 * whether onboarding has started, which steps are done, and whether it finished or
 * was dismissed. The wizard gates on firstRun/completedAt; the welcome checklist
 * reads the per-step state (a dismissed wizard leaves steps individually visible
 * and completable later). Writes are atomic; the file path and clock are injected,
 * so the service is unit-testable without Electron — the same pattern as the flag
 * service and license validator.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { OnboardingStatus, OnboardingStepId } from '@neuropause/shared';
import { ONBOARDING_STEPS } from '@neuropause/shared';
import { readStoreFile } from '../storage/storeEnvelope';

interface OnboardingFileData {
  version: 1;
  startedAt: string | null;
  completedAt: string | null;
  steps: Partial<Record<OnboardingStepId, string>>;
}

function emptyData(): OnboardingFileData {
  return { version: 1, startedAt: null, completedAt: null, steps: {} };
}

export interface OnboardingService {
  load(): Promise<void>;
  getStatus(): OnboardingStatus;
  /** Mark onboarding as started (idempotent). */
  start(): Promise<OnboardingStatus>;
  /** Mark a step done (idempotent; auto-starts). Completing the last step finishes. */
  completeStep(id: OnboardingStepId): Promise<OnboardingStatus>;
  /** Dismiss the wizard without finishing; per-step state stays incomplete. */
  dismiss(): Promise<OnboardingStatus>;
  /** Return this install to a first-run state (QA / support). */
  reset(): Promise<OnboardingStatus>;
}

export function createOnboardingService(opts: {
  filePath: string;
  now?: () => Date;
}): OnboardingService {
  const now = opts.now ?? ((): Date => new Date());
  let data = emptyData();
  let loaded = false;

  async function persist(): Promise<void> {
    const tmp = `${opts.filePath}.tmp`;
    await fs.mkdir(dirname(opts.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, opts.filePath);
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    // Phase 8 (8.3): envelope read — corrupt files are quarantined (preserved
    // beside themselves), never silently treated as a fresh install.
    const result = await readStoreFile<Partial<OnboardingFileData>>(opts.filePath);
    if (result.state === 'loaded' && result.data) {
      const raw = result.data;
      data = {
        version: 1,
        startedAt: raw.startedAt ?? null,
        completedAt: raw.completedAt ?? null,
        steps: raw.steps ?? {},
      };
    } else {
      data = emptyData();
    }
    loaded = true;
  }

  function status(): OnboardingStatus {
    const steps = ONBOARDING_STEPS.map((def) => ({
      ...def,
      completedAt: data.steps[def.id] ?? null,
    }));
    const next = steps.find((s) => s.completedAt === null);
    return {
      firstRun: data.startedAt === null && data.completedAt === null,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      steps,
      nextStep: next ? next.id : null,
    };
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    getStatus(): OnboardingStatus {
      return status();
    },

    async start(): Promise<OnboardingStatus> {
      await ensureLoaded();
      if (!data.startedAt) {
        data.startedAt = now().toISOString();
        await persist();
      }
      return status();
    },

    async completeStep(id: OnboardingStepId): Promise<OnboardingStatus> {
      await ensureLoaded();
      if (!data.startedAt) data.startedAt = now().toISOString();
      if (!data.steps[id]) data.steps[id] = now().toISOString();
      const allDone = ONBOARDING_STEPS.every((s) => data.steps[s.id]);
      if (allDone && !data.completedAt) data.completedAt = now().toISOString();
      await persist();
      return status();
    },

    async dismiss(): Promise<OnboardingStatus> {
      await ensureLoaded();
      if (!data.startedAt) data.startedAt = now().toISOString();
      if (!data.completedAt) data.completedAt = now().toISOString();
      await persist();
      return status();
    },

    async reset(): Promise<OnboardingStatus> {
      await ensureLoaded();
      data = emptyData();
      await persist();
      return status();
    },
  };
}
