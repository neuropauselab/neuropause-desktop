import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * electron-updater's `channel` setter re-derives allowDowngrade; the fix (2026-09-12) sets
 * allowDowngrade AFTER the channel in wire() and setChannel(). appUpdater.ts imports Electron and
 * must not be loaded in unit tests, so the ordering is pinned on the source text.
 */
describe('appUpdater — allowDowngrade is set after the channel (both sites)', () => {
  const src = readFileSync(join(__dirname, 'appUpdater.ts'), 'utf8');
  it('wire(): channel assignment precedes allowDowngrade=false', () => {
    const wire = src.slice(src.indexOf('private wire()'), src.indexOf('autoUpdater.on(\'checking-for-update\''));
    expect(wire.indexOf('autoUpdater.channel = feedChannel(this.channel);')).toBeGreaterThan(-1);
    expect(wire.indexOf('autoUpdater.allowDowngrade = false;')).toBeGreaterThan(wire.indexOf('autoUpdater.channel = feedChannel(this.channel);'));
  });
  it('setChannel(): allowDowngrade=false follows the channel assignment', () => {
    const sc = src.slice(src.indexOf('setChannel(input: unknown)'));
    const ch = sc.indexOf('autoUpdater.channel = feedChannel(this.channel);');
    const ad = sc.indexOf('autoUpdater.allowDowngrade = false;');
    expect(ch).toBeGreaterThan(-1); expect(ad).toBeGreaterThan(ch);
  });
  it('the app never auto-downloads or auto-installs', () => {
    expect(src).toMatch(/autoUpdater\.autoDownload = false/);
    expect(src).toMatch(/autoUpdater\.autoInstallOnAppQuit = false/);
  });
});
