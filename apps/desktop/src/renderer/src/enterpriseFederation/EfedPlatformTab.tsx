/**
 * Phase 6 Stage 11 — the Enterprise tab (inside the EXISTING P10 Federation
 * Center). Presentation over the six read-only `efed:*` reads: partners with
 * declared trust BESIDE the computed assessment, trust evidence signal by
 * signal, the organization exchange with honest local-linkage states, the four
 * shared enterprise layers, the Principle-C recommendations, and the federation
 * board report. The tab mutates nothing — every suggested action points at an
 * existing governed fed:* surface, and the tab says so.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EfedBoardReport,
  EfedDashboard,
  EfedExchangeReport,
  EfedPartnersReport,
  EfedSharingReport,
  EfedTrustReport,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';
import {
  efedHeaderStats,
  efedRecommendationRows,
  exchangeRows,
  partnerRows,
  sharingRows,
  trustRows,
  unavailableLines,
} from './efedPlatformModel';

interface EfedData {
  dashboard: EfedDashboard | null;
  partners: EfedPartnersReport | null;
  trust: EfedTrustReport | null;
  exchange: EfedExchangeReport | null;
  sharing: EfedSharingReport | null;
  board: EfedBoardReport | null;
}

const EMPTY: EfedData = { dashboard: null, partners: null, trust: null, exchange: null, sharing: null, board: null };

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function EfedPlatformTab(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [d, setD] = useState<EfedData>(EMPTY);

  const refresh = useCallback(async () => {
    const [dashboard, partners, trust, exchange, sharing, board] = await Promise.all([
      settled(ipc.efed.dashboard(), null as EfedDashboard | null),
      settled(ipc.efed.partners(), null as EfedPartnersReport | null),
      settled(ipc.efed.trust(), null as EfedTrustReport | null),
      settled(ipc.efed.exchange(), null as EfedExchangeReport | null),
      settled(ipc.efed.sharing(), null as EfedSharingReport | null),
      settled(ipc.efed.report(), null as EfedBoardReport | null),
    ]);
    setD({ dashboard, partners, trust, exchange, sharing, board });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ready) return <LoadingBlock label="Loading the federation platform…" />;

  const stats = d.dashboard ? efedHeaderStats(d.dashboard) : [];
  const unavailable = unavailableLines(
    [d.dashboard, d.partners, d.trust, d.exchange, d.sharing].filter((x): x is NonNullable<typeof x> => x !== null),
  );

  return (
    <>
      {stats.length > 0 && (
        <OpsPanel
          title="Enterprise Federation Platform"
          subtitle="Partners · trust evidence · exchange · shared layers — composed from the records the federation stores already hold; read-only"
        >
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <span key={s.label} title={s.hint}>
                <StatusBadge tone={s.tone} label={`${s.label}: ${s.value}`} />
              </span>
            ))}
          </div>
          {d.dashboard && d.dashboard.disclosures.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {d.dashboard.disclosures.map((line) => (
                <div key={line} className="flex items-center gap-2 text-2xs text-faint">
                  <Icon name="shield" size={12} />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {d.partners && (
        <OpsPanel
          title={`Partners (${d.partners.partners.length})`}
          subtitle="P9-S2 peer records × trust × shares × artifacts — declared trust stays authoritative; the computed assessment sits beside it"
        >
          {d.partners.partners.length === 0 ? (
            <EmptyState icon="globe" title="No partner organizations recorded" hint="Partners appear when the existing federation runtime records them." />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {partnerRows(d.partners).map((p) => (
                <div key={p.peerOrg} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="globe" size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <StatusBadge tone={p.trustTone} label={`declared: ${p.declaredTrust}`} />
                      <StatusBadge tone={p.assessmentTone} label={p.assessment} />
                    </div>
                    <div className="mt-0.5 text-2xs text-muted">{p.statusText} · {p.sharesText}</div>
                    {p.exposureText && <div className="mt-0.5 text-2xs text-faint">exposed services: {p.exposureText}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {d.trust && (
        <OpsPanel
          title="Trust evidence (declared beside computed — declared is authoritative)"
          subtitle="Every signal is a recorded fact: invitations, attestations, signatures, reciprocity, audit history, policy coverage"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {trustRows(d.trust).map((t) => (
              <div key={t.peerOrg} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="shield" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    <StatusBadge tone={t.declaredTone} label={`declared: ${t.declared}`} />
                    <StatusBadge tone={t.tone} label={t.assessment} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{t.divergence}</div>
                  <div className="mt-0.5 text-2xs text-faint">live: {t.liveSignalsText}</div>
                  {t.missingSignalsText && <div className="mt-0.5 text-2xs text-orange-1">{t.missingSignalsText}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-2xs text-faint">{d.trust.disclosure}</div>
        </OpsPanel>
      )}

      {d.exchange && (
        <OpsPanel
          title={`Organization exchange (${d.exchange.totals.artifacts} artifact(s) · ${d.exchange.totals.localCandidates} local candidate(s))`}
          subtitle="Signed artifacts joined to REAL local records — name equality is a stated heuristic, never a recorded link"
        >
          {exchangeRows(d.exchange).length === 0 ? (
            <EmptyState icon="lock" title="No artifacts on the exchange" hint="Published artifacts appear from the existing fed:exchange surfaces." />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {exchangeRows(d.exchange).map((a) => (
                <div key={a.artifactId} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="lock" size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="text-2xs text-faint">{a.kind} · by {a.publisher}</span>
                      <StatusBadge tone={a.signedTone} label={a.signedTone === 'green' ? 'signed' : a.signedTone === 'red' ? 'unsigned versions' : 'signature unknown'} />
                      <StatusBadge tone={a.linkTone} label={a.linkState} />
                    </div>
                    <div className="mt-0.5 text-2xs text-muted">{a.verificationText}</div>
                    <div className="mt-0.5 text-2xs text-faint">{a.linkDetail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-2xs text-faint">{d.exchange.disclosure}</div>
        </OpsPanel>
      )}

      {d.sharing && (
        <OpsPanel
          title="Shared enterprise layers (S7 · S8 · S9 · S10 compositions)"
          subtitle="What the existing governed surfaces could share, joined to what is recorded — nothing moves from here"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {sharingRows(d.sharing).map((s) => (
              <div key={s.layer} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="grid" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium capitalize">{s.layer}</span>
                    <span className="text-2xs text-muted">{s.headline}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{s.detail}</div>
                  {s.gapText && <div className="mt-0.5 text-2xs text-orange-1">gaps: {s.gapText}</div>}
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.dashboard && d.dashboard.recommendations.length > 0 && (
        <OpsPanel
          title={`Recommendations (${d.dashboard.recommendations.length})`}
          subtitle="Principle-C items pointing at the existing governed fed:* surfaces — nothing executes from here"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {efedRecommendationRows(d.dashboard).map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="pin" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.title}</span>
                    <StatusBadge tone={r.tone} label={r.priority} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{r.detail}</div>
                  <div className="mt-0.5 text-2xs text-muted">Suggested: {r.suggestedAction}</div>
                  <div className="mt-0.5 text-2xs text-faint">{r.principleC}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.board && (
        <OpsPanel title={d.board.title} subtitle="Sectioned, evidence-cited composition of the same computed views — no new facts at report level">
          <div className="flex flex-col gap-3">
            {d.board.sections.map((s) => (
              <div key={s.title} className="rounded-2xl border border-[var(--hairline)] p-3">
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="mt-1 flex flex-col gap-0.5">
                  {s.lines.map((line, i) => (
                    <div key={i} className="text-2xs text-muted">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {unavailable.length > 0 && (
        <OpsPanel title="Declared unavailability" subtitle="Sources this composition could not read this pass — declared, never silently defaulted">
          <div className="flex flex-col gap-1">
            {unavailable.map((line) => (
              <div key={line} className="text-2xs text-faint">
                {line}
              </div>
            ))}
          </div>
        </OpsPanel>
      )}
    </>
  );
}
