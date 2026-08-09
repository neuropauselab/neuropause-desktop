/**
 * The cross-domain channel's classification, pinned.
 *
 * `crossDomain:related` is one of a handful of channels with NO static
 * permission, and that will look like an omission to whoever reads the authz
 * table next. It is not: the answer legitimately spans four read scopes
 * (`crm:read`, `sales:read`, `operations:read`, `procurement:read`), so any
 * single static scope would be either too narrow to answer or — far worse —
 * broad enough to hand someone records they cannot otherwise read. The handler
 * authorizes the root record's own module and filters every hop by the far
 * module's scope instead.
 *
 * This file exists so that changing it requires arguing with the reasoning
 * rather than tidying a table.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { RUNTIME_CHANNEL_PERMISSIONS, PUBLIC_CHANNELS } from '../ipc/runtimeAuthz';
import {
  DYNAMICALLY_AUTHORIZED_ENTERPRISE_CHANNELS,
  ENTERPRISE_CHANNEL_PERMISSIONS,
} from '../enterprise/authzGate';

describe('cross-domain authorization', () => {
  it('is invokable and never public', () => {
    expect(RUNTIME_INVOKABLE_CHANNELS).toContain(IpcChannel.CrossDomainRelated);
    expect(PUBLIC_CHANNELS.has(IpcChannel.CrossDomainRelated)).toBe(false);
  });

  it('is declared as dynamically authorized, not left unclassified', () => {
    // The distinction the boot invariant cares about: a channel with no static
    // scope must be on this list, or it is simply ungoverned.
    expect(DYNAMICALLY_AUTHORIZED_ENTERPRISE_CHANNELS).toContain(IpcChannel.CrossDomainRelated);
  });

  it('carries no static scope — deliberately. See the file header.', () => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.CrossDomainRelated]).toBeUndefined();
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.CrossDomainRelated]).toBeUndefined();
  });

  it('the SHIPPED handler requires auth and refuses an unknown module', async () => {
    /**
     * A source assertion, and deliberately so.
     *
     * `initEnterprise` binds Electron's `app.getPath` at import time, so the
     * real def cannot be constructed in a unit test without standing up the
     * whole runtime. The alternative — asserting nothing — is what an earlier
     * version of this file amounted to: every table test above would pass with
     * the handler completely unguarded.
     *
     * Both properties below were genuinely broken when first written:
     *  - `requireAuth` — the def is appended raw rather than through
     *    `withEnterpriseAuthz`, so nothing else stamps it and the bridge's
     *    auth gate never ran for this channel.
     *  - an unregistered `moduleId` must THROW rather than skip the authorize
     *    call. `moduleId` is caller-supplied, so a conditional check let anyone
     *    bypass authorization entirely by naming a module that does not exist.
     */
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const source = await readFile(
      fileURLToPath(new URL('../enterprise/index.ts', import.meta.url)),
      'utf8',
    );
    const block = source.slice(source.indexOf('relatedRecordsHandler: SecureHandlerDef'));
    expect(block.length).toBeGreaterThan(0);
    const handler = block.slice(0, block.indexOf('\n  };'));
    expect(handler).toContain('requireAuth: true');
    expect(handler).toMatch(/if \(!rootModule\) throw/);
    expect(handler).toContain('authorize(rootModule.descriptor.permissions.read)');
  });

  it('does not grant a scope broad enough to be a bypass', () => {
    // If someone "fixes" this by stamping one scope on the channel, the
    // per-hop filtering becomes decorative — a holder of that scope would read
    // every module the traversal reaches. Both halves must stay absent.
    const stamped =
      RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.CrossDomainRelated] ??
      ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.CrossDomainRelated];
    expect(stamped).toBeUndefined();
  });
});
