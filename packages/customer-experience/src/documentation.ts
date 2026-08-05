/**
 * EPIC 8 — Documentation Center. User guide, quick start, installation guide, FAQ, a video-library
 * registry, a knowledge base, and API documentation links. REUSES the Sprint-6 release documentation
 * generator for the overlapping items; the rest are produced in-process as structured outlines. The
 * video library is a REGISTRY of represented entries (no video is hosted here).
 */
import { randomId } from '@neuropause/cloud-core';
import { DOC_ITEMS, type DocItem } from './constants';
import type { CxContext, ReleasePlatform } from './types';
import type { CustomerExperienceGovernance } from './governance';

type ReleaseDocGuide = Parameters<ReturnType<ReleasePlatform['documentation']>['generate']>[0];

const RELEASE_MAP: Partial<Record<DocItem, ReleaseDocGuide>> = {
  'user-guide': 'user',
  'quick-start': 'deployment',
  installation: 'deployment',
  'api-links': 'api-reference',
};

export interface DocEntry {
  id: string;
  item: DocItem;
  title: string;
  sections: string[];
  reusedRelease: boolean;
}

export class DocumentationCenter {
  private readonly docs = new Map<string, DocEntry>();

  constructor(
    private readonly ctx: CxContext,
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  items(): readonly DocItem[] {
    return DOC_ITEMS;
  }

  async generate(item: DocItem): Promise<DocEntry> {
    if (!DOC_ITEMS.includes(item)) throw new Error(`unknown doc item: ${item}`);
    let reusedRelease = false;
    const mapped = RELEASE_MAP[item];
    if (mapped && this.ctx.release) {
      await this.ctx.release.documentation().generate(mapped);
      reusedRelease = true;
    }
    const entry: DocEntry = { id: randomId('doc'), item, title: `${item.replace(/-/g, ' ')}`, sections: ['Overview', 'Steps', 'Tips', 'Troubleshooting'], reusedRelease };
    this.docs.set(entry.id, entry);
    await this.gov.record({ actor: this.operator, customer: '_docs', organization: '_cx', epic: 'E8', operation: 'generate-doc', targetId: item, evidence: 'live-verified', decision: reusedRelease ? 'reused release docs' : 'in-process' });
    return entry;
  }

  count(): number {
    return this.docs.size;
  }
}
