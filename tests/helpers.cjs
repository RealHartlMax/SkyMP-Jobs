'use strict';
const { createJobsFramework, InMemoryJobsPersistence } = require('../dist/library.cjs');
const OWNER = 'example-resource';
const job = (jobId = 'worker', overrides = {}) => ({ id: jobId, owner: OWNER, version: 1, label: 'Arbeiter', description: 'Test job', category: 'civilian',
  supportsDuty: true, grades: [{ id: 'novice', label: 'Anfänger' }, { id: 'master', label: 'Meister' }],
  permissions: [{ id: `job.${jobId}.work`, requiresDuty: true }, { id: `job.${jobId}.manage`, grades: ['master'] }], ...overrides });
const profession = (overrides = {}) => ({ id: 'craft', owner: OWNER, version: 1, label: 'Handwerk', description: 'Test profession', maxExperience: 1000,
  experienceSources: [{ id: 'task', maxAward: 100 }], levels: [{ id: 'novice', label: 'Anfänger', experience: 0 }, { id: 'skilled', label: 'Geübt', experience: 100, unlocks: ['advanced'] }],
  qualifications: [{ id: 'licensed', label: 'Geprüft', experience: 100 }], ...overrides });
function setup(options = {}) {
  let mono = 0, wall = 100000;
  const native = new Map();
  const store = options.persistence ?? new InMemoryJobsPersistence();
  const controls = createJobsFramework({ persistence: store, monotonic: () => mono, wallClock: () => wall,
    isSessionCurrent: binding => native.get(binding.userId)?.sessionId === binding.sessionId, ...options });
  const resource = controls.provisionResource(OWNER, { manageJobs: ['worker', 'second', 'third', 'fourth'], manageProfessions: ['craft'],
    experience: [{ professionId: 'craft', sources: ['task'] }], payments: ['worker'] });
  const activate = async (characterId = 'account:1:slot:1', userId = 1) => {
    const session = Object.freeze({ characterId, accountId: 'account:1', actorId: 100 + userId, userId, sessionId: `${characterId}:${userId}:${++wall}` });
    native.set(userId, session); await controls.bindSession(session); return session;
  };
  return { controls, api: controls.api, resource, store, native, activate, advance(ms) { mono += ms; wall += ms; }, get mono() { return mono; } };
}
module.exports = { setup, OWNER, job, profession };
