/**
 * Backend-backed repository layer. This is the "flip" the codebase was designed
 * for: the same CatalogRepository interface the UI already depends on, now
 * fulfilled by the real Store catalog over the secure IPC bridge (renderer →
 * preload → main → Store API → PostgreSQL). No component changes.
 *
 * The dashboard remains the local demo source until Activity Intelligence
 * (Phase 5); only the catalog is live here.
 *
 * Mapping note: the backend's stable `slug` becomes the renderer `id`, so the
 * launcher, palette, and Workspace tabs (all keyed by id) keep working. The
 * richer Store surface (detail pages, reviews, pricing, install) is built
 * directly on the fuller DTOs in Stage 3.
 */
import type { StoreAppCard, StoreAppDetail } from '@neuropause/shared';
import type { AppCategory, AppTone, CatalogApp } from '@renderer/data/types';
import { getApp } from '@renderer/data/catalog';
import { ipc } from '@renderer/lib/ipc';
import type { CatalogRepository, Services } from './repositories';
import { createLocalServices } from './localRepositories';

const CATEGORY_MAP: Record<string, AppCategory> = {
  writing: 'Writing',
  coding: 'Coding',
  image: 'Image',
  video: 'Video',
  voice: 'Voice',
  automation: 'Automation',
  business: 'Business',
  research: 'Research',
  productivity: 'Productivity',
  design: 'Image',
  data: 'Research',
};

const TONES: AppTone[] = ['accent', 'blue', 'green', 'orange', 'purple', 'teal', 'pink'];

function mapCategory(slug: string): AppCategory {
  return CATEGORY_MAP[slug] ?? 'Productivity';
}

function mapTone(tone: string): AppTone {
  return (TONES as string[]).includes(tone) ? (tone as AppTone) : 'accent';
}

/** Fields shared by the card and detail shapes used for the launcher view. */
interface MappableApp {
  slug: string;
  name: string;
  tagline: string;
  iconGlyph: string | null;
  iconTone: string | null;
  developer: { name: string };
  category: { slug: string };
}

function deriveGlyph(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

function mapToCatalogApp(a: MappableApp): CatalogApp {
  return {
    id: a.slug,
    name: a.name,
    developer: a.developer.name,
    category: mapCategory(a.category.slug),
    tagline: a.tagline,
    tone: mapTone(a.iconTone ?? 'accent'),
    glyph: a.iconGlyph ?? deriveGlyph(a.name),
    // Connection state arrives with Connectors (Phase 4); preserve the prior
    // demo state for apps that had it so the launcher looks unchanged.
    connected: getApp(a.slug)?.connected ?? false,
  };
}

class HttpCatalogRepository implements CatalogRepository {
  async list(): Promise<CatalogApp[]> {
    // A broad trending page is plenty for the launcher/store grid surfaces.
    const page = await ipc.catalog.sections('trending', 1, 60);
    return (page.items as StoreAppCard[]).map(mapToCatalogApp);
  }

  async get(id: string): Promise<CatalogApp | null> {
    try {
      const detail = (await ipc.catalog.app(id)) as StoreAppDetail;
      return mapToCatalogApp(detail);
    } catch {
      return null;
    }
  }
}

/**
 * Backend-backed service set. Catalog is live over IPC; dashboard stays local
 * until Phase 5. Swap-in point lives in ServicesProvider.
 */
export function createHttpServices(): Services {
  const local = createLocalServices();
  return {
    catalog: new HttpCatalogRepository(),
    dashboard: local.dashboard,
  };
}
