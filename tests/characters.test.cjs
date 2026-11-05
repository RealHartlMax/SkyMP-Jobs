'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, job, profession } = require('./helpers.cjs');
test('multiple jobs, configured limits, primary job, removal and two slots of one account', async () => {
  const h = setup({ maxJobs: 2 }); for (const key of ['worker', 'second', 'third']) h.resource.registerJob(job(key));
  await h.resource.assignJob('account:1:slot:1', 'worker'); await h.resource.assignJob('account:1:slot:1', 'second');
  await h.resource.assignJob('account:1:slot:2', 'worker', 'master');
  assert.equal((await h.api.getActiveJobs('account:1:slot:1')).length, 2);
  assert.equal((await h.api.getCharacter('account:1:slot:2')).jobs[0].gradeId, 'master');
  assert.equal((await h.api.getCharacter('account:1:slot:2')).jobs.length, 1);
  await assert.rejects(h.resource.assignJob('account:1:slot:1', 'third'), /job limit/);
  await h.resource.setPrimaryJob('account:1:slot:1', 'second'); assert.equal((await h.api.getCharacter('account:1:slot:1')).primaryJobId, 'second');
  await h.resource.removeJob('account:1:slot:1', 'second'); assert.equal((await h.api.getCharacter('account:1:slot:1')).primaryJobId, 'worker');
  await h.resource.removeJob('account:1:slot:1', 'worker'); assert.equal((await h.api.getCharacter('account:1:slot:1')).primaryJobId, null);
});
test('grade and specialization changes, unavailable resource and restoration', async () => {
  const h = setup(); h.resource.registerJob(job('worker', { specializations: [{ id: 'smith', label: 'Schmied' }] }));
  await h.resource.assignJob('c', 'worker'); await h.resource.setGrade('c', 'worker', 'master'); await h.resource.setSpecialization('c', 'worker', 'smith');
  assert.equal((await h.api.getCharacter('c')).jobs[0].specializationId, 'smith');
  assert.equal(await h.api.hasPermission('c', 'job.worker.manage'), true);
  await assert.rejects(h.resource.setGrade('c', 'worker', 'invented'), /Unknown grade/);
  await h.resource.setSpecialization('c', 'worker', null);
  await h.resource.setJobEnabled('worker', false); assert.equal((await h.api.getActiveJobs('c')).length, 0);
  assert.equal(await h.api.hasPermission('c', 'job.worker.manage'), false); assert.equal((await h.api.getCharacter('c')).jobs.length, 1);
  await h.resource.setJobEnabled('worker', true); assert.equal((await h.api.getActiveJobs('c')).length, 1);
  await h.resource.deregisterJob('worker'); assert.equal((await h.api.getCharacter('c')).jobs.length, 1);
  h.resource.registerJob(job('worker', { version: 2, grades: [{ id: 'novice', label: 'Neu' }], permissions: [{ id: 'job.worker.work', requiresDuty: true }] }));
  assert.equal((await h.api.getActiveJobs('c')).length, 0); // Removed rank never silently upgrades a character.
  await h.resource.setGrade('c', 'worker', 'novice'); // Explicit host repair keeps membership/history intact.
  const restored = (await h.api.getActiveJobs('c'))[0]; assert.equal(restored.gradeId, 'novice'); assert.equal(restored.definitionVersion, 2);
});
test('professions exist without employment; XP unlocks levels and configurable qualifications', async () => {
  const h = setup(); h.resource.registerProfession(profession()); await h.resource.learnProfession('c', 'craft');
  assert.equal((await h.api.getCharacter('c')).jobs.length, 0);
  assert.equal(await h.api.hasQualification('c', { professionId: 'craft', qualificationId: 'licensed' }), false);
  assert.equal(await h.resource.addExperience('c', 'craft', { source: 'task', eventId: 'task-1', amount: 100 }), true);
  const [p] = await h.api.getProfessions('c'); assert.equal(p.level, 'skilled'); assert.deepEqual(p.unlocks, ['advanced']);
  assert.equal(await h.api.hasQualification('c', { professionId: 'craft', qualificationId: 'licensed' }), true);
  assert.equal(await h.api.hasQualification('c', { professionId: 'craft', qualificationId: 'invented' }), false);
  assert.equal(await h.resource.addExperience('c', 'craft', { source: 'task', eventId: 'task-1', amount: 100 }), false);
  assert.equal((await h.api.getProfessions('c'))[0].experience, 100);
  await assert.rejects(h.resource.addExperience('c', 'craft', { source: 'task', eventId: 'task-1', amount: 99 }), /idempotency conflict/);
  for (const award of [{ source: 'client', eventId: 'x', amount: 1 }, { source: 'task', eventId: 'x', amount: 101 }, { source: 'task', eventId: 'x', amount: -1 }, { source: 'task', eventId: 'x', amount: 1.5 }]) await assert.rejects(h.resource.addExperience('c', 'craft', award));
});
test('access, grade requirements and qualifications are enforced when assigning and using permissions', async () => {
  const h = setup(); h.resource.registerProfession(profession());
  h.resource.registerJob(job('worker', { access: { qualifications: [{ professionId: 'craft', qualificationId: 'licensed' }] } }));
  await assert.rejects(h.resource.assignJob('c', 'worker'), /access denied/);
  await h.resource.learnProfession('c', 'craft'); await h.resource.addExperience('c', 'craft', { source: 'task', eventId: '1', amount: 100 });
  await h.resource.assignJob('c', 'worker', 'master'); assert.equal(await h.api.hasPermission('c', 'job.worker.manage'), true);
  h.resource.deregisterProfession('craft'); assert.equal(await h.api.hasPermission('c', 'job.worker.manage'), false);
});
test('concurrent assignments serialize and failed saves do not emit successful events', async () => {
  const h = setup({ maxJobs: 1 }); h.resource.registerJob(job()); h.resource.registerJob(job('second'));
  const results = await Promise.allSettled([h.resource.assignJob('c', 'worker'), h.resource.assignJob('c', 'second')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await h.api.getCharacter('c')).jobs.length, 1);
  let events = 0; h.api.subscribe(e => { if (e.type === 'grade-changed') events++; });
  const save = h.store.compareAndSet.bind(h.store); h.store.compareAndSet = async () => { throw Error('DB unavailable'); };
  await assert.rejects(h.resource.setGrade('c', 'worker', 'master'), /DB unavailable/); assert.equal(events, 0);
  h.store.compareAndSet = save; await h.resource.setGrade('c', 'worker', 'master'); assert.equal(events, 1);
});
