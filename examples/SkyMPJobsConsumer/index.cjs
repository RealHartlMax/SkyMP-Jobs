'use strict';
// GPL-3.0-only. Invoke canUseWorkshop from a trusted server gameplay handler.
const jobs = globalThis.skympJobs;
if (jobs?.apiVersion !== 1) throw Error('SkyMP-Jobs API v1 required');
const key = Symbol.for('skymp-jobs-consumer.v1');
if (globalThis[key]) throw Error('Jobs consumer already loaded');
let stopped = false, observed = 0;
const off = jobs.subscribe(event => { if (event.jobId === 'example-worker') observed++; });
const consumer = Object.freeze({
  async canUseWorkshop(characterId) {
    // The host resolves characterId from its authenticated session. No client ID/role/XP is trusted.
    return !stopped && await jobs.hasPermission(characterId, 'job.example-worker.use');
  },
  get observedEvents() { return observed; },
  stop() { if (stopped) return; stopped = true; off(); delete globalThis[key]; },
});
globalThis[key] = consumer;
module.exports = consumer;
