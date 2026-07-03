/**
 * The GatewayStore singleton, backed by a file under Electron's userData
 * directory.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { GatewayStore } from './gatewayStore';

export const gatewayStore = new GatewayStore(join(app.getPath('userData'), 'ecosystem-gateway.json'));
