'use strict';
// GPL-3.0-only. Load after skymp-jobs. No client entry or assumed Core hook.
const jobs = globalThis.skympJobs;
if (jobs?.apiVersion !== 1) throw Error('SkyMP-Jobs API v1 required');
const key = Symbol.for('skymp-jobs-example.resource.v1');
if (globalThis[key]) throw Error('Jobs example already loaded');
const resource = jobs.registerResource('skymp-jobs-example');
resource.registerProfession({ id: 'example-trade', owner: resource.owner, version: 1, label: 'Beispielhandwerk', description: 'Nur Framework-Demonstration',
  maxExperience: 10000, experienceSources: [{ id: 'verified-task', maxAward: 100 }],
  levels: [{ id: 'beginner', label: 'Anfänger', experience: 0 }, { id: 'skilled', label: 'Geübt', experience: 100, unlocks: ['example-advanced'] }],
  qualifications: [{ id: 'qualified', label: 'Qualifiziert', experience: 100 }] });
resource.registerJob({ id: 'example-worker', owner: resource.owner, version: 1, label: 'Beispielberuf', description: 'Registrierung ohne fest eingebautes Gameplay',
  category: 'example', supportsDuty: true, grades: [{ id: 'apprentice', label: 'Lehrling' }, { id: 'master', label: 'Meister' }],
  permissions: [{ id: 'job.example-worker.use', requiresDuty: true, qualifications: [{ professionId: 'example-trade', qualificationId: 'qualified' }] }] });
let stopped = false;
const handle = Object.freeze({ resource, async stop() { if (stopped) return; stopped = true; delete globalThis[key]; await resource.dispose(); } });
globalThis[key] = handle;
module.exports = handle;
