/**
 * A real round-trip to the provider, after authentication.
 *
 * WHY THIS EXISTS
 *
 * `checkHealth` is structural: it looks at the stored status and the token
 * expiry and pings nothing. It says so in its own header. So "Connected" meant
 * "a token exchange returned 200" — not that the credential works, not that
 * the granted scopes are the ones we asked for, and not that we know whose
 * account it is.
 *
 * WHAT IT PRODUCES
 *
 * The one thing the connector framework was missing: a STABLE PROVIDER
 * IDENTITY. `ConnectedAccount.externalId` existed and was populated only from
 * whatever the token response happened to carry — `null` for GitHub,
 * Salesforce, HubSpot, ServiceNow and most of the rest — so accounts rendered
 * as "GitHub account" and reconnecting produced a second row nothing could
 * detect as a duplicate. This asks the provider who it is.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * Not a second HTTP client, not a second auth path: it uses the sync layer's
 * `HttpClient`, so it is rate-gated and its errors land in the same taxonomy
 * (`AuthError`, `RateLimitError`, `NetworkError`) the sync engine already
 * distinguishes. A provider with no identity endpoint declared is honestly
 * "cannot be verified" — never a green tick by default.
 */
import type { ConnectorId } from '@neuropause/shared';
import { AuthError, HttpClient, RateLimitError, type RateGate } from '../unified/sync/http';

