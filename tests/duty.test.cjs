'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, job } = require('./helpers.cjs');
test('duty requires online identity; repeated starts/stops do not duplicate time or rights', async () => {
  const h = setup(); h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker');
  await assert.rejects(h.resource.setDuty('c', 'worker', true), /online character/);
  const session = await h.activate('c'); assert.equal(await h.api.hasPermission('c', 'job.worker.work'), false);
  await h.controls.setPlayerDuty(session, 'worker', true); assert.equal(await h.api.hasPermission('c', 'job.worker.work'), true);
  h.advance(1000); await h.resource.setDuty('c', 'worker', true); h.advance(1000);
  await h.controls.checkpoint(); assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 2000);
  h.advance(1000); await h.controls.setPlayerDuty(session, 'worker', false); await h.resource.setDuty('c', 'worker', false);
  assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 3000);
  assert.equal(await h.api.hasPermission('c', 'job.worker.work'), false);
  h.advance(60000); await h.controls.checkpoint(); assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 3000);
});
test('disconnect and character switch close duty; offline time and old sessions grant nothing', async () => {
  const h = setup(); h.resource.registerJob(job()); await h.resource.assignJob('c1', 'worker'); await h.resource.assignJob('c2', 'worker');
  const first = await h.activate('c1'); await h.controls.setPlayerDuty(first, 'worker', true); h.advance(1500);
  const second = await h.activate('c2'); assert.equal((await h.api.getDuty('c1', 'worker')).creditedMs, 1500);
  assert.equal((await h.api.getCharacter('c1')).dutyLog.at(-1).reason, 'character-change');
  await assert.rejects(h.controls.setPlayerDuty(first, 'worker', true), /Stale player/);
  await h.controls.setPlayerDuty(second, 'worker', true); h.advance(500);
  h.native.delete(1); const closing = h.controls.disconnect(1);
  assert.equal(h.controls.currentSession(1), null); await closing;
  h.advance(3600000); await h.controls.checkpoint(); assert.equal((await h.api.getDuty('c2', 'worker')).creditedMs, 500);
  assert.equal((await h.api.getCharacter('c2')).dutyLog.at(-1).reason, 'disconnect');
  const rejoined = await h.activate('c2'); assert.equal((await h.api.getDuty('c2', 'worker')).onDuty, false);
  await assert.rejects(h.controls.setPlayerPrimary(second, 'worker'), /Stale player/);
  assert.notEqual(second.sessionId, rejoined.sessionId);
});
test('clock stalls are bounded, checkpoint then shutdown preserves only online credited intervals', async () => {
  const h = setup(); h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker'); const session = await h.activate('c');
  await h.controls.setPlayerDuty(session, 'worker', true); h.advance(60000); await h.controls.checkpoint();
  assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 5000);
  h.advance(1000); await h.controls.shutdown(); await h.controls.shutdown();
  const restarted = setup({ persistence: h.store }); restarted.resource.registerJob(job());
  assert.equal((await restarted.api.getDuty('c', 'worker')).creditedMs, 6000);
  assert.equal((await restarted.api.getDuty('c', 'worker')).onDuty, false);
  assert.equal((await restarted.api.getCharacter('c')).dutyLog.at(-1).reason, 'shutdown');
  await assert.rejects(h.resource.setDuty('c', 'worker', true), /stopped/);
});
test('concurrent duty limit and resource removal stop rights but preserve membership/time', async () => {
  const h = setup(); for (const key of ['worker', 'second']) { h.resource.registerJob(job(key)); await h.resource.assignJob('c', key); }
  const s = await h.activate('c'); await h.controls.setPlayerDuty(s, 'worker', true);
  await assert.rejects(h.controls.setPlayerDuty(s, 'second', true), /duty limit/);
  h.advance(900); await h.resource.deregisterJob('worker');
  assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 900); assert.equal(await h.api.hasPermission('c', 'job.worker.work'), false);
  assert.equal((await h.api.getCharacter('c')).jobs.length, 2);
});
test('failed disconnect checkpoint freezes the end time; retry cannot credit offline time', async () => {
  const h = setup(); h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker'); const s = await h.activate('c');
  await h.controls.setPlayerDuty(s, 'worker', true); h.advance(1000);
  const save = h.store.compareAndSet.bind(h.store); h.store.compareAndSet = async () => { throw Error('DB down'); };
  h.native.delete(1); await assert.rejects(h.controls.disconnect(1), /DB down/);
  h.advance(60000); h.store.compareAndSet = save; await h.controls.checkpoint();
  assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 1000); assert.equal((await h.api.getDuty('c', 'worker')).onDuty, false);
});
test('ambiguous checkpoint acceptance is deduplicated on retry', async () => {
  const h = setup(); h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker'); const s = await h.activate('c');
  await h.controls.setPlayerDuty(s, 'worker', true); h.advance(1000);
  const save = h.store.compareAndSet.bind(h.store); let once = true;
  h.store.compareAndSet = async (...args) => { await save(...args); if (once) { once = false; throw Error('lost acknowledgement'); } };
  await assert.rejects(h.controls.setPlayerDuty(s, 'worker', false), /lost acknowledgement/);
  h.advance(5000); await h.controls.checkpoint(); assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 1000);
});
test('two simultaneous sessions cannot activate the same character', async () => {
  const h = setup(); await h.activate('c', 1); await assert.rejects(h.activate('c', 2), /already online/);
});
