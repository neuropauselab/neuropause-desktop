/**
 * CLI command dispatcher. Pure of process/console concerns — it takes a client
 * and output sinks via `CliDeps`, so it's unit-testable. The bin (cli.ts) wires
 * real stdio + env around it.
 */
import { promises as fs } from 'node:fs';
import type { NeuroPauseClient, ListingManifest } from '@neuropause/sdk';

export interface CliDeps {
  client: NeuroPauseClient;
  out: (line: string) => void;
  err: (line: string) => void;
  readFile?: (path: string) => Promise<string>;
}

export const CLI_VERSION = '0.1.0';

export const HELP = `neuropause <command>

  marketplace list           List published marketplace listings
  marketplace stats          Show marketplace statistics
  workers list               List AI worker listings
  connectors list            List connector listings
  usage                      Show your API usage analytics
  billing summary            Show your billing summary
  billing plans              List available plans
  publish <id> <file.json>   Publish a new version from a manifest file
  version                    Print the CLI version
  help                       Show this help

Environment:
  NEUROPAUSE_API_KEY         API key used to authenticate (Bearer token)
  NEUROPAUSE_BASE_URL        Gateway base URL (default https://api.neuropause.dev)`;

export async function runCommand(argv: string[], deps: CliDeps): Promise<number> {
  const [cmd, sub, ...rest] = argv;
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
      case 'marketplace': {
        if (sub === 'list') return print(deps, await deps.client.marketplace.list());
        if (sub === 'stats') return print(deps, await deps.client.marketplace.stats());
        deps.err(`Unknown marketplace subcommand: ${sub ?? '(none)'}`);
        return 1;
      }
      case 'workers':
        return print(deps, await deps.client.workers.list());
      case 'connectors':
        return print(deps, await deps.client.connectors.list());
      case 'usage':
        return print(deps, await deps.client.usage.summary());
      case 'billing': {
        if (sub === 'plans') return print(deps, await deps.client.billing.plans());
        return print(deps, await deps.client.billing.summary());
      }
      case 'publish': {
        const listingId = sub;
        const file = rest[0];
        if (!listingId || !file) {
          deps.err('usage: neuropause publish <listingId> <manifest.json>');
          return 1;
        }
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

function print(deps: CliDeps, value: unknown): number {
  deps.out(JSON.stringify(value, null, 2));
  return 0;
}
