'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, job, profession, OWNER } = require('./helpers.cjs');
test('register/unregister definitions, immutable snapshots, ownership and duplicate IDs', async () => {
  const { api, resource } = setup(); const input = job(); resource.registerJob(input); input.label = 'mutated';
  assert.equal(api.getJob('worker').label, 'Arbeiter'); assert.equal(Object.isFrozen(api.getJob('worker').grades), true);
  assert.throws(() => resource.registerJob(job()), /Duplicate job/);
  const foreign = api.registerResource('other-resource');
  assert.throws(() => foreign.registerJob(job()), /owner mismatch/);
  assert.throws(() => foreign.registerJob(job('worker', { owner: 'other-resource' })), /Duplicate job/);
  await assert.rejects(foreign.deregisterJob('worker'), /does not own/);
  resource.registerProfession(profession()); assert.throws(() => resource.registerProfession(profession()), /Duplicate profession/);
  await resource.deregisterJob('worker'); assert.equal(api.getJob('worker'), null);
  resource.deregisterProfession('craft'); assert.equal(api.getProfession('craft'), null);
  assert.throws(() => foreign.registerJob(job('worker', { owner: 'other-resource' })), /owner\/version conflict/);
  resource.registerJob(job('worker', { version: 2 })); await resource.deregisterJob('worker');
  assert.throws(() => resource.registerJob(job('worker', { version: 1 })), /version conflict/);
});
test('a chosen owner returns registration only; an empty host capability grants no administration', async () => {
  const { controls, api } = setup(); const publicHandle = api.registerResource('public-plugin');
  assert.equal(publicHandle.assignJob, undefined); assert.equal(publicHandle.addExperience, undefined);
  assert.equal(api.provisionResource, undefined); assert.equal(api.setDuty, undefined);
  assert.throws(() => api.registerResource(OWNER), /already registered/);
  const unprivileged = controls.provisionResource('empty-plugin', {});
  await assert.rejects(unprivileged.assignJob('c', 'worker'), /capability/);
});
test('validation rejects malformed definitions and invalid permission namespaces', () => {
  const { resource } = setup();
  for (const invalid of [job('worker', { grades: [] }), job('worker', { version: 0 }), job('worker', { grades: [{ id: 'x', label: 'X' }, { id: 'x', label: 'X' }] }),
    job('worker', { permissions: [{ id: 'job.other.work' }] }), job('worker', { supportsDuty: false })]) assert.throws(() => resource.registerJob(invalid));
  assert.throws(() => resource.registerProfession(profession({ levels: [{ id: 'high', label: 'High', experience: 100 }, { id: 'low', label: 'Low', experience: 0 }] })), /increasing/);
});
test('resource cleanup removes registrations and listeners but preserves saved memberships', async () => {
  const { api, resource } = setup(); resource.registerJob(job()); resource.registerProfession(profession());
  await resource.assignJob('c', 'worker'); await resource.learnProfession('c', 'craft');
  let calls = 0; resource.subscribe(() => calls++);
  await resource.dispose(); await resource.dispose();
  assert.equal(calls, 0); assert.equal(api.listJobs().length, 0); assert.equal(api.listProfessions().length, 0);
  assert.equal((await api.getCharacter('c')).jobs.length, 1); assert.equal((await api.getProfessions('c'))[0].available, false);
  await assert.rejects(resource.assignJob('c', 'worker'), /disposed/);
});
