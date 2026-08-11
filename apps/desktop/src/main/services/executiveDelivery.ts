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
import { orgIntelligenceSource } from '../enterprise/orgIntelligence';
import { forEachTenantBackground } from '../enterprise/index';
import { currentPrincipal } from '../tenancy/backgroundPrincipal';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts.
 *
 * The DECLARED STORE IS `delivery-preferences.json` AND NOTHING ELSE. This file
 * is a composition root: the intelligence it delivers is read through
 * `unifiedStore` and the enterprise timeline, which declare their own scopes and
 * are filtered by `forEachTenantBackground`'s principal; the toast it raises is
 * gated on the VIEWER (see `desktopChannel.deliver`, P13C Round 7). None of
 * that is persisted here. The only bytes this file writes are the schedule.
 */
declareStoreScope({
  name: 'delivery-preferences',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  // `notifications:prefs.set` is a per-user desktop surface on the sender-trust
  // model, not an organizational decision. ORG_ROLE is refused for an
  // install-wide file and would be the wrong axis anyway.
  authority: 'USER',
  classification: 'USER_PREFERENCE',
  retention:
    'One record, rewritten whole by `saveDeliveryPreferences` — no list, no cap, no eviction, so a ' +
    'write can remove nothing but the previous schedule. There is no delete path at all.',
  reason:
    'WHY GLOBAL: there is one screen, one notification centre and one timer on this machine, so ' +
    'there is one schedule. WHAT DATA: `DeliveryPreferences` in full — enabled, timezone offset, ' +
    'morning/afternoon/evening minutes, weekly report day, working-hours bounds, do-not-disturb and ' +
    'a minimum priority. Nine numbers, two booleans and an enum: no record names, no counts, nothing ' +
    'derived from any customer. STATED LIMIT: the file is install-wide, so on a shared machine a ' +
    "change to the brief time applies to everyone who uses it. That is a shared preference, not a " +
    'disclosure — the CONTENT of each brief is built per tenant by the fan-out and delivered only to ' +
    'the tenant the signed-in person is currently viewing.',
});

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
/**
 * The ACTIVE session's tenant, or null. Bound at composition.
 *
 * P13C ROUND 7 (final sweep) — see `desktopChannel` below. A module-level binding
 * rather than a parameter because `DeliveryChannel.deliver` is a fixed interface
 * shared with the stub channels, and widening it would put a tenant argument on
 * an email channel that does not exist yet.
 */
let viewerTenantId: () => string | null = () => null;
export function bindDeliveryViewer(source: () => string | null): void {
  viewerTenantId = source;
}

