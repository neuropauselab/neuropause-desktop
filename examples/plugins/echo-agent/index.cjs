'use strict';
/** Echo Agent — calls the local_models host capability (a declared seam today). */
module.exports = {
  async activate(host) {
    host.log('Echo Agent activated');
    try {
      const result = await host.runModel('Summarize my day in one sentence.');
      host.log('runModel result: ' + JSON.stringify(result));
    } catch (e) {
      host.log('runModel denied: ' + e.message);
    }
  },
  async deactivate() {},
};
