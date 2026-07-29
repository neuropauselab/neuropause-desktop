/**
 * Module 14 — Executive AI. CEO / CFO / COO / CTO / CRO / CHRO briefings built ONLY from real
 * runtime data via the reused Wave 8 business platform. Any metric with no data reads 'No business
 * data available' — no KPI is fabricated.
 */
import { NO_WORKFORCE_DATA, type ExecutiveBriefingRole } from './constants';
import type { WorkforceContext } from './types';

export interface ExecutiveBriefing {
  role: ExecutiveBriefingRole;
  metrics: Record<string, number | string>;
  note: string;
}

const orNoData = (count: number, value: number): number | string => (count > 0 ? value : NO_WORKFORCE_DATA);

export class ExecutiveAI {
  constructor(private readonly ctx: WorkforceContext = {}) {}

  briefing(role: ExecutiveBriefingRole): ExecutiveBriefing {
    const b = this.ctx.business;
    const metrics: Record<string, number | string> = {};
    if (!b) {
      return { role, metrics: { status: NO_WORKFORCE_DATA }, note: 'no business platform connected — briefing withheld, not fabricated' };
    }
    const crm = b.crm().counts();
    switch (role) {
      case 'CEO':
        metrics['customers'] = orNoData(crm.accounts, crm.accounts);
        metrics['headcount'] = orNoData(b.hr().count(), b.hr().count());
        metrics['pipeline'] = orNoData(crm.opportunities, b.sales().pipeline().openValue);
        break;
      case 'CFO': {
        const fin = b.accounting().financialStatements();
        metrics['netIncome'] = fin.hasData ? fin.netIncome : NO_WORKFORCE_DATA;
        metrics['receivables'] = orNoData(b.accounting().count(), b.accounting().receivablesOutstanding());
        break;
      }
      case 'COO':
        metrics['suppliers'] = orNoData(b.procurement().suppliers().length, b.procurement().suppliers().length);
        metrics['inventoryMovements'] = orNoData(b.inventory().count(), b.inventory().count());
        break;
      case 'CTO':
        metrics['projects'] = orNoData(b.projects().count(), b.projects().count());
        metrics['assets'] = orNoData(b.assets().count(), b.assets().count());
        break;
      case 'CRO': {
        metrics['pipeline'] = orNoData(crm.opportunities, b.sales().pipeline().openValue);
        const wl = b.sales().winLoss();
        metrics['winRate'] = wl.winRate ?? NO_WORKFORCE_DATA;
        break;
      }
      case 'CHRO':
        metrics['headcount'] = orNoData(b.hr().count(), b.hr().count());
        metrics['openRequisitions'] = orNoData(b.hr().requisitions().length, b.hr().requisitions().length);
        break;
    }
    return { role, metrics, note: "built only from real runtime data; empty metrics show 'No business data available'" };
  }
}
