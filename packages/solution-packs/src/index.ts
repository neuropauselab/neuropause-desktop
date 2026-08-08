/**
 * @neuropause/solution-packs — the **Desktop Industry Integration Layer**.
 *
 * CONVERGENCE (IP-02): the canonical Industry implementation is
 * `@neuropause/industry` (the Industry SDK, configuration engine, low-code,
 * copilots, compliance packs, connector marketplace, analytics, governance, and
 * the 20 vertical solution packs). This package does NOT duplicate any of that.
 * It is the thin desktop-facing adapter:
 *   • `industryProjection` — PURE projections of the canonical industry data
 *     (solutions / capability matrix / readiness) into the compact view-models
 *     the desktop app and mobile companion render (type-only dep on the
 *     canonical package).
 *   • the lifecycle helpers below (`SolutionPackRegistry`, `validateSolutionPack`,
 *     manifest types) are the desktop-local per-install ENABLE-STATE utilities,
 *     keyed by canonical industry pack keys — a UI/enable concern, NOT a second
 *     SDK, registry, or configuration engine. Canonical activation, governance,
 *     and validation remain in `@neuropause/industry`.
 */
export * from './industryProjection';
export * from './types';
export * from './validate';
export * from './registry';
