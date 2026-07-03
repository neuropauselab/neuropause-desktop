'use strict';
/** Hello Automation — demonstrates background work + a permission-gated notify. */
let timer = null;
let ticks = 0;

module.exports = {
  async activate(host) {
    host.log('Hello Automation activated; permissions: ' + host.permissions.join(', '));
    const last = await host.storage.get('lastRun');
    host.log('last run was: ' + (last || 'never'));
    await host.storage.set('lastRun', new Date().toISOString());

    // Requires the "notifications" permission; fails cleanly if revoked.
    await host
      .notify('Hello Automation', 'Background plugin is running')
      .catch((e) => host.log('notify denied: ' + e.message));

    timer = setInterval(() => {
      ticks += 1;
      host.emit('heartbeat', { ticks });
    }, 5000);
  },
  async deactivate() {
    if (timer) clearInterval(timer);
    timer = null;
  },
};