export const desktopChannel: DeliveryChannel = {
  key: 'desktop',
  available: true,
  deliver: (item: IntelligenceItem) => {
    /**
     * P13C ROUND 7 (final sweep) — AN OS TOAST GOES TO A PERSON, NOT TO A TENANT.
     *
     * `deliveryEngine.tick()` fans out over EVERY operable organization on the
     * install and calls every channel for each. The INBOX half of this was fixed
     * — the store is scoped and the badge uses `runOutsidePrincipal` — and the
     * OS notification was not. So a scheduled brief for tenant B raised a desktop
     * toast on the screen of whoever was signed in, carrying B's operational
     * state in the title: "Organization health is at-risk (42/100)", "License
     * expires in 3 days", "4 connector(s) in error".
     *
     * There is exactly one screen and one signed-in human, so the only correct
     * recipient is the tenant they are currently viewing. An unresolved viewer
     * gets nothing: a toast with no owner is a toast for the wrong person.
     */
    const viewer = viewerTenantId();
    const owner = currentPrincipal()?.tenantId ?? null;
    if (viewer === null) return;
    if (owner !== null && owner !== viewer) return;
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
/** Builds today's brief exactly as initDailyIntelligence does, then adapts to an item.
 *  Phase 6 Stage 5: extended additively to the afternoon/weekly/monthly periods
 *  (same generator, same honesty — an empty brief produces nothing). */
function buildMissionBriefItem(
  period: 'morning' | 'afternoon' | 'evening' | 'weekly' | 'monthly',
): IntelligenceItem[] {
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

  const LABEL: Record<typeof period, string> = {
    morning: 'Mission Brief',
    afternoon: 'Afternoon Update',
    evening: 'Evening Summary',
    weekly: 'Weekly Brief',
    monthly: 'Monthly Executive Summary',
  };
  const BODY: Record<typeof period, string> = {
    morning: 'Your priorities for today are ready.',
    afternoon: 'Your mid-day check-in is ready.',
    evening: "Here's what moved today and what's still open.",
    weekly: 'Your weekly brief is ready.',
    monthly: 'Your monthly executive summary is ready.',
  };
  return [
    {
      id: `mission-brief:${period}`,
      title: `${LABEL[period]} — ${sectionCount} update${sectionCount === 1 ? '' : 's'}`,
      body: BODY[period],
      priority: 'high',
      impact: { business: 0.6, urgency: period === 'morning' ? 0.7 : 0.4, confidence: 0.9 },
      deepLink: period === 'morning' || period === 'evening' ? 'enterprise/briefings' : 'hub',
      producedAt: now,
    },
  ];
}

// ── The engine singleton ──────────────────────────────────────────────────────
/** The live channel list. Phase 6 Stage 5: mutable so the Notification Inbox can
 *  register itself as the (always-typed, now real) `notification-center` channel. */
const deliveryChannels: DeliveryChannel[] = [desktopChannel, emailChannelStub, slackChannelStub];

/** Register an additional delivery channel (idempotent by key). Additive. */
export function registerDeliveryChannel(channel: DeliveryChannel): void {
  const idx = deliveryChannels.findIndex((c) => c.key === channel.key);
  if (idx >= 0) deliveryChannels[idx] = channel;
  else deliveryChannels.push(channel);
}

export const deliveryEngine = new DeliveryEngine({
  now: () => new Date(),
  scheduler: taskScheduler,
  channels: deliveryChannels,
  getPreferences: getPreferencesSync,
  /**
   * P13C PART 3 — the real tenant roster.
   *
   * `buildMissionBriefItem` below reads `unifiedStore.query(...)` and the
   * enterprise timeline, both of which resolve through `activeTenantScope()`.
   * Inside a fanned-out run that resolver returns the RUN's tenant rather than
   * the signed-in user's, because `resolveTenantScope` prefers a background
   * principal — so the brief is built from one organization's records, and a
   * second organization gets its own brief from its own.
   *
   * Neither the generator nor the sources changed. That is the property worth
   * having: the boundary was already drawn by Programs 11-13B, and this only
   * tells each pass whose side of it to stand on.
   */
  forEachTenant: (jobId, fn) => forEachTenantBackground(jobId, fn),
});

/**
 * Initialize delivery: load prefs, register the built-in sources (Mission Brief
 * morning + evening today; Founder AI / Engineering alerts register here later),
 * and start the engine. Call once at boot.
 */
/**
 * (Re)register every cadence-scheduled source from the CURRENT preferences.
 * Idempotent (register replaces by key), so the notification preferences IPC
 * (Phase 6 Stage 5) calls this after a save and new times take effect live —
 * no restart needed.
 */
export function reregisterScheduledSources(prefs: DeliveryPreferences): void {
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
  // Phase 6 Stage 5 — the remaining Daily Intelligence cadences (5.2), reusing
  // the SAME generator. Default afternoon slot 13:30 when unset.
  const afternoonUpdate: IntelligenceSource = {
    key: 'work-afternoon',
    label: 'Afternoon Update',
    cadence: { kind: 'daily', atMinutes: prefs.afternoonUpdateMinutes ?? 13 * 60 + 30 },
    produce: () => buildMissionBriefItem('afternoon'),
  };
  const weeklyBrief: IntelligenceSource = {
    key: 'work-weekly',
    label: 'Weekly Brief',
    cadence: { kind: 'weekly', dayOfWeek: prefs.weeklyReportDay, atMinutes: prefs.morningBriefMinutes },
    produce: () => buildMissionBriefItem('weekly'),
  };
  const monthlySummary: IntelligenceSource = {
    key: 'work-monthly',
    label: 'Monthly Executive Summary',
    cadence: { kind: 'monthly', dayOfMonth: 1, atMinutes: prefs.morningBriefMinutes },
    produce: () => buildMissionBriefItem('monthly'),
  };

  deliveryEngine.register(morningBrief);
  deliveryEngine.register(eveningSummary);
  deliveryEngine.register(afternoonUpdate);
  deliveryEngine.register(weeklyBrief);
  deliveryEngine.register(monthlySummary);
  // V2.2: Founder AI proactive recommendations — same engine, distinct source.
  // Fires with the morning brief; produces evidence-backed findings as items.
  deliveryEngine.register(founderProactiveSource(prefs.morningBriefMinutes));
  // V2.3: Organization Intelligence — computes org-health and emits governance-
  // complete findings (license, connectors, adoption, inactivity, engineering).
  deliveryEngine.register(orgIntelligenceSource(prefs.morningBriefMinutes));
}

export async function initExecutiveDelivery(): Promise<void> {
  const prefs = await loadDeliveryPreferences();
  reregisterScheduledSources(prefs);
  deliveryEngine.start();
  log.info('Executive delivery initialized', { sources: deliveryEngine.listSources() });
}
