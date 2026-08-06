/**
 * Manufacturing → BOM Explosion — the pure multi-level requirements engine +
 * snapshot domain (W3.6).
 *
 * The existing BOM module is single-level: one finished product, its direct
 * components. The explosion walks the WHOLE tree: components that themselves
 * have an active BOM are sub-assemblies and recurse; purchased items aggregate
 * into a total-requirements list; the cost rollup prices those leaves at the
 * product register's standard cost (unvalued leaves counted, never hidden).
 *
 * REUSE, not reinvention: per-level quantities come from the CERTIFIED
 * `componentConsumption` rule the execution module already consumes stock
 * with — identical math, one source of truth. BOM selection is deterministic:
 * the ACTIVE BOM with the greatest revision (then BOM number) wins.
 *
 * SAFETY: cycles (a sub-assembly that eventually contains itself) are
 * DETECTED and reported — the branch stops, the row is flagged, the cycle
 * path is listed; the engine never loops. Depth is capped (default 10) and a
 * hit cap is reported, never silent.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { BillOfMaterials } from './manufacturing';
import { componentConsumption } from './manufacturing';
import type { Product } from './inventory';

/** The BOM Explosions module id + record kind (the framework store key). */
export const BOM_EXPLOSIONS_MODULE_ID = 'manufacturing-bom-explosions';
export const BOM_EXPLOSION_KIND = 'bomExplosion';

/** One node of the exploded tree (components only; the root is the header). */
export interface ExplosionRow {
  sku: string;
  level: number;
  quantity: number;
  viaBom: string;
  /** The sku chain from the root, ' > '-joined — the audit path. */
  path: string;
  subassembly: boolean;
  cycle: boolean;
}

/** One purchased-item line of the aggregated requirements. */
export interface ExplosionRequirement {
  sku: string;
  totalQuantity: number;
  standardCost: number;
  cost: number;
  unvalued: boolean;
}

export interface BomExplosionResult {
  rows: ExplosionRow[];
  requirements: ExplosionRequirement[];
  maxLevel: number;
  componentCount: number;
  totalMaterialCost: number;
  unvaluedCount: number;
  cycles: string[];
  depthCapped: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The deterministic BOM pick: active, greatest revision, then BOM number. */
export function activeBomFor(boms: BillOfMaterials[], sku: string): BillOfMaterials | null {
  let winner: BillOfMaterials | null = null;
  for (const bom of boms) {
    if (bom.product !== sku || bom.status !== 'active') continue;
    if (
      !winner ||
      bom.revision > winner.revision ||
      (bom.revision === winner.revision && bom.bomNumber > winner.bomNumber)
    ) {
      winner = bom;
    }
  }
  return winner;
}

/** The multi-level explosion — see the header for the exact rules. */
export function explodeBom(
  boms: BillOfMaterials[],
  products: Product[],
  rootSku: string,
  rootQuantity: number,
  maxDepth = 10,
): BomExplosionResult {
  const rows: ExplosionRow[] = [];
  const totals = new Map<string, number>();
  const cycles: string[] = [];
  let depthCapped = false;
  let maxLevel = 0;

  const walk = (sku: string, quantity: number, level: number, ancestry: string[]): void => {
    const bom = activeBomFor(boms, sku);
    if (!bom) {
      // Purchased item — aggregate into the requirements.
      totals.set(sku, (totals.get(sku) ?? 0) + quantity);
      return;
    }
    if (level >= maxDepth) {
      depthCapped = true;
      totals.set(sku, (totals.get(sku) ?? 0) + quantity); // treated as purchased at the cap — reported
      return;
    }
    for (const component of bom.components) {
      const childQty = componentConsumption(component, quantity, bom.waste);
      const path = [...ancestry, sku, component.sku].join(' > ');
      const isCycle = ancestry.includes(component.sku) || component.sku === sku;
      const childBom = isCycle ? null : activeBomFor(boms, component.sku);
      rows.push({
        sku: component.sku,
        level: level + 1,
        quantity: childQty,
        viaBom: bom.bomNumber,
        path,
        subassembly: Boolean(childBom),
        cycle: isCycle,
      });
      maxLevel = Math.max(maxLevel, level + 1);
      if (isCycle) {
        cycles.push(path);
        continue; // the branch stops — never loops
      }
      walk(component.sku, childQty, level + 1, [...ancestry, sku]);
    }
  };

  walk(rootSku, rootQuantity, 0, []);

  const costBySku = new Map<string, number>(products.map((p) => [p.sku, p.standardCost]));
  const requirements: ExplosionRequirement[] = [...totals.entries()]
    .map(([sku, totalQuantity]) => {
      const standardCost = costBySku.get(sku) ?? 0;
      return {
        sku,
        totalQuantity,
        standardCost,
        cost: round2(totalQuantity * standardCost),
        unvalued: standardCost <= 0,
      };
    })
    .sort((a, b) => b.cost - a.cost || a.sku.localeCompare(b.sku));

  return {
    rows,
    requirements,
    maxLevel,
    componentCount: rows.length,
    totalMaterialCost: round2(requirements.reduce((s, r) => s + r.cost, 0)),
    unvaluedCount: requirements.filter((r) => r.unvalued).length,
    cycles,
    depthCapped,
  };
}
