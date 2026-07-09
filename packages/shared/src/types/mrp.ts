/**
 * Multi-Level Material Requirements Planning — EXTENDS the deterministic Planning
 * Engine (`planning.ts`) from single-level to true multi-level MRP. It does not
 * replace `runMrp`; it builds on it, reusing `PlanningInput`, `calculateForecastDemand`
 * (independent demand), `calculateIncomingSupply`, and Manufacturing's
 * `componentConsumption` — no duplicate engine.
 *
 * It recursively explodes every BOM (finished goods → subassemblies → raw materials),
 * generating dependent demand and netting requirements top-down by low-level code, so
 * a finished-goods shortage surfaces the subassembly and raw-material shortages needed
 * to build it. The explosion is cycle-safe (back-edges are detected and dropped, never
 * followed) and duplicate-safe (memoized), and shared components accumulate demand
 * across every parent. Read-only intelligence: it owns no records and mutates nothing;
 * the Inventory Ledger stays the single source of truth. Pure (no I/O).
 */
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import type { BillOfMaterials } from './manufacturing';
import { componentConsumption } from './manufacturing';
import type { Supplier } from './procurement';
import type { MrpRecommendation, PlanningInput } from './planning';
import { CAPACITY_CONSTRAINT_THRESHOLD, calculateCapacityPlan, calculateForecastDemand, calculateIncomingSupply } from './planning';

/** Safety net for pathological / mis-authored BOMs (cycle detection is the primary guard). */
export const MAX_BOM_DEPTH = 25;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/* ── BOM map + low-level codes (cycle-safe, memoized) ───────────────────────── */

/** Resolve one active, non-empty BOM per manufactured product (deterministic by number). */
export function buildBomMap(boms: BillOfMaterials[]): Map<string, BillOfMaterials> {
  const map = new Map<string, BillOfMaterials>();
  const active = boms
    .filter((b) => b.status !== 'archived' && b.product !== '' && b.components.length > 0)
    .sort((a, b) => a.bomNumber.localeCompare(b.bomNumber));
  for (const b of active) if (!map.has(b.product)) map.set(b.product, b);
  return map;
}

export interface BomLowLevelResult {
  /** sku → low-level code (the deepest level at which the item appears in any BOM). */
  levels: Map<string, number>;
  /** Detected BOM cycles (each an ordered sku path). Their back-edges are never followed. */
  cycles: string[][];
}

/**
 * Compute low-level codes (max depth per item) with cycle detection + memoization.
 * Deterministic: items are visited in sorted order. A back-edge (an item already on the
 * current path) is recorded as a cycle and NOT followed, so explosion always terminates.
 */
export function computeBomLowLevelCodes(boms: BillOfMaterials[]): BomLowLevelResult {
  const bomMap = buildBomMap(boms);
  const levels = new Map<string, number>();
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const allSkus = new Set<string>();
  for (const b of boms) {
    if (b.product) allSkus.add(b.product);
    for (const c of b.components) if (c.sku) allSkus.add(c.sku);
  }

  const visit = (sku: string, depth: number, path: string[]): void => {
    if (depth > MAX_BOM_DEPTH) return;
    if (path.includes(sku)) {
      const cycle = [...path.slice(path.indexOf(sku)), sku];
      const key = cycle.join('>');
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        cycles.push(cycle);
      }
      return; // drop the back-edge — never follow a cycle
    }
    const prev = levels.get(sku) ?? -1;
    if (depth <= prev) return; // memoized: this subtree is already explored at >= this depth
    levels.set(sku, depth);
    const bom = bomMap.get(sku);
    if (!bom) return;
    const nextPath = [...path, sku];
    for (const c of [...bom.components].sort((a, b) => a.sku.localeCompare(b.sku))) {
      if (c.sku) visit(c.sku, depth + 1, nextPath);
    }
  };

  for (const sku of [...allSkus].sort()) visit(sku, 0, []);
  return { levels, cycles };
}

/* ── multi-level netting ────────────────────────────────────────────────────── */

