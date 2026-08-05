/**
 * EPIC 11 — Website Platform. Represents the marketing/site pages (home, products, solutions, pricing,
 * enterprise, downloads, documentation, blog, contact, login, signup). These are CONTENT DESCRIPTORS —
 * the site is NOT publicly live until it is actually deployed to real hosting behind the domain. This
 * never claims the site is live.
 */
import { WEBSITE_PAGES, TARGET_DOMAIN, type WebsitePage } from './constants';
import type { CustomerExperienceGovernance } from './governance';

export interface PageDescriptor {
  page: WebsitePage;
  path: string;
  published: false; // represented — not publicly live until deployed
}

export class WebsitePlatform {
  private readonly pages = new Map<WebsitePage, PageDescriptor>();

  constructor(
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {
    for (const page of WEBSITE_PAGES) this.pages.set(page, { page, path: page === 'home' ? '/' : `/${page}`, published: false });
  }

  pageList(): PageDescriptor[] {
    return [...this.pages.values()];
  }
  page(name: WebsitePage): PageDescriptor | undefined {
    return this.pages.get(name);
  }

  async declare(page: WebsitePage, path: string): Promise<PageDescriptor> {
    if (!WEBSITE_PAGES.includes(page)) throw new Error(`unknown page: ${page}`);
    const descriptor: PageDescriptor = { page, path, published: false };
    this.pages.set(page, descriptor);
    await this.gov.record({ actor: this.operator, customer: '_website', organization: '_cx', epic: 'E11', operation: 'declare-page', targetId: page, evidence: 'live-verified', decision: path });
    return descriptor;
  }

  /** Honest deployment status — the site is NOT publicly live. */
  deploymentStatus(): { domain: string; live: false; pages: number; note: string } {
    return { domain: TARGET_DOMAIN, live: false, pages: this.pages.size, note: `${this.pages.size} pages represented; the site is NOT publicly live until deployed to real hosting behind ${TARGET_DOMAIN}.` };
  }
}
