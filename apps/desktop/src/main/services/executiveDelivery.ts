/**
 * Executive Intelligence Delivery — composition root.
 *
 * Wires the reusable DeliveryEngine to real, already-existing capabilities:
 *   - desktop channel  → notificationScheduler.notifyNow (existing notification path)
 *   - Mission Brief    → generateBriefing via the same read path initDailyIntelligence uses
 *   - preferences      → JSON under userData (the existing small-state persistence pattern)
 *
 * This file creates NO new AI and NO new scheduler. It connects existing parts.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  DEFAULT_DELIVERY_PREFERENCES,
  type DeliveryChannel,
  type DeliveryPreferences,
  type IntelligenceItem,
  type IntelligenceSource,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { taskScheduler } from './taskScheduler';
import { notificationScheduler } from './notificationScheduler';
import { DeliveryEngine } from './deliveryEngine';
import { unifiedStore } from '../unified/storeInstance';
import { getEnterpriseTimeline } from '../timeline';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { founderProactiveSource } from '../ai/founderProactive';

const log = createLogger('delivery-root');

// ── Preferences persistence (reuses the userData JSON pattern) ────────────────
function prefsPath(): string {
  return join(app.getPath('userData'), 'delivery-preferences.json');
}

let cachedPrefs: DeliveryPreferences | null = null;

export async function loadDeliveryPreferences(): Promise<DeliveryPreferences> {
  try {
    const raw = await fs.readFile(prefsPath(), 'utf8');
    cachedPrefs = {
      ...DEFAULT_DELIVERY_PREFERENCES,
      ...(JSON.parse(raw) as Partial<DeliveryPreferences>),
    };
  } catch {
    cachedPrefs = { ...DEFAULT_DELIVERY_PREFERENCES };
  }
  return cachedPrefs;
}

export async function saveDeliveryPreferences(
  patch: Partial<DeliveryPreferences>,
): Promise<DeliveryPreferences> {
  const next = { ...(cachedPrefs ?? DEFAULT_DELIVERY_PREFERENCES), ...patch };
  cachedPrefs = next;
  await fs.writeFile(prefsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function getPreferencesSync(): DeliveryPreferences {
  return cachedPrefs ?? DEFAULT_DELIVERY_PREFERENCES;
}

// ── Desktop channel (reuses the existing notification path) ───────────────────
export const desktopChannel: DeliveryChannel = {
  key: 'desktop',
  available: true,
  deliver: (item: IntelligenceItem) => {
    // Reuse the one notification primitive; deep-link is carried for the renderer
    // to consume when the user clicks (handled by the existing notification wiring).
    notificationScheduler.notifyNow(item.title, item.body);
  },
};

// Interface-only future channels (STEP 3): present but not available until built.
export const emailChannelStub: DeliveryChannel = {
  key: 'email',
  available: false,
  deliver: () => undefined,
};
export const slackChannelStub: DeliveryChannel = {
  key: 'slack',
  available: false,
  deliver: () => undefined,
};

// ── Mission Brief as an intelligence source (reuses generateBriefing) ─────────
/** Builds today's brief exactly as initDailyIntelligence does, then adapts to an item. */
function buildMissionBriefItem(period: 'morning' | 'evening'): IntelligenceItem[] {
  const now = new Date().toISOString();
  const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const tl = getEnterpriseTimeline();
  const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const briefing = generateBriefing(period, { entities, events, now });

  // Count real signal; if the brief is empty, produce nothing (silent no-op).
  const sectionCount = Array.isArray((briefing as { sections?: unknown[] }).sections)
    ? (briefing as { sections: unknown[] }).sections.length
    : 0;
  if (sectionCount === 0) return [];

  const label = period === 'morning' ? 'Mission Brief' : 'Evening Summary';
  return [
    {
      id: `mission-brief:${period}`,
      title: `${label} — ${sectionCount} update${sectionCount === 1 ? '' : 's'}`,
      body:
        period === 'morning'
          ? 'Your priorities for today are ready.'
          : "Here's what moved today and what's still open.",
      priority: 'high',
      impact: { business: 0.6, urgency: period === 'morning' ? 0.7 : 0.4, confidence: 0.9 },
      deepLink: 'enterprise/briefings',
      producedAt: now,
    },
  ];
}

// ── The engine singleton ──────────────────────────────────────────────────────
export const deliveryEngine = new DeliveryEngine({
  now: () => new Date(),
  scheduler: taskScheduler,
  channels: [desktopChannel, emailChannelStub, slackChannelStub],
  getPreferences: getPreferencesSync,
});

/**
 * Initialize delivery: load prefs, register the built-in sources (Mission Brief
 * morning + evening today; Founder AI / Engineering alerts register here later),
 * and start the engine. Call once at boot.
 */
export async function initExecutiveDelivery(): Promise<void> {
  const prefs = await loadDeliveryPreferences();

  const morningBrief: IntelligenceSource = {
    key: 'mission-brief-morning',
    label: 'Morning Mission Brief',
    cadence: { kind: 'daily', atMinutes: prefs.morningBriefMinutes },
    produce: () => buildMissionBriefItem('morning'),
  };
  const eveningSummary: IntelligenceSource = {
    key: 'mission-brief-evening',
    label: 'Evening Summary',
    cadence: { kind: 'daily', atMinutes: prefs.eveningSummaryMinutes },
    produce: () => buildMissionBriefItem('evening'),
  };

  deliveryEngine.register(morningBrief);
  deliveryEngine.register(eveningSummary);
  // V2.2: Founder AI proactive recommendations — same engine, distinct source.
  // Fires with the morning brief; produces evidence-backed findings as items.
  deliveryEngine.register(founderProactiveSource(prefs.morningBriefMinutes));
  deliveryEngine.start();
  log.info('Executive delivery initialized', { sources: deliveryEngine.listSources() });
}