export interface MrpBomLine {
  sku: string;
  name: string;
  level: number;
  independentDemand: number;
  dependentDemand: number;
  grossRequirement: number;
  onHand: number;
  available: number;
  incoming: number;
  netRequirement: number;
  isManufactured: boolean;
  isKnownProduct: boolean;
  recommendation: MrpRecommendation;
  critical: boolean;
}

export interface MultiLevelMrpResult {
  lines: MrpBomLine[];
  cycles: string[][];
}

/**
 * True multi-level MRP. Independent (finished-goods) demand seeds the gross requirement;
 * processing items in ascending low-level code nets each (demand − available − incoming)
 * and explodes only the NET requirement of a manufactured item into its components'
 * dependent demand — so parents are fully accumulated before a child is netted. Pure.
 */
export function runMultiLevelMrp(input: PlanningInput): MultiLevelMrpResult {
  const bomMap = buildBomMap(input.boms);
  const { levels, cycles } = computeBomLowLevelCodes(input.boms);
  const productBySku = new Map(input.products.map((p) => [p.sku, p]));

  const allSkus = new Set<string>();
  for (const p of input.products) allSkus.add(p.sku);
  for (const b of input.boms) {
    if (b.product) allSkus.add(b.product);
    for (const c of b.components) if (c.sku) allSkus.add(c.sku);
  }

  const independent = new Map<string, number>();
  const gross = new Map<string, number>();
  for (const sku of allSkus) {
    const d = calculateForecastDemand(sku, input.salesOrders, input.shipments);
    independent.set(sku, d);
    gross.set(sku, d);
  }

  // Process parents (lower low-level code) before children so gross is complete when netted.
  const ordered = [...allSkus].sort((a, b) => (levels.get(a) ?? 0) - (levels.get(b) ?? 0) || a.localeCompare(b));

  const lines: MrpBomLine[] = [];
  for (const sku of ordered) {
    const product = productBySku.get(sku);
    const available = product ? product.availableStock : 0;
    const onHand = product ? product.currentStock : 0;
    const incoming = calculateIncomingSupply(sku, input.purchaseOrders, input.productionOrders);
    const grossReq = gross.get(sku) ?? 0;
    const netRequirement = Math.max(0, Math.round(grossReq - available - incoming));
    const bom = bomMap.get(sku);
    const isManufactured = Boolean(bom);

    // Explode ONLY the net requirement into dependent demand for the components.
    if (bom && netRequirement > 0) {
      for (const c of bom.components) {
        if (!c.sku) continue;
        const childQty = componentConsumption(c, netRequirement, bom.waste);
        gross.set(c.sku, (gross.get(c.sku) ?? 0) + childQty);
      }
    }

    const level = levels.get(sku) ?? 0;
    const recommendation: MrpRecommendation = netRequirement > 0 ? (isManufactured ? 'produce' : 'purchase') : 'ok';
    const isKnownProduct = Boolean(product);
    const critical = netRequirement > 0 && (available < 0 || !isKnownProduct || (!isManufactured && level > 0));
    lines.push({
      sku,
      name: product?.name || sku,
      level,
      independentDemand: independent.get(sku) ?? 0,
      dependentDemand: Math.max(0, Math.round(grossReq - (independent.get(sku) ?? 0))),
      grossRequirement: grossReq,
      onHand,
      available,
      incoming,
      netRequirement,
      isManufactured,
      isKnownProduct,
      recommendation,
      critical,
    });
  }
  return { lines, cycles };
}

/** Lines with a positive net requirement (real shortages). Deterministic. */
export function materialShortages(result: MultiLevelMrpResult): MrpBomLine[] {
  return result.lines.filter((l) => l.netRequirement > 0);
}

/** Critical material alerts — shortages that block production (raw/missing/oversold). Deterministic. */
export function criticalMaterialAlerts(result: MultiLevelMrpResult): MrpBomLine[] {
  return result.lines.filter((l) => l.critical);
}

