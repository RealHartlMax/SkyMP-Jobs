'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, job, profession } = require('./helpers.cjs');
test('revoked duty permissions disappear immediately and checkpoint closes the interval', async () => {
  let allowed = true;
  const h = setup({ permissions: { apiVersion: 1, async hasPermission() { return allowed; } } });
  h.resource.registerJob(job('worker', { dutyAccess: { corePermission: 'host.duty' } })); await h.resource.assignJob('c', 'worker');
  const s = await h.activate('c'); assert.equal((await h.api.getDuty('c', 'worker')).canStart, true);
  await h.controls.setPlayerDuty(s, 'worker', true); h.advance(1000); allowed = false;
  assert.equal((await h.api.getDuty('c', 'worker')).onDuty, false); assert.equal(await h.api.hasPermission('c', 'job.worker.work'), false);
  await h.controls.checkpoint(); assert.equal((await h.api.getCharacter('c')).dutyLog.at(-1).reason, 'access-revoked');
  await assert.rejects(h.controls.setPlayerDuty(s, 'worker', true), /Duty access denied/);
});
test('loss of a required specialization qualification ends duty without deleting membership', async () => {
  const h = setup(); h.resource.registerProfession(profession()); await h.resource.learnProfession('c', 'craft');
  await h.resource.addExperience('c', 'craft', { source: 'task', eventId: 'qualified', amount: 100 });
  h.resource.registerJob(job('worker', { specializations: [{ id: 'smith', label: 'Schmied', requirements: [{ professionId: 'craft', qualificationId: 'licensed' }] }] }));
  await h.resource.assignJob('c', 'worker'); await h.resource.setSpecialization('c', 'worker', 'smith'); const s = await h.activate('c');
  await h.controls.setPlayerDuty(s, 'worker', true); h.resource.deregisterProfession('craft'); await h.controls.checkpoint();
  assert.equal((await h.api.getDuty('c', 'worker')).canStart, false); assert.equal((await h.api.getCharacter('c')).jobs.length, 1);
});
