/**
 * CLI command dispatcher. Pure of process/console concerns — it takes a client,
 * output sinks, and (optionally) a credential store via `CliDeps`, so it's fully
 * unit-testable. The bin (cli.ts) wires real stdio, env, and the file-backed
 * credential store around it.
 *
 * Every command reuses the official SDK (`@neuropause/sdk`): the Enterprise REST
 * API surface (`client.enterprise.*`), OAuth token issuance (`client.oauth`), and
 * the ecosystem resources. There is no parallel HTTP client and no business logic
 * here — the CLI is a thin, typed front-end over the same gateway everything else
 * calls, so auth / scope / rate / quota / audit apply unchanged.
 */
import { promises as fs } from 'node:fs';
import type { NeuroPauseClient, ListingManifest, MarketplaceListing } from '@neuropause/sdk';
import type { OAuthTokenResponse } from '@neuropause/shared';
import { parseArgs, queryFromFlags } from './args';
import { describeCredentials, type CredentialStore } from './credentials';

export interface CliDeps {
  client: NeuroPauseClient;
  out: (line: string) => void;
  err: (line: string) => void;
  readFile?: (path: string) => Promise<string>;
  credentials?: CredentialStore;
  now?: () => number;
}

export const CLI_VERSION = '0.3.0';

export const HELP = `neuropause <command>

Auth
  login --api-key <key> [--base-url <url>]                     Store an API key credential
  login --client-id <id> --client-secret <secret> [--scope "<scopes>"] [--base-url <url>]
                                                               Exchange client credentials for an access token
  logout                                                       Remove stored credentials
  whoami                                                       Show the active identity + scopes

Enterprise API
  modules                                                      List ERP modules with record counts
  records <moduleId> [list]                                    List records (--status --search --limit --sort --order --cursor)
  records <moduleId> get <id>                                  Get one record
  records <moduleId> create <file.json>                        Create a record from a JSON file
  records <moduleId> update <id> <file.json>                   Patch a record
  records <moduleId> delete <id>                               Delete a record
  records <moduleId> status <id> <active|archived|deleted>     Set a record status
  records <moduleId> search <query> [--limit]                  Search within a module
  records <moduleId> summarize <id>                            AI summary + risk for a record
  records <moduleId> action <id> <action> [file.json]          Run a module-defined record action
  graph counts                                                 Knowledge-graph node/edge counts
  graph node <id>                                              Get a graph node
  graph neighbors <id> [--direction --limit]                   Immediate neighbors
  graph subgraph <id> [--depth --limit]                        Ego subgraph
  context <entityId>                                           Entity-360 context
  timeline [--q --entityRef --limit --order]                   Query the unified timeline
  search <query> [--limit]                                     Cross-domain enterprise search
  automation [monitor]                                         Automation rules / monitor rollup
  health                                                       API liveness + version
  metrics [--windowDays <n>]                                   Gateway request metrics

Observability
  diagnostics [--windowDays <n>]                               System-health snapshot + gateway metrics
  logs [--limit <n>]                                           Recent gateway requests as OpenTelemetry logs
  traces [--limit <n>]                                         Recent gateway requests as OpenTelemetry spans

Ecosystem
  marketplace list | stats                                     Browse the marketplace
  workers list                                                 List AI worker listings
  connectors list                                              List connector listings
  plugins                                                      List plugin listings
  usage [--windowDays <n>]                                     Your API usage analytics
  billing summary | plans                                      Billing summary / available plans
  publish <listingId> <file.json>                              Publish + submit a marketplace version

  version                                                      Print the CLI version
  help                                                         Show this help

Environment (override stored credentials)
  NEUROPAUSE_API_KEY         Bearer credential used to authenticate
  NEUROPAUSE_BASE_URL        Gateway base URL (default https://api.neuropause.dev)`;

