#!/usr/bin/env node
/**
 * NeuroPause CLI entry point. Reads credentials from the environment, builds the
 * SDK client, and dispatches the requested command.
 */
import { NeuroPauseClient } from '@neuropause/sdk';
import { runCommand } from './commands';

const client = new NeuroPauseClient({
  apiKey: process.env.NEUROPAUSE_API_KEY,
  baseUrl: process.env.NEUROPAUSE_BASE_URL,
});

void runCommand(process.argv.slice(2), {
  client,
  out: (line: string) => process.stdout.write(`${line}\n`),
  err: (line: string) => process.stderr.write(`${line}\n`),
}).then((code) => {
  process.exitCode = code;
});