/** Where a provider says who you are, and how to read the answer. */
export interface IdentityProbe {
  /** Absolute URL, or a path resolved against `base`. */
  url: string;
  /** Pull a stable id and a human label out of the response body. */
  read: (body: unknown) => { externalId: string | null; label: string | null; organization: string | null };
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

function pick(body: unknown, ...path: string[]): unknown {
  let cur: unknown = body;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * The identity endpoint per provider.
 *
 * Only connectors whose adapter this build actually ships. A connector absent
 * from this table reports "identity could not be verified" rather than a
 * fabricated account name — the whole point of the file.
 */
export const IDENTITY_PROBES: Partial<Record<ConnectorId, IdentityProbe>> = {
  github: {
    url: 'https://api.github.com/user',
    read: (b) => ({
      externalId: str(pick(b, 'id')),
      label: str(pick(b, 'login')),
      organization: str(pick(b, 'company')),
    }),
  },
  hubspot: {
    // Token introspection: the only HubSpot endpoint that names the portal.
    url: 'https://api.hubapi.com/oauth/v1/access-tokens',
    read: (b) => ({
      externalId: str(pick(b, 'hub_id')),
      label: str(pick(b, 'hub_domain')) ?? str(pick(b, 'user')),
      organization: str(pick(b, 'hub_domain')),
    }),
  },
  salesforce: {
    url: 'https://login.salesforce.com/services/oauth2/userinfo',
    read: (b) => ({
      externalId: str(pick(b, 'user_id')),
      label: str(pick(b, 'preferred_username')) ?? str(pick(b, 'email')),
      organization: str(pick(b, 'organization_id')),
    }),
  },
  notion: {
    url: 'https://api.notion.com/v1/users/me',
    read: (b) => ({
      externalId: str(pick(b, 'id')),
      label: str(pick(b, 'name')) ?? str(pick(b, 'bot', 'workspace_name')),
      organization: str(pick(b, 'bot', 'workspace_name')),
    }),
  },
  slack: {
    url: 'https://slack.com/api/auth.test',
    read: (b) => ({
      externalId: str(pick(b, 'user_id')),
      label: str(pick(b, 'user')),
      organization: str(pick(b, 'team')),
    }),
  },
  'google-workspace': {
    url: 'https://www.googleapis.com/oauth2/v3/userinfo',
    read: (b) => ({
      externalId: str(pick(b, 'sub')),
      label: str(pick(b, 'email')) ?? str(pick(b, 'name')),
      organization: str(pick(b, 'hd')),
    }),
  },
  'microsoft-entra': {
    url: 'https://graph.microsoft.com/v1.0/me',
    read: (b) => ({
      externalId: str(pick(b, 'id')),
      label: str(pick(b, 'userPrincipalName')) ?? str(pick(b, 'displayName')),
      organization: null,
    }),
  },
};

export type ConnectionTestStatus =
  /** The provider answered and told us who we are. */
  | 'verified'
  /** The provider rejected the credential. */
  | 'invalid_credential'
  /** The provider could not be reached. */
  | 'unreachable'
  /** Rate limited — the credential may be fine; we simply do not know yet. */
  | 'rate_limited'
  /** No identity endpoint is declared for this connector in this build. */
  | 'not_verifiable';

export interface ConnectionTestResult {
  status: ConnectionTestStatus;
  /** The provider's own stable id for this account. Null unless `verified`. */
  externalId: string | null;
  label: string | null;
  organization: string | null;
  /** Plain words, safe to show. Never carries the credential. */
  message: string;
}

export interface ConnectionTestDeps {
  getAccessToken: (connectorId: string, accountId: string) => Promise<string | null>;
  rate: RateGate;
  /** Injected so tests drive the real code with a routed transport. */
  makeClient?: (connectorId: string, getToken: () => Promise<string>) => Pick<HttpClient, 'getJson'>;
}

/**
 * Ask the provider who this is.
 *
 * Never throws: every failure is a `status` a screen can render. An exception
 * here would mean a connection test could take down the connect flow, which
 * is the opposite of what a test is for.
 */
export async function testConnection(
  connectorId: ConnectorId,
  accountId: string,
  deps: ConnectionTestDeps,
): Promise<ConnectionTestResult> {
  const probe = IDENTITY_PROBES[connectorId];
  if (!probe) {
    return {
      status: 'not_verifiable',
      externalId: null,
      label: null,
      organization: null,
      // Stated, not implied. "We did not check" and "we checked and it is
      // fine" must never look the same on screen.
      message:
        'This build has no identity endpoint for this provider, so the connection could not be verified. The credential may still work.',
    };
  }

  const getToken = async (): Promise<string> => {
    const token = await deps.getAccessToken(connectorId, accountId);
    if (!token) throw new AuthError('no valid token');
    return token;
  };

  const client =
    deps.makeClient?.(connectorId, getToken) ??
    new HttpClient(connectorId, getToken, deps.rate);

  try {
    const res = await client.getJson(probe.url);
    const identity = probe.read(res.data);
    if (identity.externalId === null) {
      /**
       * A 200 with no id is not a verified connection.
       *
       * Slack's `auth.test` returns HTTP 200 with `{ok: false}` for a revoked
       * token — the classic shape where a status code says yes and the body
       * says no.
       */
      return {
        status: 'not_verifiable',
        externalId: null,
        label: identity.label,
        organization: identity.organization,
        message: 'The provider answered but did not identify the account, so the connection is unverified.',
      };
    }
    return {
      status: 'verified',
      externalId: identity.externalId,
      label: identity.label,
      organization: identity.organization,
      message: identity.label
        ? `Connected as ${identity.label}${identity.organization ? ` (${identity.organization})` : ''}.`
        : 'Connected. The provider confirmed the credential.',
    };
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        status: 'invalid_credential',
        externalId: null,
        label: null,
        organization: null,
        message: 'The provider rejected the credential. Reconnect to sign in again.',
      };
    }
    if (err instanceof RateLimitError) {
      return {
        status: 'rate_limited',
        externalId: null,
        label: null,
        organization: null,
        message: 'The provider is rate limiting us, so the connection could not be checked yet.',
      };
    }
    return {
      status: 'unreachable',
      externalId: null,
      label: null,
      organization: null,
      // The provider's own message is NOT interpolated here. It is
      // provider-controlled text on a path that renders into the UI.
      message: 'The provider could not be reached. Check the network and try again.',
    };
  }
}
