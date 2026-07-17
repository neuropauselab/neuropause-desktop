import type { SectionId } from '@renderer/shell/sections';

/**
 * Map an Executive Center card/KPI deepLink (produced by the V2.4 composition
 * layer) to the existing renderer SectionId, so cards navigate into the real
 * modules instead of duplicating detail views. Pure + unit-tested.
 *
 * The composition layer emits path-like deepLinks (e.g. 'enterprise/organization',
 * 'ai-workforce/founder'); we resolve the leading segment to a section the shell
 * already renders. Every target must be a VISIBLE section — unknown links fall back to the canonical
 * 'intent-home' (never a retired/hidden section, never throws).
 */
export function deepLinkToSection(deepLink: string | undefined): SectionId {
  if (!deepLink) return 'intent-home';
  const head = deepLink.split('/')[0];
  switch (head) {
    case 'enterprise':
      // enterprise/organization and enterprise/briefings both live under enterprise
      return deepLink.includes('organization') ? 'organization' : 'enterprise';
    case 'ai-workforce':
      return 'workforce';
    case 'connectors':
      return 'connectors';
    case 'notifications':
      return 'notifications';
    case 'memory':
      return 'memory';
    case 'settings':
      return 'settings';
    case 'analytics':
      // 'analytics' was a retired section (folded into the Ops Center analyst view).
      return 'opscenter';
    default:
      return 'intent-home';
  }
}