export async function runCommand(argv: string[], deps: CliDeps): Promise<number> {
  const { positionals, flags } = parseArgs(argv);
  const [cmd, sub, ...rest] = positionals;
  const ent = deps.client.enterprise;
  try {
    switch (cmd) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        deps.out(HELP);
        return 0;
      case 'version':
      case '--version':
        deps.out(CLI_VERSION);
        return 0;

      /* ── Auth ── */
      case 'login':
        return login(deps, flags);
      case 'logout':
        return logout(deps);
      case 'whoami':
        return whoami(deps);

      /* ── Enterprise API ── */
      case 'modules':
        return print(deps, await ent.getModules(queryFromFlags(flags)));
      case 'records':
        return runRecords(deps, positionals, flags);
      case 'graph':
        return runGraph(deps, positionals, flags);
      case 'context': {
        if (!sub) return usageErr(deps, 'context <entityId>');
        return print(deps, await ent.getContextId(sub, queryFromFlags(flags)));
      }
      case 'timeline':
        return print(deps, await ent.getTimeline(queryFromFlags(flags)));
      case 'search': {
        if (!sub) return usageErr(deps, 'search <query> [--limit]');
        return print(deps, await ent.getSearch({ q: sub, ...queryFromFlags(flags) }));
      }
      case 'automation':
        return print(deps, sub === 'monitor' ? await ent.getAutomationMonitor() : await ent.getAutomation(queryFromFlags(flags)));
      case 'health':
        return print(deps, await ent.getHealth());
      case 'metrics':
        return print(deps, await ent.getMetrics(queryFromFlags(flags)));

      /* ── Observability (P3.0, Increment 9) ── */
      case 'diagnostics': {
        const [health, metrics] = await Promise.all([ent.getObservabilityHealth(), ent.getMetrics(queryFromFlags(flags))]);
        return print(deps, { health, metrics });
      }
      case 'logs':
        return print(deps, await ent.getObservabilityLogs(queryFromFlags(flags)));
      case 'traces':
        return print(deps, await ent.getObservabilityTraces(queryFromFlags(flags)));

      /* ── Ecosystem ── */
      case 'marketplace': {
        if (sub === 'stats') return print(deps, await deps.client.marketplace.stats());
        if (sub === 'list' || sub === undefined) return print(deps, await deps.client.marketplace.list());
        deps.err(`Unknown marketplace subcommand: ${sub}`);
        return 1;
      }
      case 'workers':
        return print(deps, await deps.client.workers.list());
      case 'connectors':
        return print(deps, await deps.client.connectors.list());
      case 'plugins': {
        const listings = await deps.client.marketplace.list();
        return print(deps, listings.filter((l: MarketplaceListing) => l.kind === 'plugin'));
      }
      case 'usage':
        return print(deps, await deps.client.usage.summary(numFlag(flags.windowDays) ?? 30));
      case 'billing': {
        if (sub === 'plans') return print(deps, await deps.client.billing.plans());
        return print(deps, await deps.client.billing.summary());
      }
      case 'publish': {
        const listingId = sub;
        const file = rest[0];
        if (!listingId || !file) return usageErr(deps, 'publish <listingId> <manifest.json>');
        const read = deps.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
        const manifest = JSON.parse(await read(file)) as ListingManifest;
        const version = await deps.client.marketplace.publishVersion(listingId, manifest, 'Published via CLI');
        const submitted = await deps.client.marketplace.submit(version.id);
        deps.out(`Submitted ${manifest.name} ${manifest.version} -> ${submitted.status}`);
        return 0;
      }

      default:
        deps.err(`Unknown command: ${cmd}`);
        deps.out(HELP);
        return 1;
    }
  } catch (e) {
    deps.err(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

/* ─────────────────────────── auth ─────────────────────────── */

async function login(deps: CliDeps, flags: Record<string, string | boolean>): Promise<number> {
  const store = deps.credentials;
  if (!store) return failNoStore(deps);
  const now = deps.now ?? Date.now;
  const savedAt = new Date(now()).toISOString();
  const baseUrl = typeof flags['base-url'] === 'string' ? flags['base-url'] : undefined;

  if (typeof flags['api-key'] === 'string') {
    await store.save({ kind: 'api_key', token: flags['api-key'], baseUrl, savedAt });
    deps.out(`Saved API key credential to ${store.location}`);
    return 0;
  }

  const clientId = flags['client-id'];
  const clientSecret = flags['client-secret'];
  if (typeof clientId === 'string' && typeof clientSecret === 'string') {
    const scope = typeof flags.scope === 'string' ? flags.scope : undefined;
    const token: OAuthTokenResponse = await deps.client.oauth.token({ clientId, clientSecret, scope });
    await store.save({ kind: 'access_token', token: token.access_token, scope: token.scope, baseUrl, expiresAt: now() + token.expires_in * 1000, savedAt });
    deps.out(`Authenticated — access token stored to ${store.location} (expires in ${token.expires_in}s)`);
    return 0;
  }

  deps.err('usage: neuropause login --api-key <key>  |  neuropause login --client-id <id> --client-secret <secret> [--scope "<scopes>"] [--base-url <url>]');
  return 1;
}

async function logout(deps: CliDeps): Promise<number> {
  const store = deps.credentials;
  if (!store) return failNoStore(deps);
  const removed = await store.clear();
  deps.out(removed ? `Logged out — removed ${store.location}` : 'No stored credentials to remove.');
  return 0;
}

async function whoami(deps: CliDeps): Promise<number> {
  const store = deps.credentials;
  if (!store) return failNoStore(deps);
  const creds = await store.load();
  if (!creds) {
    deps.err('Not logged in. Run `neuropause login`, or set NEUROPAUSE_API_KEY.');
    return 1;
  }
  const now = (deps.now ?? Date.now)();
  return print(deps, describeCredentials(creds, now));
}

/* ─────────────────────────── enterprise sub-dispatchers ─────────────────────────── */

async function runRecords(deps: CliDeps, positionals: string[], flags: Record<string, string | boolean>): Promise<number> {
  const ent = deps.client.enterprise;
  const moduleId = positionals[1];
  if (!moduleId) return usageErr(deps, 'records <moduleId> [list|get|create|update|delete|status|search|summarize|action] …');
  const sub = positionals[2];
  const query = queryFromFlags(flags);
  const read = deps.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  switch (sub) {
    case undefined:
    case 'list':
      return print(deps, await ent.getModulesModuleIdRecords(moduleId, query));
    case 'get': {
      const id = positionals[3];
      if (!id) return usageErr(deps, 'records <moduleId> get <id>');
      return print(deps, await ent.getModulesModuleIdRecordsId(moduleId, id));
    }
    case 'create': {
      const file = positionals[3];
      if (!file) return usageErr(deps, 'records <moduleId> create <file.json>');
      return print(deps, await ent.postModulesModuleIdRecords(moduleId, JSON.parse(await read(file))));
    }
    case 'update': {
      const id = positionals[3];
      const file = positionals[4];
      if (!id || !file) return usageErr(deps, 'records <moduleId> update <id> <file.json>');
      return print(deps, await ent.patchModulesModuleIdRecordsId(moduleId, id, JSON.parse(await read(file))));
    }
    case 'delete': {
      const id = positionals[3];
      if (!id) return usageErr(deps, 'records <moduleId> delete <id>');
      return print(deps, await ent.deleteModulesModuleIdRecordsId(moduleId, id));
    }
    case 'status': {
      const id = positionals[3];
      const status = positionals[4];
      if (!id || !status) return usageErr(deps, 'records <moduleId> status <id> <active|archived|deleted>');
      return print(deps, await ent.postModulesModuleIdRecordsIdStatus(moduleId, id, { status }));
    }
    case 'search': {
      const q = positionals[3];
      if (!q) return usageErr(deps, 'records <moduleId> search <query>');
      return print(deps, await ent.getModulesModuleIdSearch(moduleId, { q, ...query }));
    }
    case 'summarize': {
      const id = positionals[3];
      if (!id) return usageErr(deps, 'records <moduleId> summarize <id>');
      return print(deps, await ent.postModulesModuleIdRecordsIdSummarize(moduleId, id));
    }
    case 'action': {
      const id = positionals[3];
      const action = positionals[4];
      const file = positionals[5];
      if (!id || !action) return usageErr(deps, 'records <moduleId> action <id> <action> [file.json]');
      const body = file ? JSON.parse(await read(file)) : undefined;
      return print(deps, await ent.postModulesModuleIdRecordsIdActionsAction(moduleId, id, action, body));
    }
    default:
      deps.err(`Unknown records subcommand: ${sub}`);
      return 1;
  }
}

async function runGraph(deps: CliDeps, positionals: string[], flags: Record<string, string | boolean>): Promise<number> {
  const ent = deps.client.enterprise;
  const sub = positionals[1];
  const id = positionals[2];
  const query = queryFromFlags(flags);
  switch (sub) {
    case 'counts':
      return print(deps, await ent.getGraphCounts());
    case 'node':
      if (!id) return usageErr(deps, 'graph node <id>');
      return print(deps, await ent.getGraphNodesId(id));
    case 'neighbors':
      if (!id) return usageErr(deps, 'graph neighbors <id> [--direction --limit]');
      return print(deps, await ent.getGraphNodesIdNeighbors(id, query));
    case 'subgraph':
      if (!id) return usageErr(deps, 'graph subgraph <id> [--depth --limit]');
      return print(deps, await ent.getGraphNodesIdSubgraph(id, query));
    default:
      deps.err(`Unknown graph subcommand: ${sub ?? '(none)'}`);
      return 1;
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

function print(deps: CliDeps, value: unknown): number {
  deps.out(JSON.stringify(value, null, 2));
  return 0;
}

function usageErr(deps: CliDeps, usage: string): number {
  deps.err(`usage: neuropause ${usage}`);
  return 1;
}

function failNoStore(deps: CliDeps): number {
  deps.err('Credential storage is unavailable in this environment.');
  return 1;
}

function numFlag(v: string | boolean | undefined): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
