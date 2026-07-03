/**
 * Code-signing / notarization status probe. On a packaged macOS build this
 * shells out to `codesign` and `spctl` to report the real signing authority and
 * whether Gatekeeper accepts the bundle as notarized. Everywhere else it
 * degrades gracefully (development builds report not-applicable; non-macOS
 * reports unknown) so the diagnostics page never blocks or throws.
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { SigningStatus } from '@neuropause/shared';

const exec = promisify(execFile);

/** The running .app bundle: exe is <App>.app/Contents/MacOS/<bin>, up three. */
function bundlePath(): string {
  return resolve(app.getPath('exe'), '..', '..', '..');
}

export async function probeSigningStatus(): Promise<SigningStatus> {
  if (!app.isPackaged) {
    return {
      state: 'not-applicable',
      signed: false,
      notarized: null,
      authority: null,
      detail: 'development build — code signing is not applied to unpackaged runs',
    };
  }
  if (process.platform !== 'darwin') {
    return {
      state: 'unknown',
      signed: false,
      notarized: null,
      authority: null,
      detail: 'signing status probe is implemented for macOS only',
    };
  }

  const target = bundlePath();
  let signed = false;
  let authority: string | null = null;

  try {
    const { stderr } = await exec('codesign', ['-dv', '--verbose=4', target], { timeout: 6000 });
    signed = true;
    const match = /\bAuthority=(.+)/.exec(stderr);
    authority = match ? match[1].trim() : null;
  } catch {
    return {
      state: 'unsigned',
      signed: false,
      notarized: false,
      authority: null,
      detail: 'codesign reports the bundle is not signed',
    };
  }

  let notarized: boolean | null = null;
  try {
    const { stderr } = await exec('spctl', ['--assess', '--type', 'execute', '--verbose=4', target], { timeout: 10000 });
    notarized = /source=Notarized Developer ID|: accepted/i.test(stderr);
  } catch {
    // spctl rejects unnotarized bundles with a non-zero exit.
    notarized = false;
  }

  return {
    state: notarized ? 'signed-notarized' : 'signed',
    signed,
    notarized,
    authority,
    detail: notarized ? 'accepted by Gatekeeper as a notarized Developer ID build' : 'signed but not notarized (or notarization not recognized)',
  };
}