/** Production requirements — manufactured shortages, in build sequence (deepest first). Deterministic. */
export function productionSequence(result: MultiLevelMrpResult): MrpBomLine[] {
  return result.lines
    .filter((l) => l.recommendation === 'produce')
    .sort((a, b) => b.level - a.level || a.sku.localeCompare(b.sku));
}

/** Purchase requirements — purchased shortages, deepest first. Deterministic. */
export function purchaseRequirements(result: MultiLevelMrpResult): MrpBomLine[] {
  return result.lines
    .filter((l) => l.recommendation === 'purchase')
    .sort((a, b) => b.netRequirement - a.netRequirement || a.sku.localeCompare(b.sku));
}

/** Suggested supplier — best active supplier by rating then lead time. Deterministic. */
export function selectSupplier(suppliers: Supplier[]): Supplier | null {
  const active = suppliers
    .filter((s) => s.status === 'active')
    .sort((a, b) => b.vendorRating - a.vendorRating || a.leadTime - b.leadTime || a.name.localeCompare(b.name));
  return active[0] ?? null;
}

/** Missing component SKUs referenced by BOMs but absent from the product master. Deterministic. */
export function missingComponents(input: PlanningInput): string[] {
  const known = new Set(input.products.map((p) => p.sku));
  const missing = new Set<string>();
  for (const b of input.boms) for (const c of b.components) if (c.sku && !known.has(c.sku)) missing.add(c.sku);
  return [...missing].sort();
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface MrpModuleInsights {
  materialCoverage: number;
  componentAvailability: number;
  bomHealth: number;
  mrpCoverage: number;
  supplyReadiness: number;
  productionReadiness: number;
  procurementReadiness: number;
  criticalMaterialCount: number;
  planningConfidence: number;
  overallMrpScore: number;
}

/** Roll the multi-level MRP into the Executive MRP KPIs. Pure. */
export function deriveMrpInsights(input: PlanningInput): MrpModuleInsights {
  const result = runMultiLevelMrp(input);
  const lines = result.lines;
  const components = lines.filter((l) => l.level > 0);
  const demanded = lines.filter((l) => l.grossRequirement > 0);
  const shortages = lines.filter((l) => l.netRequirement > 0);

  const materialCoverage =
    components.length === 0
      ? 100
      : clamp(Math.round((components.filter((l) => l.available + l.incoming >= l.grossRequirement).length / components.length) * 100), 0, 100);
  const componentAvailability =
    components.length === 0 ? 100 : clamp(Math.round((components.filter((l) => l.available > 0).length / components.length) * 100), 0, 100);

  const missing = missingComponents(input).length;
  const bomHealth = clamp(100 - result.cycles.length * 25 - missing * 10, 0, 100);

  const mrpCoverage = demanded.length === 0 ? 100 : clamp(Math.round(((demanded.length - shortages.length) / demanded.length) * 100), 0, 100);
  const supplyReadiness =
    shortages.length === 0 ? 100 : clamp(Math.round((shortages.filter((l) => l.incoming > 0).length / shortages.length) * 100), 0, 100);

  const produceShortages = shortages.filter((l) => l.recommendation === 'produce');
  const shortageSkus = new Set(shortages.map((l) => l.sku));
  const bomMap = buildBomMap(input.boms);
  const productionReadiness =
    produceShortages.length === 0
      ? 100
      : clamp(
          Math.round(
            (produceShortages.filter((l) => {
              const bom = bomMap.get(l.sku);
              return bom ? bom.components.every((c) => !shortageSkus.has(c.sku)) : false;
            }).length /
              produceShortages.length) *
              100,
          ),
          0,
          100,
        );

  const activeSuppliers = input.suppliers.filter((s) => s.status === 'active').length;
  const procurementReadiness = input.suppliers.length === 0 ? 100 : clamp(Math.round((activeSuppliers / input.suppliers.length) * 100), 0, 100);

  const criticalMaterialCount = criticalMaterialAlerts(result).length;
  const planningConfidence = clamp(Math.round((bomHealth + mrpCoverage + materialCoverage) / 3), 0, 100);
  const overallMrpScore = clamp(
    Math.round((materialCoverage + mrpCoverage + supplyReadiness + productionReadiness + procurementReadiness + bomHealth) / 6),
    0,
    100,
  );

  return {
    materialCoverage,
    componentAvailability,
    bomHealth,
    mrpCoverage,
    supplyReadiness,
    productionReadiness,
    procurementReadiness,
    criticalMaterialCount,
    planningConfidence,
    overallMrpScore,
  };
}

/** Map MRP insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function mrpInsightsToKpis(insights: MrpModuleInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const criticalBand: ExecutiveKpi['band'] =
    insights.criticalMaterialCount === 0 ? 'healthy' : insights.criticalMaterialCount <= 3 ? 'watch' : 'at-risk';
  return [
    { key: 'mrp-material-coverage', label: 'Material Coverage', value: insights.materialCoverage, display: `${insights.materialCoverage}%`, band: pctBand(insights.materialCoverage), deepLink: 'enterprise/executive' },
    { key: 'mrp-component-avail', label: 'Component Availability', value: insights.componentAvailability, display: `${insights.componentAvailability}%`, band: pctBand(insights.componentAvailability), deepLink: 'enterprise/executive' },
    { key: 'mrp-bom-health', label: 'BOM Health', value: insights.bomHealth, display: `${insights.bomHealth}%`, band: pctBand(insights.bomHealth), deepLink: 'enterprise/executive' },
    { key: 'mrp-coverage', label: 'MRP Coverage', value: insights.mrpCoverage, display: `${insights.mrpCoverage}%`, band: pctBand(insights.mrpCoverage), deepLink: 'enterprise/executive' },
    { key: 'mrp-supply-ready', label: 'Supply Readiness', value: insights.supplyReadiness, display: `${insights.supplyReadiness}%`, band: pctBand(insights.supplyReadiness), deepLink: 'enterprise/executive' },
    { key: 'mrp-prod-ready', label: 'Production Readiness', value: insights.productionReadiness, display: `${insights.productionReadiness}%`, band: pctBand(insights.productionReadiness), deepLink: 'enterprise/executive' },
    { key: 'mrp-proc-ready', label: 'Procurement Readiness', value: insights.procurementReadiness, display: `${insights.procurementReadiness}%`, band: pctBand(insights.procurementReadiness), deepLink: 'enterprise/executive' },
    { key: 'mrp-critical', label: 'Critical Material Count', value: insights.criticalMaterialCount, display: `${insights.criticalMaterialCount}`, band: criticalBand, deepLink: 'enterprise/executive' },
    { key: 'mrp-confidence', label: 'Planning Confidence', value: insights.planningConfidence, display: `${insights.planningConfidence}%`, band: pctBand(insights.planningConfidence), deepLink: 'enterprise/executive' },
    { key: 'mrp-overall', label: 'Overall MRP Score', value: insights.overallMrpScore, display: `${insights.overallMrpScore}`, band: pctBand(insights.overallMrpScore), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (flow into the existing Executive recommendation system) ── */

function priorityForLine(line: MrpBomLine): ExecRecoPriority {
  if (line.critical || line.available < 0) return 'critical';
  if (line.level === 0) return 'high';
  return 'medium';
}
function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

/**
 * Deterministic multi-level MRP recommendations — dependent purchase/production actions
 * derived from the BOM explosion, shaped as ExecutiveRecommendations so they surface
 * through the EXISTING Executive recommendation + timeline system. Each carries the
 * calculations that produced it (gross/available/incoming/dependent/net); AI explains,
 * it never computes. Cycles surface as a data-integrity recommendation.
 */
export function mrpRecommendations(input: PlanningInput, limit = 15): ExecutiveRecommendation[] {
  const result = runMultiLevelMrp(input);
  const recs: ExecutiveRecommendation[] = [];
  const supplier = selectSupplier(input.suppliers);
  const constrained = new Set(calculateCapacityPlan(input.machines).filter((c) => c.constrained).map((c) => c.machine));

  for (const line of materialShortages(result)) {
    const priority = priorityForLine(line);
    const produce = line.recommendation === 'produce';
    const evidence = [
      `level=${line.level}`,
      `gross=${line.grossRequirement}`,
      `independent=${line.independentDemand}`,
      `dependent=${line.dependentDemand}`,
      `available=${line.available}`,
      `incoming=${line.incoming}`,
      `net=${line.netRequirement}`,
    ];
    if (produce) {
      const capacityNote = constrained.size > 0 ? ` Capacity is constrained (${[...constrained].sort().join(', ')} ≥ ${CAPACITY_CONSTRAINT_THRESHOLD}%).` : '';
      recs.push({
        id: `mrp:produce:${line.sku}`,
        metric: 'production',
        icon: 'cpu',
        problem: `${line.name} (${line.sku}) — net production requirement ${line.netRequirement} (level ${line.level}).`,
        businessImpact: 'A subassembly/finished-goods shortfall blocks downstream demand.',
        rootCause: `Gross ${line.grossRequirement} (dependent ${line.dependentDemand}) − available ${line.available} − incoming ${line.incoming} = ${line.netRequirement}.`,
        priority,
        confidence: 0.9,
        expectedOutcome: `A production order for ${line.netRequirement} closes the gap; build deepest subassemblies first.${capacityNote}`,
        evidence,
        sourceSystems: ['planning', 'mrp', 'manufacturing'],
        recommendedAction: `Raise a production order for ${line.netRequirement} of ${line.sku}.`,
        owner: 'Production Planner',
        eta: priority === 'critical' ? 'today' : 'this week',
        status: 'open',
        score: rank(priority, 0.9),
      });
    } else {
      const via = supplier ? ` via ${supplier.name} (~${supplier.leadTime}d lead time)` : '';
      recs.push({
        id: `mrp:purchase:${line.sku}`,
        metric: 'procurement',
        icon: 'shopping-cart',
        problem: `${line.name} (${line.sku}) — net purchase requirement ${line.netRequirement} (level ${line.level})${line.isKnownProduct ? '' : ' [missing from product master]'}.`,
        businessImpact: 'A raw-material shortage halts every assembly that consumes it.',
        rootCause: `Gross ${line.grossRequirement} (dependent ${line.dependentDemand}) − available ${line.available} − incoming ${line.incoming} = ${line.netRequirement}.`,
        priority,
        confidence: 0.9,
        expectedOutcome: `A purchase request for ${line.netRequirement}${via} closes the gap.`,
        evidence,
        sourceSystems: ['planning', 'mrp', 'procurement'],
        recommendedAction: `Raise a purchase request for ${line.netRequirement} of ${line.sku}${via}.`,
        owner: 'Procurement',
        eta: priority === 'critical' ? 'today' : 'this week',
        status: 'open',
        score: rank(priority, 0.9),
      });
    }
  }

  for (const cycle of result.cycles) {
    recs.push({
      id: `mrp:cycle:${cycle.join('>')}`,
      metric: 'bom',
      icon: 'alert-triangle',
      problem: `BOM cycle detected: ${cycle.join(' → ')}.`,
      businessImpact: 'A circular BOM cannot be planned; the back-edge was dropped so planning could proceed.',
      rootCause: 'A component references an ancestor assembly, forming a cycle.',
      priority: 'high',
      confidence: 1,
      expectedOutcome: 'Correcting the BOM restores complete explosion for the affected items.',
      evidence: [`cycle=${cycle.join('>')}`],
      sourceSystems: ['planning', 'mrp', 'manufacturing'],
      recommendedAction: `Fix the circular reference in the BOM path ${cycle.join(' → ')}.`,
      owner: 'Manufacturing',
      eta: 'this week',
      status: 'open',
      score: rank('high', 1),
    });
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}
