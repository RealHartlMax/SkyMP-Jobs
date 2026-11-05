'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { migrateState, emptyState, NativeJobsPersistence, NativeRecordIdentity, InMemoryJobsPersistence, nativeCorePermissions } = require('../dist/library.cjs');
const { setup, job } = require('./helpers.cjs');
function fakeNative() {
  const actors = new Map([[101, { profileId: 7, record: 'ff001:Skyrim.esm' }], [102, { profileId: 7, record: 'ff002:Skyrim.esm' }]]), users = new Map([[1, 101]]);
  const mp = {
    isConnected: u => users.has(u), getUserActor: u => users.get(u), getUserByActor: a => [...users].find(([, actor]) => actor === a)?.[0],
    get: (a, p) => structuredClone(actors.get(a)?.[p]), set: (a, p, v) => { assert.ok(actors.has(a)); actors.get(a)[p] = structuredClone(v); },
    getDescFromId: a => actors.get(a)?.record, getIdFromDesc: r => [...actors].find(([, data]) => data.record === r)?.[0],
  };
  return { mp, actors, users };
}
test('schema v1 migrates to v2 without resetting memberships; corrupt/future schemas fail closed', () => {
  const v1 = { schemaVersion: 1, characterId: 'c', revision: 7, jobs: [], professions: [], primaryJobId: null };
  const next = migrateState(v1, 'c'); assert.equal(next.schemaVersion, 2); assert.equal(next.revision, 7); assert.deepEqual(next.payments, []);
  assert.equal(v1.schemaVersion, 1);
  for (const bad of [{ ...v1, schemaVersion: 99 }, { ...v1, characterId: 'different' }, { ...v1, revision: -1 }, { ...v1, primaryJobId: 'unassigned' }, { ...emptyState('c'), payments: [{}] }]) assert.throws(() => migrateState(bad, 'c'));
});
test('memory adapter has CAS semantics, immutable isolation and no durability claim', async () => {
  const store = new InMemoryJobsPersistence(), state = { ...emptyState('c'), revision: 1 };
  await store.compareAndSet('c', null, state); state.revision = 99;
  assert.equal((await store.load('c')).revision, 1);
  await assert.rejects(store.compareAndSet('c', null, { ...state, revision: 1 }), /conflict/);
  const read = await store.load('c'); read.jobs.push({ fake: true }); assert.equal((await store.load('c')).jobs.length, 0);
  assert.equal(store.durableCommitAcknowledged, false); assert.equal(await new InMemoryJobsPersistence().load('c'), null);
});
test('native storage uses existing record/profile for slot isolation and refuses owner mismatch', async () => {
  const core = fakeNative(), store = new NativeJobsPersistence(core.mp), identity = new NativeRecordIdentity(core.mp);
  const first = identity.getSession(1), h = setup({ persistence: store, isSessionCurrent: s => identity.isCurrent(s) });
  h.resource.registerJob(job()); await h.resource.assignJob(first.characterId, 'worker');
  core.users.set(1, 102); const second = identity.getSession(1);
  assert.notEqual(first.characterId, second.characterId); assert.equal(first.accountId, second.accountId);
  assert.equal(identity.isCurrent(first), false); assert.equal((await h.api.getCharacter(second.characterId)).jobs.length, 0);
  const restarted = new NativeJobsPersistence(core.mp); assert.equal((await restarted.load(first.characterId)).jobs[0].jobId, 'worker');
  core.actors.get(101).profileId = 8; await assert.rejects(store.load(first.characterId), /ownership mismatch/);
  await assert.rejects(store.load('actor:101'), /native record identity/); assert.equal(store.durableCommitAcknowledged, false);
});
test('native identity renews connection generation, validates reverse binding, corrupt envelope never resets', async () => {
  const core = fakeNative(), identity = new NativeRecordIdentity(core.mp), store = new NativeJobsPersistence(core.mp);
  const s = identity.getSession(1); identity.invalidate(1); assert.notEqual(identity.getSession(1).sessionId, s.sessionId);
  const state = { ...emptyState(s.characterId), revision: 1 }; await store.compareAndSet(s.characterId, null, state);
  core.actors.get(101)['private.skympJobs'].formatVersion = 99;
  await assert.rejects(store.load(s.characterId), /Invalid Jobs/);
  await assert.rejects(store.compareAndSet(s.characterId, null, state), /Invalid Jobs/);
  core.mp.getUserByActor = () => 99; assert.equal(identity.getSession(1), null);
});
test('actual Core permission global is optional, denial/errors fail closed', async () => {
  const core = fakeNative(), identity = new NativeRecordIdentity(core.mp), session = identity.getSession(1), adapter = nativeCorePermissions(identity);
  assert.equal(await adapter.hasPermission(session.characterId, 'jobs.admin', session), false);
  try {
    globalThis.skympConsoleSecurity = { apiVersion: 1, hasPermission: (user, name) => user === 1 && name === 'jobs.admin' };
    assert.equal(await adapter.hasPermission(session.characterId, 'jobs.admin', session), true);
    globalThis.skympConsoleSecurity.hasPermission = () => { throw Error('denied'); };
    assert.equal(await adapter.hasPermission(session.characterId, 'jobs.admin', session), false);
  } finally { delete globalThis.skympConsoleSecurity; }
});
