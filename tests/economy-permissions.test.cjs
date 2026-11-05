'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, job } = require('./helpers.cjs');
const request = { eventId: 'salary-shift-1', jobId: 'worker', kind: 'salary', amount: 500, currency: 'gold', reason: 'Schicht' };
test('missing economy does not prevent Jobs; duplicate settled payments return the same receipt', async () => {
  const without = setup(); without.resource.registerJob(job()); await without.resource.assignJob('c', 'worker');
  assert.deepEqual(await without.resource.requestPayment('c', request), { status: 'unavailable' });
  let calls = 0; const h = setup({ economy: { apiVersion: 1, async request(payment) { calls++; assert.ok(payment.idempotencyKey.startsWith('jobs:')); return { status: 'settled', reference: 'receipt-1' }; } } });
  h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker');
  const result = await Promise.all([h.resource.requestPayment('c', request), h.resource.requestPayment('c', request)]);
  assert.equal(calls, 1); assert.deepEqual(result[0], result[1]);
  await assert.rejects(h.resource.requestPayment('c', { ...request, amount: 1000 }), /idempotency conflict/);
  assert.equal((await h.api.getCharacter('c')).payments.length, 1);
});
test('ambiguous economy failures stay pending and retry with the exact same idempotency key', async () => {
  const credited = new Set(), keys = []; let money = 0, fail = true;
  const h = setup({ economy: { apiVersion: 1, async request(payment) {
    keys.push(payment.idempotencyKey); if (!credited.has(payment.idempotencyKey)) { credited.add(payment.idempotencyKey); money += payment.amount; }
    if (fail) { fail = false; throw Error('timeout after transfer'); } return { status: 'settled', reference: 'r' };
  } } });
  h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker');
  await assert.rejects(h.resource.requestPayment('c', request), /timeout/);
  assert.equal((await h.api.getCharacter('c')).payments[0].status, 'pending');
  const restarted = setup({ persistence: h.store, economy: { apiVersion: 1, async request(payment) {
    keys.push(payment.idempotencyKey); if (!credited.has(payment.idempotencyKey)) money += payment.amount;
    return { status: 'settled', reference: 'r' };
  } } });
  restarted.resource.registerJob(job()); await restarted.resource.requestPayment('c', request);
  assert.equal(money, 500); assert.equal(keys[0], keys[1]);
});
test('Core roles and Factions gate access without duplicating either membership system', async () => {
  let coreAllowed = false, factionAllowed = false;
  const h = setup({ permissions: { apiVersion: 1, async hasPermission() { return coreAllowed; } }, factions: { apiVersion: 1, async isMember(c, faction) { assert.equal(faction, 'city'); return factionAllowed; } } });
  h.resource.registerJob(job('worker', { access: { corePermission: 'host.employed', factionId: 'city' } }));
  await assert.rejects(h.resource.assignJob('c', 'worker'), /access denied/); coreAllowed = true;
  await assert.rejects(h.resource.assignJob('c', 'worker'), /access denied/); factionAllowed = true;
  await h.resource.assignJob('c', 'worker', 'master'); assert.equal(await h.api.hasPermission('c', 'job.worker.manage'), true);
  factionAllowed = false; assert.equal(await h.api.hasPermission('c', 'job.worker.manage'), false);
  const unavailable = setup(); unavailable.resource.registerJob(job('worker', { access: { factionId: 'city' } }));
  await assert.rejects(unavailable.resource.assignJob('c', 'worker'), /access denied/);
});
test('revocation/session switch while an asynchronous permission check waits fails closed', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = setup({ permissions: { apiVersion: 1, async hasPermission() { await gate; return true; } } });
  h.resource.registerJob(job('worker', { permissions: [{ id: 'job.worker.work', requiresDuty: true, corePermission: 'host.work' }] }));
  await h.resource.assignJob('c', 'worker'); const s = await h.activate('c'); await h.controls.setPlayerDuty(s, 'worker', true);
  const pending = h.api.hasPermission('c', 'job.worker.work'); await new Promise(resolve => setImmediate(resolve));
  h.native.delete(1); release(); assert.equal(await pending, false);
});
test('disabled definition during asynchronous permission check cannot keep its rights', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = setup({ permissions: { apiVersion: 1, async hasPermission() { await gate; return true; } } });
  h.resource.registerJob(job('worker', { permissions: [{ id: 'job.worker.manage', corePermission: 'host.work' }] })); await h.resource.assignJob('c', 'worker');
  const pending = h.api.hasPermission('c', 'job.worker.manage'); await new Promise(resolve => setImmediate(resolve));
  const disabling = h.resource.setJobEnabled('worker', false); release(); assert.equal(await pending, false); await disabling;
});
test('slow Economy requests release the character queue so duty and job changes continue', async () => {
  let resolveTransfer; const transfer = new Promise(resolve => { resolveTransfer = resolve; });
  let sent; const submitted = new Promise(resolve => { sent = resolve; });
  const h = setup({ economy: { apiVersion: 1, async request() { sent(); return transfer; } } });
  h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker'); const s = await h.activate('c');
  await h.controls.setPlayerDuty(s, 'worker', true);
  const payment = h.resource.requestPayment('c', request); await submitted;
  await h.resource.setGrade('c', 'worker', 'master'); h.advance(1000); await h.controls.checkpoint();
  assert.equal((await h.api.getDuty('c', 'worker')).creditedMs, 1000); assert.equal((await h.api.getCharacter('c')).payments[0].status, 'pending');
  resolveTransfer({ status: 'settled', reference: 'slow-transfer' }); assert.equal((await payment).status, 'settled');
});
