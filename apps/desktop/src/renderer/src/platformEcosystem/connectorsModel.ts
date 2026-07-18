/**
 * Platform Ecosystem (Phase 5) — Enterprise Integration / Connectors lens.
 * PURE derivation, no runtime. Adds NO ipc channel, engine, store, or service.
 *
 * This tab COMPOSES the already-shipped NeuroPause Connector Framework (NCF) into one
 * honest picture of "what the connector registry actually is, and what is actually
 * connected". Every stat/row reads a REAL field returned by EXISTING `ipc.connectors.*`
 * methods; it invokes nothing itself. The interactive Connector Center is reached via
 * `links`, never duplicated here.
 *
 * Real sources (verified against apps/desktop/src/main/connectors/connectorService.ts
 * and packages/shared/src/types/connectors.ts):
 *
 *   - ipc.connectors.list()  → ConnectorDto[]  — the static registry (22 connectors).
 *       Each DTO carries `lifecycle`, derived from REAL data-adapter presence:
 *       `getAdapter(id) ? 'production' : 'preview'` (connectorService.ts). So
 *       `production` = a real adapter exists (OAuth + sync + health work) and
 *       `preview` = catalog-only, NOT connectable (connecting would sync nothing).
 *       This is the only trustworthy production/preview split — it is per-connector
 *       and exists solely on the list.
 *   - ipc.connectors.stats() → ConnectorStats — registry aggregates. Its `healthy`,
 *       `degraded`, and `down` counts are computed by iterating each connector's
 *       `accounts` and tallying `account.health` — i.e. they count CONNECTED ACCOUNTS,
 *       not connectors. This lens labels them as account health so the number is never
 *       misread as "connectors down".
 *
 * Authenticity: in a fresh install nothing is connected (OAuth needs real credentials),
 * so `connected`/`accounts`/health are genuinely zero — this lens then shows only the
 * registry composition and lets the honest empty state show through for connection and
 * health, instead of fabricating a "100% healthy" figure. Capabilities the platform does
 * not genuinely have are surfaced as honest, labeled `OpGap`s — never invented values.
 * In particular the marketplace "certified" badge is NOT surfaced here: it certifies
 * demo-seeded marketplace listings, not the live connectors.
 */
import {
  type OpLens,
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  healthTone,
  count,
  pctText,
} from '@renderer/aiOperations/aiOperationsModel';

/**
 * MINIMAL STRUCTURAL projection of the real ipc returns this lens reads. Only the fields
 * actually consumed are declared, and every field is optional so an unpopulated (or
 * entirely absent) source degrades to an honest empty state rather than throwing or
 * fabricating a value. Field provenance is noted per member.
 */
export interface ConnectorsInput {
  /** ipc.connectors.stats() → ConnectorStats (registry aggregates). */
  stats?: {
    /** Total connectors in the registry. */
    total?: number;
    /** Connectors with client credentials configured. */
    configured?: number;
    /** Connectors with at least one connected account. */
    connected?: number;
    /** Total connected accounts across all connectors. */
    accounts?: number;
    /** ACCOUNT health tallies (each counts connected accounts, not connectors). */
    healthy?: number;
    degraded?: number;
    down?: number;
  };
  /** ipc.connectors.list() → ConnectorDto[] (the static registry). */
  connectors?: Array<{
    id?: string;
    name?: string;
    /**
     * ConnectorLifecycleState, derived from real adapter presence:
     * 'production' = a real data adapter exists; 'preview' = catalog-only, not connectable.
     */
    lifecycle?: 'production' | 'preview';
    /** Aggregate status across accounts (or 'unavailable' when unconfigured). */
    status?:
      'disconnected' | 'connecting' | 'connected' | 'reauth_required' | 'error' | 'unavailable';
    /** Aggregate health across accounts. */
    health?: 'healthy' | 'degraded' | 'down' | 'unknown';
    /** Whether the required client credentials are present in configuration. */
    configured?: boolean;
    /** ConnectedAccount[] — only the count is read here. */
    accounts?: Array<unknown>;
  }>;
}

/**
 * Honest capability gaps — always present. Each names the REAL architecture the
 * capability would require; none hides a value that is actually available today.
 * Verified against the codebase:
 *   - No connector certification pipeline exists; `certified` lives only on marketplace
 *     listings / the ConnectorTier catalog (packages/shared/src/types/marketplace.ts,
 *     ecosystem-exchange.ts), which are demo-seeded, not the live connectors.
 *   - ConnectorManifest.version is only ever copied into the DTO for display
 *     (connectorService.ts) — no semver comparison / version gate consumes it.
 *   - Deployment modes are a synthesized commercial catalog explicitly noted as "packaging
 *     that does not yet exist" (packages/shared/src/types/commercialPlatform.ts); there is
 *     no per-connector deployment-profile store.
 */
const GAPS: OpGap[] = [
  {
    capability: 'Connector certification',
    requires:
      'a certification pipeline — the only "certified" badge is on demo-seeded marketplace listings, not the live connectors',
  },
  {
    capability: 'Version/semver compatibility',
    requires: 'a version gate — the connector manifest version is display-only, never validated',
  },
  {
    capability: 'Connector-scoped deployment profiles',
    requires:
      'a profile store — deployment modes are a synthesized commercial catalog, not connector-scoped',
  },
];

