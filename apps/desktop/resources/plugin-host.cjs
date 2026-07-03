'use strict';
/**
 * NeuroPause plugin host shim. This file runs as its own Node process (forked
 * by the main process with an IPC channel) so a plugin is isolated from the
 * Electron main process and the renderer. The plugin module is loaded here and
 * handed a `host` object whose privileged calls are sent to the parent, which
 * enforces the plugin's granted permissions before honoring them.
 *
 * Plugin module contract (CommonJS):
 *   module.exports = {
 *     async activate(host) { ... },   // called once on enable
 *     async deactivate() { ... },     // called on disable/shutdown
 *   };
 */

let pluginModule = null;
let pluginId = '';
let permissions = [];
const pending = new Map();
let nextCallId = 1;

function send(msg) {
  if (process.send) process.send(msg);
}

function hostCall(method, args) {
  return new Promise((resolve, reject) => {
    const id = nextCallId++;
    pending.set(id, { resolve, reject });
    send({ type: 'host-call', id, method, args });
  });
}

function buildHost() {
  return {
    pluginId,
    permissions: [...permissions],
    log: (...parts) => send({ type: 'log', message: parts.map(String).join(' ') }),
    emit: (event, data) => send({ type: 'event', event, data }),
    notify: (title, body) => hostCall('notify', { title, body }),
    storage: {
      get: (key) => hostCall('storage.get', { key }),
      set: (key, value) => hostCall('storage.set', { key, value }),
    },
    // Reserved capability for ai_agent plugins; gated by local_models.
    runModel: (prompt) => hostCall('runModel', { prompt }),
  };
}

async function activate() {
  try {
    pluginModule = require(process.env.NP_PLUGIN_ENTRY);
  } catch (err) {
    send({ type: 'error', message: 'Failed to load plugin entry: ' + (err && err.message) });
    process.exit(1);
    return;
  }
  try {
    if (typeof pluginModule.activate === 'function') {
      await pluginModule.activate(buildHost());
    }
    send({ type: 'ready' });
  } catch (err) {
    send({ type: 'error', message: 'activate() threw: ' + (err && err.message) });
    process.exit(1);
  }
}

async function deactivate() {
  try {
    if (pluginModule && typeof pluginModule.deactivate === 'function') {
      await pluginModule.deactivate();
    }
  } catch (err) {
    send({ type: 'log', message: 'deactivate() threw: ' + (err && err.message) });
  } finally {
    process.exit(0);
  }
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'init') {
    pluginId = msg.pluginId || '';
    permissions = Array.isArray(msg.permissions) ? msg.permissions : [];
    void activate();
  } else if (msg.type === 'shutdown') {
    void deactivate();
  } else if (msg.type === 'host-reply') {
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error || 'host call failed'));
    }
  }
});

process.on('uncaughtException', (err) => {
  send({ type: 'error', message: 'uncaughtException: ' + (err && err.message) });
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  send({ type: 'error', message: 'unhandledRejection: ' + (err && err.message) });
});
