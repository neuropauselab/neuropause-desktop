/**
 * CRM → Marketing Campaigns — campaign domain types + the pure attribution
 * engine (W5.1).
 *
 * Campaigns join the CRM family because attribution IS CRM machinery: every
 * lead already carries a free-text `campaign` field (the historical
 * convention), and the engine matches leads to a campaign by that exact name
 * — no fuzzy matching, stated on every summary. Attribution is computed at
 * READ over the live lead set (leads keep arriving), never stamped stale:
 * lead counts, open pipeline value, won/lost outcomes, and cost-per-lead
 * (null when no leads — never a divide-by-zero fabrication). Campaigns
 * archive through the W1 marker pattern.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { CrmLead } from './leads';
import { calculateLeadScore } from './leads';
import type { EnterpriseEntity } from './enterpriseModule';

/** The Campaigns module id + record kind (the framework store key). */
export const CAMPAIGNS_MODULE_ID = 'crm-campaigns';
export const CAMPAIGN_KIND = 'campaign';

export type CampaignChannel = 'email' | 'social' | 'event' | 'web' | 'other';

/** A typed view over a campaign record's flat fields. */
export interface MarketingCampaign {
  id: string;
  campaignName: string;
  channel: CampaignChannel;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  owner: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Project a framework record into a typed campaign. */
export function campaignFromRecord(record: EnterpriseEntity): MarketingCampaign {
  const f = record.fields;
  const channel = str(f.channel);
  return {
    id: record.id,
    campaignName: str(f.campaignName) || record.title,
    channel: (['email', 'social', 'event', 'web', 'other'] as const).includes(channel as CampaignChannel)
      ? (channel as CampaignChannel)
      : 'other',
    budget: num(f.budget),
    startDate: str(f.startDate) || null,
    endDate: str(f.endDate) || null,
    owner: str(f.owner),
    archivedAt: str(f.archivedAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface CampaignAttribution {
  leads: number;
  openLeads: number;
  won: number;
  lost: number;
  openPipelineValue: number;
  wonValue: number;
  averageLeadScore: number;
  /** budget ÷ leads; null when no leads — never fabricated. */
  costPerLead: number | null;
  /** won ÷ (won + lost) × 100; null when nothing closed. */
  winRate: number | null;
}

/**
 * The attribution engine: leads whose `campaign` equals the campaign name
 * EXACTLY. Computed at read over the live lead set — always current.
 */
export function deriveCampaignAttribution(
  leads: CrmLead[],
  campaignName: string,
  budget: number,
): CampaignAttribution {
  const mine = leads.filter((l) => l.campaign === campaignName);
  let openLeads = 0;
  let won = 0;
  let lost = 0;
  let openPipelineValue = 0;
  let wonValue = 0;
  let scoreSum = 0;
  for (const lead of mine) {
    scoreSum += calculateLeadScore(lead);
    if (lead.stage === 'won') {
      won += 1;
      wonValue += lead.dealValue;
    } else if (lead.stage === 'lost' || lead.stage === 'archived') {
      lost += 1;
    } else {
      openLeads += 1;
      openPipelineValue += lead.dealValue;
    }
  }
  const closed = won + lost;
  return {
    leads: mine.length,
    openLeads,
    won,
    lost,
    openPipelineValue: round2(openPipelineValue),
    wonValue: round2(wonValue),
    averageLeadScore: mine.length === 0 ? 0 : Math.round(scoreSum / mine.length),
    costPerLead: mine.length === 0 || budget <= 0 ? null : round2(budget / mine.length),
    winRate: closed === 0 ? null : Math.round((won / closed) * 100),
  };
}