/** Deep-link to the canonical interactive surface (reuse, never duplicate). */
const LINKS: OpLink[] = [{ label: 'Connectors', section: 'connectors' }];

/**
 * Derive the Connectors lens from whatever real sources the caller supplied. Every emitted
 * stat/row is gated on its source being genuinely populated, so a fully empty (or undefined)
 * input yields empty stats/groups while the gaps + links — which are architectural facts, not
 * data — always remain.
 */
export function summarizeConnectors(input: ConnectorsInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  const source = input?.stats;
  const connectors = input?.connectors ?? [];
  const listPopulated = connectors.length > 0;

  // ── Registry composition (real: ConnectorDto.lifecycle) ────────────────────
  // The production/preview split is per-connector and lives ONLY on the list, so it is
  // derivable exactly when the list is populated.
  const production = connectors.filter((c) => c?.lifecycle === 'production').length;
  const preview = connectors.filter((c) => c?.lifecycle === 'preview').length;
  const splitPopulated = listPopulated;

  // Total prefers the stats aggregate (authoritative registry size), else the list length.
  const total = source?.total ?? (listPopulated ? connectors.length : 0);
  const configured = source?.configured;
  const registryPopulated = total > 0 || listPopulated;

  // ── Connection + account health (real: ConnectorStats over connected accounts) ──
  const connectedConnectors =
    source?.connected ??
    (listPopulated
      ? connectors.filter((c) => c?.status === 'connected' || (c?.accounts?.length ?? 0) > 0).length
      : 0);
  const accounts = source?.accounts ?? 0;
  const connectionPopulated = connectedConnectors > 0 || accounts > 0;

  const healthy = source?.healthy ?? 0;
  const degraded = source?.degraded ?? 0;
  const down = source?.down ?? 0;
  // healthy/degraded/down count accounts that report a definite health; 'unknown' is excluded.
  const healthKnown = healthy + degraded + down;
  const healthPopulated = healthKnown > 0;
  const healthRatio = healthPopulated ? healthy / healthKnown : Number.NaN;

  // ── Headline stats (2–4) ───────────────────────────────────────────────────
  if (registryPopulated) {
    stats.push({
      icon: 'connectors',
      label: 'Connectors',
      value: count(total),
      hint: splitPopulated
        ? `${count(production)} production · ${count(preview)} preview`
        : configured !== undefined
          ? `${count(configured)} configured`
          : undefined,
    });
  }

  if (splitPopulated) {
    // Composition, not health — no tone, so preview (an intentional catalog state) is never
    // painted as a fault.
    stats.push({
      icon: 'package',
      label: 'Production connectors',
      value: count(production),
      hint: `${count(preview)} preview (catalog-only)`,
    });
  }

  if (connectionPopulated) {
    stats.push({
      icon: 'activity',
      label: 'Connected',
      value: count(connectedConnectors),
      hint: `${count(accounts)} account${accounts === 1 ? '' : 's'}`,
    });
  }

  if (healthPopulated) {
    stats.push({
      icon: 'heart',
      label: 'Account health',
      value: pctText(healthRatio),
      tone: healthTone(healthRatio),
      hint: `${count(healthy)}/${count(healthKnown)} accounts healthy`,
    });
  }

  // ── Group — 'Registry & health (real)' ─────────────────────────────────────
  {
    const rows: OpRow[] = [];

    if (splitPopulated) {
      rows.push({
        label: 'Production (real adapter)',
        value: `${count(production)}/${count(total)}`,
        sub: 'real OAuth + sync + health',
      });
      rows.push({
        label: 'Preview (catalog-only)',
        value: count(preview),
        sub: 'not connectable — no data adapter yet',
      });
    } else if (registryPopulated) {
      rows.push({
        label: 'Connectors in registry',
        value: count(total),
        sub: configured !== undefined ? `${count(configured)} configured` : undefined,
      });
    }

    if (connectionPopulated) {
      rows.push({
        label: 'Connected',
        value: `${count(connectedConnectors)}/${count(total)}`,
        sub: `${count(accounts)} account${accounts === 1 ? '' : 's'}`,
      });
    }

    if (healthPopulated) {
      rows.push({
        label: 'Accounts healthy',
        value: `${count(healthy)}/${count(healthKnown)}`,
        tone: healthTone(healthRatio),
      });
      if (degraded > 0) {
        rows.push({ label: 'Accounts degraded', value: count(degraded), tone: 'orange' });
      }
      if (down > 0) {
        rows.push({ label: 'Accounts down', value: count(down), tone: 'red' });
      }
    }

    if (rows.length > 0) {
      const notes: string[] = [];
      if (splitPopulated) {
        notes.push(
          'Preview connectors are catalog-only — not connectable until a real data adapter ships.',
        );
      }
      if (healthPopulated) {
        notes.push('Health counts connected accounts, not connectors.');
      }
      groups.push({
        title: 'Registry & health (real)',
        rows,
        note: notes.length > 0 ? notes.join(' ') : undefined,
      });
    }
  }

  return { stats, groups, gaps: GAPS, links: LINKS };
}
