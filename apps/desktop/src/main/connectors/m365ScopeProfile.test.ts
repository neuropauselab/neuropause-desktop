/**
 * SEAM-B.18 / GATE-R.12 — M365 REQUESTED-AUTHORITY SURFACE.
 *
 * B.17 stopped at the credential gate because the connect flow requested every product domain's
 * permissions at once, so a contacts-only ceremony could not obtain a contacts-only consent screen.
 * These pins hold the capability partition in place.
 *
 * What is proven here is exactly: THE SET OF SCOPES THE APPLICATION ASKS FOR. Nothing here proves
 * consent, tokens, or provider effect — a granted scope still buys nothing on its own, because the
 * executor re-checks each action's own scopes and the CST kernel remains the runtime authority.
 */
import { describe, it, expect } from 'vitest';
import {
  MANIFEST_BY_ID,
  M365_SCOPE_SETS,
  M365_SCOPE_PROFILE_ENV,
  m365ScopesForProfile,
  resolveM365ScopeProfile,
} from './manifests';

/**
 * The scope set the connector requested before B.18, measured from source at HEAD b349394 (22 —
 * the count "24" carried in the B.17 credential-gate note was wrong beside a correct enumeration,
 * corrected here per "source wins over document"). This literal is the REGRESSION BASELINE: it is
 * the one place a future contributor's added scope must be reconciled.
 */
const HISTORICAL_FULL_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'User.Read.All',
  'Group.Read.All',
  'Directory.Read.All',
  'Mail.Read',
  'Calendars.Read',
  'Files.Read',
  'Contacts.Read',
  'Team.ReadBasic.All',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Files.ReadWrite.All',
  'Contacts.ReadWrite',
  'Chat.ReadWrite',
  'ChannelMessage.Send',
  'Channel.Create',
  'ChannelMember.Read.All',
];

const entra = MANIFEST_BY_ID['microsoft-entra'];
const contactsScopes = m365ScopesForProfile('contacts');
const fullScopes = m365ScopesForProfile('full');
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe('SEAM-B.18 · the contacts profile asks for contacts authority and nothing else', () => {
  it('POSITIVE (§25/§26): the contacts profile is EXACTLY the protocol scopes + the contacts capability', () => {
    expect(contactsScopes).toEqual([...M365_SCOPE_SETS.protocol, ...M365_SCOPE_SETS.contacts]);
    // The one scope the ceremony's POST /me/contacts actually needs (delegated, per Microsoft Learn).
    expect(contactsScopes).toContain('Contacts.ReadWrite');
    // Identity scopes are retained only because the sign-in itself uses them: the OIDC trio for the
    // authorization-code flow, offline_access for the refresh path, User.Read for account identity.
    expect(M365_SCOPE_SETS.protocol).toEqual(['openid', 'profile', 'email', 'offline_access', 'User.Read']);
  });

  it('NEGATIVE (§24/§60): every scope outside the contacts profile is absent from it — the forbidden set is DERIVED, not remembered', () => {
    const forbidden = HISTORICAL_FULL_SCOPES.filter((s) => !contactsScopes.includes(s));
    // Guard the guard: if the historical set ever equals the contacts set, this test would pass vacuously.
    expect(forbidden.length).toBeGreaterThan(10);
    for (const scope of forbidden) expect(contactsScopes).not.toContain(scope);
    // Named explicitly for the reader — these are the B.17 blocker's headline permissions.
    for (const scope of ['Mail.Send', 'Mail.ReadWrite', 'Files.ReadWrite.All', 'Directory.Read.All', 'User.Read.All']) {
      expect(forbidden).toContain(scope);
      expect(contactsScopes).not.toContain(scope);
    }
  });

  it('CAPABILITY BOUNDARY (§62): contacts inherits nothing from mail, files, calendar, directory or teams', () => {
    for (const family of ['mail', 'files', 'calendar', 'directory', 'teams'] as const) {
      const overlap = M365_SCOPE_SETS[family].filter((s) => contactsScopes.includes(s));
      expect(overlap, family).toEqual([]);
    }
  });
});

describe('SEAM-B.18 · the default surface is unchanged and cannot drift silently', () => {
  it('SCOPE REGRESSION GUARD (§61): the full profile is exactly the historical set — adding a scope fails here first', () => {
    expect(sorted(fullScopes)).toEqual(sorted(HISTORICAL_FULL_SCOPES));
    expect(fullScopes).toHaveLength(22);
  });

  it('an unset or unrecognised profile resolves to `full` — a typo never silently disables working capabilities', () => {
    expect(resolveM365ScopeProfile(undefined)).toBe('full');
    expect(resolveM365ScopeProfile('')).toBe('full');
    expect(resolveM365ScopeProfile('nonsense')).toBe('full');
    expect(resolveM365ScopeProfile('contacts')).toBe('contacts');
    expect(resolveM365ScopeProfile('  CONTACTS  ')).toBe('contacts');
  });

  it('MULTI-PROVIDER (§29): the full profile still covers every capability family, so no existing feature loses its request', () => {
    for (const family of ['protocol', 'directory', 'mail', 'calendar', 'files', 'contacts', 'teams'] as const) {
      for (const scope of M365_SCOPE_SETS[family]) expect(fullScopes, family).toContain(scope);
    }
  });
});

describe('SEAM-B.18 · one source of truth for what is asked', () => {
  it('SCOPE ORIGIN (§28): the live manifest requests exactly the resolved profile — no second, hidden scope array', () => {
    const resolved = resolveM365ScopeProfile(process.env[M365_SCOPE_PROFILE_ENV]);
    expect(entra?.oauth?.scopes).toEqual(m365ScopesForProfile(resolved));
  });

  it('CONSISTENCY (§63): the connector card describes only scopes that are actually requested (UI truth)', () => {
    const requested = entra?.oauth?.scopes ?? [];
    const described = (entra?.scopes ?? []).map((s) => s.id);
    expect(described.length).toBeGreaterThan(0);
    for (const id of described) expect(requested).toContain(id);
  });

  it('NO SECRET (§27): the desktop connector stays a public client — no secret env, no embedded credential', () => {
    expect(entra?.oauth?.clientSecretEnv ?? null).toBeNull();
    expect(entra?.oauth?.usePkce).toBe(true);
    // clientIdEnv names an environment variable; it never carries a value.
    expect(entra?.oauth?.clientIdEnv).toMatch(/^NEUROPAUSE_[A-Z0-9_]+$/);
    const serialized = JSON.stringify(entra);
    for (const pattern of [/client_secret/i, /BEGIN [A-Z ]*PRIVATE KEY/, /refresh_token/i, /access_token/i]) {
      expect(serialized).not.toMatch(pattern);
    }
  });

  it('DELEGATED ONLY (§5/§23): no application/app-only permission appears in any profile', () => {
    for (const scope of [...fullScopes, ...contactsScopes]) {
      expect(scope).not.toMatch(/\.default$/); // .default reproduces the registration's whole surface
      expect(scope).not.toBe('Contacts.ReadWrite.All');
    }
  });
});
