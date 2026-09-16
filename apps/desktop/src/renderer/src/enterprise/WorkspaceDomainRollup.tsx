import type { ExecutiveSnapshot } from '@neuropause/shared';

/**
 * FG-8 · L1 Workspace Foundation — the domain rollup surface. Displays each
 * domain's STATE verbatim from the snapshot: a present domain shows its scoped
 * count; an UNAVAILABLE domain reads "unavailable" — NEVER a fabricated "0
 * customers". Absent `workspaceDomain` (older snapshot / unresolved scope) → the
 * section renders nothing. Every displayed value derives from `domain` — no
 * recomputation. In local mode this shows the local tenant's rollup with honest
 * UNAVAILABLE modules (the state carries through from the aggregate).
 */
export function WorkspaceDomainRollup({
  domain,
}: {
  domain: ExecutiveSnapshot['workspaceDomain'];
}): JSX.Element | null {
  if (!domain || !domain.scopeResolved) return null;
  return (
    <section aria-label="Workspace domain" className="mb-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Workspace domain</div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {domain.slices.map((s) => (
          <div
            key={s.moduleId}
            className="flex items-center justify-between rounded-lg [background:var(--fill-2)] px-3 py-1.5 text-2xs"
          >
            <span className="text-faint">{s.label}</span>
            <span className="font-medium text-ink tabular-nums">
              {s.state === 'unavailable' ? 'unavailable' : String(s.count)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
