import type { OAuthProvider, OAuthProviderId } from './types';
import { googleProvider } from './google';
import { githubProvider } from './github';
import { microsoftProvider } from './microsoft';
import { appleProvider } from './apple';

const ALL: Record<OAuthProviderId, OAuthProvider> = {
  google: googleProvider,
  github: githubProvider,
  microsoft: microsoftProvider,
  apple: appleProvider,
};

export function getProvider(id: OAuthProviderId): OAuthProvider {
  return ALL[id];
}

/** Provider ids that are actually configured/enabled in this environment. */
export function enabledProviderIds(): OAuthProviderId[] {
  return (Object.keys(ALL) as OAuthProviderId[]).filter((id) => ALL[id].isEnabled());
}
