#!/usr/bin/env node
/**
 * NeuroPause CLI entry point. Resolves credentials (environment first, then the
 * stored login), builds the SDK client, and dispatches the requested command.
 */
import { NeuroPauseClient } from '@neuropause/sdk';
import { runCommand } from './commands';
import { createFileCredentialStore } from './credentials';

async function main(): Promise<number> {
  const credentials = createFileCredentialStore();
  const stored = await credentials.load();

  // Environment overrides the stored login, so a one-off `NEUROPAUSE_API_KEY=… neuropause …`
  // still works and CI never depends on an interactive login.
  const apiKey = process.env.NEUROPAUSE_API_KEY ?? stored?.token;
  const baseUrl = process.env.NEUROPAUSE_BASE_URL ?? stored?.baseUrl;

  const client = new NeuroPauseClient({ apiKey, baseUrl });

  return runCommand(process.argv.slice(2), {
    client,
    credentials,
    out: (line: string) => process.stdout.write(`${line}\n`),
    err: (line: string) => process.stderr.write(`${line}\n`),
  });
}

void main().then((code) => {
  process.exitCode = code;
});
